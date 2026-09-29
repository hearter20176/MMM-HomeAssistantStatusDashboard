/* MMM-HomeAssistantStatusDashboard — node_helper
 * Maintains a persistent WebSocket connection to the Home Assistant
 * WebSocket API and forwards state changes to the front-end module.
 */

const NodeHelper = require("node_helper");
const WebSocket = require("ws");
const Log = require("logger");

module.exports = NodeHelper.create({

  start() {
    Log.log("[MMM-HomeAssistantStatusDashboard] node_helper started");
    this.ws = null;
    this.cfg = null;
    this.msgId = 1;
    this.reconnectTimer = null;
    this.stopping = false;
    this.heartbeatTimer = null;
    this.awaitingPong = false;
    this.entityIds = null;  // Set of configured entity_ids; null = forward everything
    this.authFailed = false;  // true once HA rejects our token — terminal, no reconnect
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "HA_CONNECT") {
      this.cfg = payload;
      this.stopping = false;
      this.authFailed = false;
      const ids = Array.isArray(payload.entityIds) ? payload.entityIds : [];
      this.entityIds = ids.length ? new Set(ids) : null;
      this._connect();
    }
  },

  // ---------------------------------------------------------------------------
  // WebSocket management
  // ---------------------------------------------------------------------------

  _connect() {
    if (this.ws) {
      try { this.ws.terminate(); } catch (_) { /* socket may already be closed */ }
      this.ws = null;
    }

    const url = `${this.cfg.haUrl.replace(/^https?/, ws => ws === "https" ? "wss" : "ws")}/api/websocket`;
    Log.log("[MMM-HomeAssistantStatusDashboard] Connecting to Home Assistant");

    let ws;
    try {
      ws = new WebSocket(url, { rejectUnauthorized: false });
    } catch (err) {
      Log.error("[MMM-HomeAssistantStatusDashboard] Could not create WebSocket:", err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws = ws;
    this.msgId = 1;

    ws.on("open", () => {
      // Auth is sent after receiving the auth_required message from HA
    });

    ws.on("message", (data) => {
      this._handleMessage(data.toString());
    });

    ws.on("close", (code) => {
      if (this.ws !== ws) return;  // stale socket
      Log.log(`[MMM-HomeAssistantStatusDashboard] WebSocket closed (${code})`);
      this.ws = null;
      this._stopHeartbeat();
      this.sendSocketNotification("HA_DISCONNECTED", {});
      // A rejected token is terminal — retrying just invites an HA IP ban
      if (!this.stopping && !this.authFailed) this._scheduleReconnect();
    });

    ws.on("error", (err) => {
      Log.error("[MMM-HomeAssistantStatusDashboard] WebSocket error:", err.message);
      this.sendSocketNotification("HA_ERROR", { message: err.message });
      // 'close' fires after 'error', so reconnect is handled there
    });
  },

  _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    switch (msg.type) {

      case "auth_required":
        // HA demands authentication — send our long-lived token
        this._send({ type: "auth", access_token: this.cfg.token });
        break;

      case "auth_ok":
        Log.log("[MMM-HomeAssistantStatusDashboard] Authenticated. HA version:", msg.ha_version);
        this.sendSocketNotification("HA_CONNECTED", { haVersion: msg.ha_version });

        // Fetch all current states as the initial snapshot
        this._send({ id: this.msgId++, type: "get_states" });

        // Subscribe to state_changed events for real-time updates
        this._send({ id: this.msgId++, type: "subscribe_events", event_type: "state_changed" });
        this._startHeartbeat();
        break;

      case "pong":
        this.awaitingPong = false;
        break;

      case "auth_invalid":
        Log.error("[MMM-HomeAssistantStatusDashboard] Auth rejected:", msg.message);
        // Terminal — a bad token won't self-heal, and HA can IP-ban repeated attempts
        this.authFailed = true;
        this.sendSocketNotification("HA_ERROR", { message: `Authentication failed: ${msg.message}` });
        break;

      case "result":
        if (msg.success && Array.isArray(msg.result)) {
          // This is the get_states response
          const states = this.entityIds
            ? msg.result.filter(s => s && this.entityIds.has(s.entity_id))
            : msg.result;
          this.sendSocketNotification("HA_STATES", { states });
        } else if (!msg.success) {
          Log.warn("[MMM-HomeAssistantStatusDashboard] Command failed:", msg.error);
        }
        break;

      case "event": {
        const event = msg.event;
        if (!event || event.event_type !== "state_changed" || !event.data) break;
        const { entity_id, new_state, old_state } = event.data;
        // Only forward entities the dashboard shows; HA emits thousands of changes an hour
        if (this.entityIds && !this.entityIds.has(entity_id)) break;
        this.sendSocketNotification("HA_STATE_CHANGED", { entity_id, new_state, old_state });
        break;
      }
    }
  },

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (err) {
      Log.error("[MMM-HomeAssistantStatusDashboard] Send error:", err.message);
    }
  },

  // A Wi-Fi drop can leave a half-open TCP socket that never fires 'close'.
  // Ping HA periodically and force a reconnect if a pong doesn't come back.
  _startHeartbeat() {
    this._stopHeartbeat();
    const interval = (this.cfg && this.cfg.heartbeatInterval) || 30000;
    this.heartbeatTimer = setInterval(() => {
      if (this.awaitingPong) {
        Log.warn("[MMM-HomeAssistantStatusDashboard] No pong from HA; reconnecting");
        this._stopHeartbeat();
        if (this.ws) {
          try { this.ws.terminate(); } catch (_) { /* socket may already be closed */ }
        }
        return;
      }
      this.awaitingPong = true;
      this._send({ id: this.msgId++, type: "ping" });
    }, interval);
  },

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.awaitingPong = false;
  },

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = (this.cfg && this.cfg.reconnectInterval) || 10000;
    Log.log(`[MMM-HomeAssistantStatusDashboard] Reconnecting in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.cfg && !this.stopping) this._connect();
    }, delay);
  },

  stop() {
    this.stopping = true;
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.terminate(); } catch (_) { /* socket may already be closed */ }
      this.ws = null;
    }
  }
});
