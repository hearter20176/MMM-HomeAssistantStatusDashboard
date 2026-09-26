/* MMM-HomeAssistantStatusDashboard
 * Real-time Home Assistant entity status dashboard for MagicMirror²
 * Uses HA WebSocket API for near real-time state updates and alerting.
 */

/* global Module, Log, config */

Module.register("MMM-HomeAssistantStatusDashboard", {

  defaults: {
    header: "Home Assistant",
    haUrl: "http://homeassistant.local:8123",
    token: "",

    // Array of entity config objects — see README for full schema
    entities: [],

    // Ordered list of group names; unordered groups appended after
    groupOrder: [],

    // Number of tile columns in each group grid (3 suits a portrait/rotated display)
    tilesPerRow: 3,

    // Show flashing banner listing all currently-alerting entities
    showAlertBanner: true,

    // Push a SHOW_ALERT notification to the MagicMirror Alert module on new alerts
    showMmAlert: true,

    // Hide tiles for entities that are unavailable in HA
    hideUnavailable: false,

    // Footer showing last state-change timestamp
    showLastUpdated: true,

    // Small dot + version string in header
    showConnectionStatus: true,

    // "dark" | "light"
    theme: "dark",

    reconnectInterval: 10000,
    // Ping HA this often; a missed pong forces a reconnect (half-open sockets)
    heartbeatInterval: 30000,
    // Coalesce bursts of state changes into one redraw
    renderDebounce: 1000,
    animationSpeed: 400
  },

  // ---------------------------------------------------------------------------
  // Assets
  // ---------------------------------------------------------------------------

  getStyles() {
    // MagicMirror's vendored Font Awesome (7.x free, "fa-solid" classes)
    return ["font-awesome.css", "MMM-HomeAssistantStatusDashboard.css"];
  },

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start() {
    Log.info(`[${this.name}] starting`);
    this.states = {};          // entity_id → HA state object
    this.connected = false;
    this.haVersion = null;
    this.lastUpdated = null;
    this.error = null;
    this.loaded = false;
    this.renderTimer = null;
    this.entityIds = new Set(this.config.entities.map(ec => ec.entity_id));

    if (this.config.haUrl && this.config.token) {
      this.sendSocketNotification("HA_CONNECT", {
        haUrl: this.config.haUrl,
        token: this.config.token,
        reconnectInterval: this.config.reconnectInterval,
        heartbeatInterval: this.config.heartbeatInterval,
        entityIds: [...this.entityIds]
      });
    } else {
      this.error = "haUrl and token must be configured.";
      this.loaded = true;
    }
  },

  socketNotificationReceived(notification, payload) {
    switch (notification) {

      case "HA_CONNECTED":
        this.connected = true;
        this.error = null;
        this.haVersion = payload.haVersion || null;
        this.updateDom(this.config.animationSpeed);
        break;

      case "HA_DISCONNECTED":
        this.connected = false;
        this.updateDom(this.config.animationSpeed);
        break;

      case "HA_STATES":
        this.loaded = true;
        this.lastUpdated = new Date();
        payload.states.forEach(s => { this.states[s.entity_id] = s; });
        this.updateDom(this.config.animationSpeed);
        break;

      case "HA_STATE_CHANGED": {
        const entityId = payload.entity_id;
        if (!this.entityIds.has(entityId)) break;
        const oldHaState = this.states[entityId];
        const newHaState = payload.new_state;

        // Fire MM alert only on transition INTO alert state
        if (this.config.showMmAlert) {
          this.config.entities.forEach(ec => {
            if (ec.entity_id !== entityId) return;
            const wasAlert = oldHaState && this._isAlertState(ec, oldHaState);
            const isAlert = newHaState && this._isAlertState(ec, newHaState);
            if (!wasAlert && isAlert) {
              const name = ec.name ||
                (newHaState.attributes && newHaState.attributes.friendly_name) ||
                entityId;
              this.sendNotification("SHOW_ALERT", {
                type: "notification",
                title: "Home Assistant Alert",
                message: `${name}: ${ec.alertLabel || newHaState.state}`,
                timer: 10000
              });
            }
          });
        }

        if (newHaState) {
          this.states[entityId] = newHaState;
        } else {
          delete this.states[entityId];
        }
        this.lastUpdated = new Date();
        this._scheduleRender();
        break;
      }

      case "HA_ERROR":
        this.error = payload.message;
        if (!this.loaded) {
          this.loaded = true;
          this.updateDom(this.config.animationSpeed);
        }
        break;
    }
  },

  // Several entities often change together (a scene, an HA restart); redraw once
  _scheduleRender() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.updateDom(0);
    }, this.config.renderDebounce);
  },

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = `ha-dashboard-wrapper ha-theme-${this.config.theme}`;

    const card = document.createElement("div");
    card.className = "ha-dashboard-card";
    wrapper.appendChild(card);

    const shimmer = document.createElement("div");
    shimmer.className = "ha-shimmer";
    card.appendChild(shimmer);

    card.appendChild(this._buildHeader());

    if (!this.loaded) {
      card.appendChild(this._buildLoading("Connecting to Home Assistant…"));
      return wrapper;
    }

    if (this.error && !this.connected && Object.keys(this.states).length === 0) {
      card.appendChild(this._buildError(this.error));
      return wrapper;
    }

    if (this.config.showAlertBanner) {
      const banner = this._buildAlertBanner();
      if (banner) card.appendChild(banner);
    }

    card.appendChild(this._buildEntityGroups());

    if (this.config.showLastUpdated && this.lastUpdated) {
      card.appendChild(this._buildFooter());
    }

    return wrapper;
  },

  _buildHeader() {
    const header = document.createElement("div");
    header.className = "ha-header";

    const title = document.createElement("div");
    title.className = "ha-title";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-house-signal";
    title.appendChild(icon);
    title.appendChild(document.createTextNode(" " + this.config.header));
    header.appendChild(title);

    if (this.config.showConnectionStatus) {
      const status = document.createElement("div");
      status.className = `ha-connection-status ${this.connected ? "ha-connected" : "ha-disconnected"}`;

      const dot = document.createElement("span");
      dot.className = "ha-status-dot";
      status.appendChild(dot);

      const label = this.connected
        ? (this.haVersion ? `HA ${this.haVersion}` : "Connected")
        : "Disconnected";
      status.appendChild(document.createTextNode(label));
      header.appendChild(status);
    }

    return header;
  },

  _buildAlertBanner() {
    const alerts = this._getAlertEntities();
    if (alerts.length === 0) return null;

    const banner = document.createElement("div");
    banner.className = "ha-alert-banner";

    const bell = document.createElement("i");
    bell.className = "fa-solid fa-bell ha-alert-bell";
    banner.appendChild(bell);

    const list = document.createElement("div");
    list.className = "ha-alert-list";

    alerts.forEach(({ entityConfig, state }) => {
      const chip = document.createElement("span");
      chip.className = "ha-alert-chip";
      const name = entityConfig.name ||
        (state && state.attributes && state.attributes.friendly_name) ||
        entityConfig.entity_id;
      const stateText = entityConfig.alertLabel || this._formatState(entityConfig, state);
      chip.textContent = `${name}: ${stateText}`;
      list.appendChild(chip);
    });

    banner.appendChild(list);
    return banner;
  },

  _buildEntityGroups() {
    const container = document.createElement("div");
    container.className = "ha-groups-container";

    // Bucket entities into groups
    const groupMap = {};
    this.config.entities.forEach(ec => {
      const g = ec.group || "Other";
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(ec);
    });

    // Respect groupOrder; append unlisted groups alphabetically
    const ordered = [
      ...this.config.groupOrder.filter(g => groupMap[g]),
      ...Object.keys(groupMap)
        .filter(g => !this.config.groupOrder.includes(g))
        .sort()
    ];

    ordered.forEach(groupName => {
      const entities = groupMap[groupName];
      const groupEl = document.createElement("div");
      groupEl.className = "ha-group";

      const groupHeader = document.createElement("div");
      groupHeader.className = "ha-group-header";
      groupHeader.textContent = groupName;
      groupEl.appendChild(groupHeader);

      const grid = document.createElement("div");
      grid.className = "ha-entity-grid";
      // minmax(0, …) keeps columns equal; plain 1fr lets long states widen a column
      grid.style.gridTemplateColumns = `repeat(${this.config.tilesPerRow}, minmax(0, 1fr))`;

      entities.forEach(ec => {
        const state = this.states[ec.entity_id];
        if (!state && this.config.hideUnavailable) return;
        grid.appendChild(this._buildEntityTile(ec, state));
      });

      groupEl.appendChild(grid);
      container.appendChild(groupEl);
    });

    return container;
  },

  _buildEntityTile(entityConfig, state) {
    const stateClass = this._getStateClass(entityConfig, state);
    const isAlert = stateClass === "ha-state-alert";

    const tile = document.createElement("div");
    tile.className = `ha-entity-tile ${stateClass}${isAlert ? " ha-tile-alert" : ""}`;

    // Alert dot (top-right corner)
    if (isAlert) {
      const dot = document.createElement("div");
      dot.className = "ha-alert-dot";
      tile.appendChild(dot);
    }

    // Icon
    const iconWrap = document.createElement("div");
    iconWrap.className = "ha-tile-icon";
    const iEl = document.createElement("i");
    iEl.className = entityConfig.icon ||
      this._getDomainIcon(entityConfig.entity_id, state && state.attributes);
    iconWrap.appendChild(iEl);
    tile.appendChild(iconWrap);

    // State value
    const stateEl = document.createElement("div");
    stateEl.className = "ha-tile-state";
    stateEl.textContent = this._formatState(entityConfig, state);
    stateEl.title = state ? state.state : "";
    tile.appendChild(stateEl);

    // Name label
    const nameEl = document.createElement("div");
    nameEl.className = "ha-tile-name";
    nameEl.title = entityConfig.entity_id;  // full id on hover
    const displayName = entityConfig.name ||
      (state && state.attributes && state.attributes.friendly_name) ||
      entityConfig.entity_id.split(".")[1].replace(/_/g, " ");
    nameEl.textContent = displayName;
    tile.appendChild(nameEl);

    return tile;
  },

  _buildLoading(message) {
    const el = document.createElement("div");
    el.className = "ha-loading";
    const spinner = document.createElement("span");
    spinner.className = "ha-spinner";
    el.appendChild(spinner);
    el.appendChild(document.createTextNode(" " + message));
    return el;
  },

  _buildError(message) {
    const el = document.createElement("div");
    el.className = "ha-error";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-triangle-exclamation";
    el.appendChild(icon);
    el.appendChild(document.createTextNode(" " + message));
    return el;
  },

  _buildFooter() {
    const footer = document.createElement("div");
    footer.className = "ha-footer";
    const timeStr = this.lastUpdated.toLocaleTimeString(config.locale || "en", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    footer.textContent = `Updated ${timeStr}`;
    return footer;
  },

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

  _getAlertEntities() {
    return this.config.entities
      .map(ec => ({ entityConfig: ec, state: this.states[ec.entity_id] }))
      .filter(({ entityConfig, state }) => state && this._isAlertState(entityConfig, state));
  },

  _isAlertState(entityConfig, state) {
    if (!state) return false;
    const s = state.state;
    if (s === "unavailable" || s === "unknown") return false;

    if (entityConfig.alertWhen !== undefined && s === String(entityConfig.alertWhen)) return true;

    const num = parseFloat(s);
    if (!isNaN(num)) {
      if (entityConfig.alertAbove !== undefined && num > entityConfig.alertAbove) return true;
      if (entityConfig.alertBelow !== undefined && num < entityConfig.alertBelow) return true;
    }

    return false;
  },

  _getStateClass(entityConfig, state) {
    if (!state) return "ha-state-unavailable";
    const s = state.state;
    if (s === "unavailable" || s === "unknown") return "ha-state-unavailable";
    if (this._isAlertState(entityConfig, state)) return "ha-state-alert";

    // Per-entity lists replace the defaults (warnStates: [] disables warn)
    const lower = s.toLowerCase();
    const matches = list => list.some(v => String(v).toLowerCase() === lower);
    const warnStates = Array.isArray(entityConfig.warnStates)
      ? entityConfig.warnStates
      : ["opening", "closing", "pending", "arming", "triggered"];
    if (matches(warnStates)) return "ha-state-warn";

    const activeStates = Array.isArray(entityConfig.activeStates)
      ? entityConfig.activeStates
      : ["on", "open", "unlocked", "playing", "heating", "cooling",
        "fan_only", "drying", "home", "detected", "active", "armed_away",
        "armed_home", "armed_night", "true"];
    if (matches(activeStates)) return "ha-state-active";

    return "ha-state-inactive";
  },

  _formatState(entityConfig, state) {
    if (!state) return "N/A";
    const s = state.state;
    if (entityConfig.stateLabels && entityConfig.stateLabels[s] != null) {
      return String(entityConfig.stateLabels[s]);
    }
    if (s === "unavailable") return "Offline";
    if (s === "unknown") return "Unknown";

    // Show a specific attribute (e.g. "effect" for a light's current scene)
    if (entityConfig.attribute) {
      const val = state.attributes && state.attributes[entityConfig.attribute];
      if (val != null && val !== "") return String(val);
    }

    const num = parseFloat(s);
    if (!isNaN(num) && s.trim() !== "") {
      const unit = entityConfig.unit ||
        (state.attributes && state.attributes.unit_of_measurement) || "";
      const formatted = Number.isInteger(num) ? num : parseFloat(num.toFixed(1));
      return unit ? `${formatted}\u202f${unit}` : String(formatted);
    }

    return this._humanizeState(entityConfig.entity_id, s, state.attributes || {});
  },

  // Turn raw HA states ("heat_cool", "power_off", binary "on") into display text
  _humanizeState(entityId, s, attributes) {
    const domain = (entityId || "").split(".")[0];

    if (domain === "binary_sensor" && (s === "on" || s === "off")) {
      const byClass = {
        door: ["Open", "Closed"], garage_door: ["Open", "Closed"],
        window: ["Open", "Closed"], opening: ["Open", "Closed"],
        moisture: ["Wet", "Dry"], problem: ["Problem", "OK"],
        connectivity: ["Online", "Down"], running: ["Running", "Idle"],
        motion: ["Motion", "Clear"], occupancy: ["Occupied", "Clear"],
        presence: ["Home", "Away"], smoke: ["Smoke", "Clear"],
        gas: ["Gas", "Clear"], carbon_monoxide: ["CO", "Clear"],
        safety: ["Unsafe", "Safe"], tamper: ["Tampered", "Clear"],
        battery: ["Low", "Normal"], lock: ["Unlocked", "Locked"],
        plug: ["Plugged in", "Unplugged"], power: ["Power", "No power"],
        update: ["Update", "Current"]
      };
      const pair = byClass[attributes.device_class];
      if (pair) return s === "on" ? pair[0] : pair[1];
    }

    // Zero-width space lets "Heat/Cool" wrap at the slash in narrow tiles
    const known = {
      heat_cool: "Heat/\u200bCool", fan_only: "Fan", power_off: "Off",
      not_home: "Away", armed_away: "Armed away", armed_home: "Armed home",
      armed_night: "Armed night", disarmed: "Disarmed"
    };
    if (known[s]) return known[s];

    // Leave mixed-case vendor strings ("Fully Charged") alone
    if (s !== s.toLowerCase()) return s;
    const text = s.replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  },

  _getDomainIcon(entityId, attributes) {
    const domain = entityId.split(".")[0];
    const deviceClass = attributes && attributes.device_class;

    const deviceClassMap = {
      motion: "fa-solid fa-person-walking",
      door: "fa-solid fa-door-open",
      window: "fa-solid fa-window-maximize",
      garage_door: "fa-solid fa-warehouse",
      smoke: "fa-solid fa-fire-flame-curved",
      moisture: "fa-solid fa-droplet",
      gas: "fa-solid fa-wind",
      heat: "fa-solid fa-temperature-high",
      cold: "fa-solid fa-temperature-low",
      battery: "fa-solid fa-battery-half",
      battery_charging: "fa-solid fa-battery-full",
      connectivity: "fa-solid fa-wifi",
      light: "fa-solid fa-sun",
      occupancy: "fa-solid fa-person",
      power: "fa-solid fa-bolt",
      plug: "fa-solid fa-plug",
      presence: "fa-solid fa-location-dot",
      problem: "fa-solid fa-triangle-exclamation",
      safety: "fa-solid fa-shield-halved",
      sound: "fa-solid fa-volume-high",
      tamper: "fa-solid fa-shield-halved",
      vibration: "fa-solid fa-wave-square",
      lock: "fa-solid fa-lock",
      energy: "fa-solid fa-bolt",
      temperature: "fa-solid fa-temperature-half",
      humidity: "fa-solid fa-droplet",
      pressure: "fa-solid fa-gauge",
      co2: "fa-solid fa-cloud",
      pm25: "fa-solid fa-smog",
      illuminance: "fa-solid fa-sun",
      voltage: "fa-solid fa-plug",
      current: "fa-solid fa-wave-square",
      frequency: "fa-solid fa-wave-square",
      speed: "fa-solid fa-gauge-high"
    };

    if (deviceClass && deviceClassMap[deviceClass]) return deviceClassMap[deviceClass];

    const domainMap = {
      binary_sensor: "fa-solid fa-circle-dot",
      sensor: "fa-solid fa-gauge",
      switch: "fa-solid fa-toggle-on",
      light: "fa-solid fa-lightbulb",
      climate: "fa-solid fa-temperature-half",
      lock: "fa-solid fa-lock",
      cover: "fa-solid fa-window-maximize",
      media_player: "fa-solid fa-tv",
      person: "fa-solid fa-person",
      device_tracker: "fa-solid fa-location-dot",
      automation: "fa-solid fa-robot",
      script: "fa-solid fa-scroll",
      scene: "fa-solid fa-palette",
      input_boolean: "fa-solid fa-toggle-on",
      input_number: "fa-solid fa-sliders",
      input_select: "fa-solid fa-list",
      vacuum: "fa-solid fa-robot",
      fan: "fa-solid fa-fan",
      camera: "fa-solid fa-camera",
      weather: "fa-solid fa-cloud-sun",
      alarm_control_panel: "fa-solid fa-shield",
      water_heater: "fa-solid fa-fire",
      number: "fa-solid fa-hashtag",
      button: "fa-solid fa-hand-pointer",
      update: "fa-solid fa-arrows-rotate",
      group: "fa-solid fa-layer-group"
    };

    return domainMap[domain] || "fa-solid fa-circle-info";
  }
});
