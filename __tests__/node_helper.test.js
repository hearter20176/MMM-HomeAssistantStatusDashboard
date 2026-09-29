// Mock ws before requiring node_helper so the real WebSocket is never opened.
// `on` records handlers per-instance so tests can drive close/message events.
jest.mock("ws", () => {
  const MockWebSocket = jest.fn(() => {
    const instance = {
      _handlers: {},
      send: jest.fn(),
      terminate: jest.fn(),
      readyState: 1  // WebSocket.OPEN
    };
    instance.on = jest.fn((event, cb) => { instance._handlers[event] = cb; });
    return instance;
  });
  MockWebSocket.OPEN = 1;
  return MockWebSocket;
});

const WebSocket = require("ws");
const helper = require("../node_helper");

beforeEach(() => {
  jest.clearAllMocks();
  helper._send = jest.fn();
  helper.sendSocketNotification = jest.fn();
  helper.cfg = {
    haUrl: "http://ha.local:8123",
    token: "test-token",
    reconnectInterval: 10000
  };
  helper.msgId = 1;
  helper.ws = null;
  helper.reconnectTimer = null;
  helper.stopping = false;
  helper.authFailed = false;
});

afterEach(() => { helper._stopHeartbeat(); });

// ─── _handleMessage ───────────────────────────────────────────────────────────

describe("_handleMessage", () => {
  test("auth_required sends token", () => {
    helper._handleMessage(JSON.stringify({ type: "auth_required" }));
    expect(helper._send).toHaveBeenCalledWith({
      type: "auth",
      access_token: "test-token"
    });
  });

  test("auth_ok notifies HA_CONNECTED", () => {
    helper._handleMessage(JSON.stringify({ type: "auth_ok", ha_version: "2024.3.0" }));
    expect(helper.sendSocketNotification).toHaveBeenCalledWith("HA_CONNECTED", {
      haVersion: "2024.3.0"
    });
  });

  test("auth_ok sends get_states and subscribe_events", () => {
    helper._handleMessage(JSON.stringify({ type: "auth_ok", ha_version: "2024.3.0" }));
    expect(helper._send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "get_states" })
    );
    expect(helper._send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "subscribe_events", event_type: "state_changed" })
    );
    expect(helper._send).toHaveBeenCalledTimes(2);
  });

  test("auth_ok without ha_version sends undefined haVersion", () => {
    helper._handleMessage(JSON.stringify({ type: "auth_ok" }));
    expect(helper.sendSocketNotification).toHaveBeenCalledWith("HA_CONNECTED", {
      haVersion: undefined
    });
  });

  test("auth_invalid sends HA_ERROR", () => {
    helper._handleMessage(JSON.stringify({ type: "auth_invalid", message: "Token expired" }));
    expect(helper.sendSocketNotification).toHaveBeenCalledWith("HA_ERROR", {
      message: "Authentication failed: Token expired"
    });
  });

  test("auth_invalid does not trigger reconnect", () => {
    const spy = jest.spyOn(helper, "_scheduleReconnect");
    helper._handleMessage(JSON.stringify({ type: "auth_invalid", message: "bad token" }));
    expect(spy).not.toHaveBeenCalled();
  });

  test("auth_invalid sets authFailed so a later close does not reconnect", () => {
    helper._handleMessage(JSON.stringify({ type: "auth_invalid", message: "bad token" }));
    expect(helper.authFailed).toBe(true);
  });

  test("result with state array sends HA_STATES", () => {
    const states = [{ entity_id: "sensor.x", state: "22", attributes: {} }];
    helper._handleMessage(JSON.stringify({ type: "result", success: true, result: states }));
    expect(helper.sendSocketNotification).toHaveBeenCalledWith("HA_STATES", { states });
  });

  test("result with non-array does not send HA_STATES", () => {
    helper._handleMessage(JSON.stringify({ type: "result", success: true, result: {} }));
    expect(helper.sendSocketNotification).not.toHaveBeenCalled();
  });

  test("failed result sends no notification", () => {
    helper._handleMessage(JSON.stringify({ type: "result", success: false, error: { message: "oops" } }));
    expect(helper.sendSocketNotification).not.toHaveBeenCalled();
  });

  test("state_changed event sends HA_STATE_CHANGED", () => {
    const newState = { state: "22", attributes: {} };
    const oldState = { state: "21", attributes: {} };
    helper._handleMessage(JSON.stringify({
      type: "event",
      event: {
        event_type: "state_changed",
        data: { entity_id: "sensor.temp", new_state: newState, old_state: oldState }
      }
    }));
    expect(helper.sendSocketNotification).toHaveBeenCalledWith("HA_STATE_CHANGED", {
      entity_id: "sensor.temp",
      new_state: newState,
      old_state: oldState
    });
  });

  test("non-state_changed event is ignored", () => {
    helper._handleMessage(JSON.stringify({
      type: "event",
      event: { event_type: "call_service", data: {} }
    }));
    expect(helper.sendSocketNotification).not.toHaveBeenCalled();
  });

  test("invalid JSON does not throw", () => {
    expect(() => helper._handleMessage("{not valid json")).not.toThrow();
    expect(helper.sendSocketNotification).not.toHaveBeenCalled();
  });

  test("unknown message type is silently ignored", () => {
    helper._handleMessage(JSON.stringify({ type: "pong" }));
    expect(helper.sendSocketNotification).not.toHaveBeenCalled();
    expect(helper._send).not.toHaveBeenCalled();
  });
});

