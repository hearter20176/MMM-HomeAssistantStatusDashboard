// The front end classifies readings from unit_of_measurement / state_class /
// device_class, so the helper must forward state objects with attributes intact.
jest.mock("ws", () => {
  const MockWebSocket = jest.fn(() => ({ on: jest.fn(), send: jest.fn(), terminate: jest.fn(), readyState: 1 }));
  MockWebSocket.OPEN = 1;
  return MockWebSocket;
});

const helper = require("../node_helper");

const attributes = { unit_of_measurement: "pCi/L", state_class: "measurement", device_class: "radon" };

beforeEach(() => {
  helper._send = jest.fn();
  helper.sendSocketNotification = jest.fn();
  helper.cfg = { haUrl: "http://ha.local:8123", token: "test-token" };
});

test("get_states snapshot keeps unit_of_measurement, state_class and device_class", () => {
  helper.entityIds = new Set(["sensor.radon_level"]);
  const states = [{ entity_id: "sensor.radon_level", state: "1.8", attributes }];
  helper._handleMessage(JSON.stringify({ type: "result", success: true, result: states }));
  const call = helper.sendSocketNotification.mock.calls.find(c => c[0] === "HA_STATES");
  expect(call[1].states[0].attributes).toEqual(attributes);
});

test("state_changed events keep the attributes on new_state", () => {
  helper.entityIds = null;
  const new_state = { entity_id: "sensor.radon_level", state: "4.2", attributes };
  helper._handleMessage(JSON.stringify({
    type: "event",
    event: { event_type: "state_changed", data: { entity_id: "sensor.radon_level", new_state, old_state: null } }
  }));
  const call = helper.sendSocketNotification.mock.calls.find(c => c[0] === "HA_STATE_CHANGED");
  expect(call[1].new_state.attributes).toEqual(attributes);
});
