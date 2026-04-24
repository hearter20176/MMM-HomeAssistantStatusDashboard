/* MMM-HomeAssistantStatusDashboard — node_helper
 * Maintains a persistent WebSocket connection to the Home Assistant
 * WebSocket API and forwards state changes to the front-end module.
 */

const NodeHelper = require("node_helper");
const WebSocket = require("ws");

module.exports = NodeHelper.create({

  start() {
    console.log("[MMM-HomeAssistantStatusDashboard] node_helper started");
    this.ws = null;
    this.cfg = null;
    this.msgId = 1;
    this.reconnectTimer = null;
    this.stopping = false;
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "HA_CONNECT") {
      this.cfg = payload;
      this.stopping = false;
      this._connect();
    }
  },

  // ---------------------------------------------------------------------------
  // WebSocket management
  // ---------------------------------------------------------------------------

  _connect() {
    if (this.ws) {
      try { this.ws.terminate(); } catch (_) {}
      this.ws = null;
    }

    const url = this.cfg.haUrl.replace(/^https?/, ws => ws === "https" ? "wss" : "ws") + "/api/websocket";
    console.log("[MMM-HomeAssistantStatusDashboard] Connecting:", url);

    let ws;
    try {
      ws = new WebSocket(url, { rejectUnauthorized: false });
    } catch (err) {
      console.error("[MMM-HomeAssistantStatusDashboard] Could not create WebSocket:", err.message);
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
      console.log(`[MMM-HomeAssistantStatusDashboard] WebSocket closed (${code})`);
      this.ws = null;
      this.sendSocketNotification("HA_DISCONNECTED", {});
      if (!this.stopping) this._scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("[MMM-HomeAssistantStatusDashboard] WebSocket error:", err.message);
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
        console.log("[MMM-HomeAssistantStatusDashboard] Authenticated. HA version:", msg.ha_version);
        this.sendSocketNotification("HA_CONNECTED", { haVersion: msg.ha_version });

        // Fetch all current states as the initial snapshot
        this._send({ id: this.msgId++, type: "get_states" });

        // Subscribe to state_changed events for real-time updates
        this._send({ id: this.msgId++, type: "subscribe_events", event_type: "state_changed" });
        break;

      case "auth_invalid":
        console.error("[MMM-HomeAssistantStatusDashboard] Auth rejected:", msg.message);
        this.sendSocketNotification("HA_ERROR", { message: "Authentication failed: " + msg.message });
        // No reconnect on auth failure — bad token won't self-heal
        break;

      case "result":
        if (msg.success && Array.isArray(msg.result)) {
          // This is the get_states response
          this.sendSocketNotification("HA_STATES", { states: msg.result });
        } else if (!msg.success) {
          console.warn("[MMM-HomeAssistantStatusDashboard] Command failed:", msg.error);
        }
        break;

      case "event": {
        const event = msg.event;
        if (!event || event.event_type !== "state_changed" || !event.data) break;
        const { entity_id, new_state, old_state } = event.data;
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
      console.error("[MMM-HomeAssistantStatusDashboard] Send error:", err.message);
    }
  },

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = (this.cfg && this.cfg.reconnectInterval) || 10000;
    console.log(`[MMM-HomeAssistantStatusDashboard] Reconnecting in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.cfg && !this.stopping) this._connect();
    }, delay);
  },

  stop() {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.terminate(); } catch (_) {}
      this.ws = null;
    }
  }
});