// ─── _connect ────────────────────────────────────────────────────────────────

describe("_connect", () => {
  test("derives ws:// URL from http:// haUrl", () => {
    helper._connect();
    expect(WebSocket).toHaveBeenCalledWith(
      "ws://ha.local:8123/api/websocket",
      expect.any(Object)
    );
  });

  test("derives wss:// URL from https:// haUrl", () => {
    helper.cfg.haUrl = "https://ha.example.com:8123";
    helper._connect();
    expect(WebSocket).toHaveBeenCalledWith(
      "wss://ha.example.com:8123/api/websocket",
      expect.any(Object)
    );
  });

  test("terminates existing socket before opening a new one", () => {
    const oldWs = { terminate: jest.fn(), on: jest.fn() };
    helper.ws = oldWs;
    helper._connect();
    expect(oldWs.terminate).toHaveBeenCalled();
  });

  test("resets msgId to 1 on each connect", () => {
    helper.msgId = 99;
    helper._connect();
    expect(helper.msgId).toBe(1);
  });
});

// ─── entity filtering & heartbeat ────────────────────────────────────────────

describe("entity filtering", () => {
  afterEach(() => { helper.entityIds = null; });

  test("HA_CONNECT with entityIds limits forwarded states", () => {
    const originalConnect = helper._connect;
    helper._connect = jest.fn();
    helper.socketNotificationReceived("HA_CONNECT", { ...helper.cfg, entityIds: ["sensor.a"] });
    const states = [{ entity_id: "sensor.a", state: "1" }, { entity_id: "sensor.b", state: "2" }];
    helper._handleMessage(JSON.stringify({ type: "result", success: true, result: states }));
    expect(helper.sendSocketNotification).toHaveBeenCalledWith("HA_STATES", { states: [states[0]] });
    helper._connect = originalConnect;
  });

  test("state_changed for an unconfigured entity is dropped", () => {
    helper.entityIds = new Set(["sensor.a"]);
    helper._handleMessage(JSON.stringify({
      type: "event",
      event: { event_type: "state_changed", data: { entity_id: "sensor.b", new_state: {}, old_state: {} } }
    }));
    expect(helper.sendSocketNotification).not.toHaveBeenCalled();
  });
});

describe("close handling (auth_invalid must be terminal)", () => {
  test("close after auth_invalid does not schedule a reconnect", () => {
    helper._connect();
    const ws = WebSocket.mock.results[WebSocket.mock.results.length - 1].value;

    helper._handleMessage(JSON.stringify({ type: "auth_invalid", message: "bad token" }));

    const spy = jest.spyOn(helper, "_scheduleReconnect");
    ws._handlers.close(1000);

    expect(spy).not.toHaveBeenCalled();
    expect(helper.reconnectTimer).toBeNull();
  });

  test("close without auth_invalid still schedules a reconnect", () => {
    helper._connect();
    const ws = WebSocket.mock.results[WebSocket.mock.results.length - 1].value;

    const spy = jest.spyOn(helper, "_scheduleReconnect");
    ws._handlers.close(1006);

    expect(spy).toHaveBeenCalled();
    // _scheduleReconnect really queues a setTimeout — clean it up so it
    // doesn't leak past this test.
    clearTimeout(helper.reconnectTimer);
    helper.reconnectTimer = null;
  });

  test("HA_CONNECT clears a stale authFailed flag so future drops can reconnect", () => {
    const originalConnect = helper._connect;
    helper.authFailed = true;
    helper._connect = jest.fn();
    helper.socketNotificationReceived("HA_CONNECT", { ...helper.cfg });
    expect(helper.authFailed).toBe(false);
    helper._connect = originalConnect;
  });
});

describe("heartbeat", () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { helper._stopHeartbeat(); jest.useRealTimers(); });

  test("pings on each interval and clears on pong", () => {
    helper.cfg.heartbeatInterval = 1000;
    helper._startHeartbeat();
    jest.advanceTimersByTime(1000);
    expect(helper._send).toHaveBeenCalledWith(expect.objectContaining({ type: "ping" }));
    helper._handleMessage(JSON.stringify({ type: "pong" }));
    expect(helper.awaitingPong).toBe(false);
  });

  test("missed pong terminates the socket", () => {
    const ws = { terminate: jest.fn() };
    helper.ws = ws;
    helper.cfg.heartbeatInterval = 1000;
    helper._startHeartbeat();
    jest.advanceTimersByTime(2000);
    expect(ws.terminate).toHaveBeenCalled();
  });
});
