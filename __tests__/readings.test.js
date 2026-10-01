// Readings vs status classification, grouping, formatting and threshold alerts
let mod;
global.Module = { register: (_name, def) => { mod = def; } };
require("../MMM-HomeAssistantStatusDashboard.js");

const st = (state, attributes = {}) => ({ state, attributes });

// The entities from the live dashboard, with their live states
const LIVE = {
  "sensor.thermostat_1_outdoor_temperature": st("58.0", { unit_of_measurement: "°F", device_class: "temperature", state_class: "measurement" }),
  "sensor.thermostat_1_humidity": st("50.0", { unit_of_measurement: "%", device_class: "humidity", state_class: "measurement" }),
  "sensor.radon_level": st("1.8", { unit_of_measurement: "pCi/L", state_class: "measurement" }),
  "sensor.alert_level": st("Green"),
  "sensor.top_load_washer_current_status": st("power_off", { device_class: "enum" }),
  "sensor.dryer_current_status": st("power_off", { device_class: "enum" }),
  "sensor.cph50_charger_state": st("In Use"),
  "sensor.cph50_charging_status": st("Charging"),
  "binary_sensor.leak_detector_3": st("off", { device_class: "moisture" }),
  "lock.arter_front_door": st("locked"),
  "switch.pi_hole": st("on"),
  "light.kitchen_main_lights": st("on"),
  "climate.arter_home_zone_1": st("heat_cool", { temperature: 70 }),
  "person.nicole_arter": st("home"),
  "vacuum.robovac_x10_pro_omni": st("docked")
};

const ENTITIES = [
  { entity_id: "sensor.thermostat_1_outdoor_temperature", group: "Climate" },
  { entity_id: "sensor.thermostat_1_humidity", group: "Climate" },
  { entity_id: "sensor.radon_level", group: "Climate", alertAbove: 4, warnStates: [] },
  { entity_id: "sensor.alert_level", group: "Climate", warnStates: ["Yellow"], alertWhen: "Red" },
  { entity_id: "sensor.top_load_washer_current_status", group: "Appliances", activeStates: ["washing"] },
  { entity_id: "sensor.dryer_current_status", group: "Appliances", activeStates: ["running"] },
  { entity_id: "sensor.cph50_charger_state", group: "Appliances", activeStates: ["Charging"] },
  { entity_id: "sensor.cph50_charging_status", group: "Appliances", activeStates: ["Charging"] },
  { entity_id: "binary_sensor.leak_detector_3", group: "Security", alertWhen: "on" },
  { entity_id: "lock.arter_front_door", group: "Security", activeStates: ["locked"], alertWhen: "unlocked" },
  { entity_id: "switch.pi_hole", group: "Network", activeStates: ["on"] },
  { entity_id: "light.kitchen_main_lights", group: "Lights", activeStates: ["on"] },
  { entity_id: "climate.arter_home_zone_1", group: "Climate", activeStates: ["heat_cool"] },
  { entity_id: "person.nicole_arter", group: "People", activeStates: ["home"] },
  { entity_id: "vacuum.robovac_x10_pro_omni", group: "Appliances", activeStates: ["cleaning"] }
];

const READING_IDS = [
  "sensor.thermostat_1_outdoor_temperature",
  "sensor.thermostat_1_humidity",
  "sensor.radon_level"
];

function setup(configOverrides = {}, entities = ENTITIES, states = LIVE) {
  mod.config = Object.assign({
    entities,
    groupOrder: ["People", "Security", "Climate", "Lights", "Appliances", "Network"],
    tilesPerRow: 7,
    readingsGroup: "Readings",
    hideUnavailable: false
  }, configOverrides);
  mod.states = JSON.parse(JSON.stringify(states));
  mod.kindCache = {};
}

const groupNames = container =>
  [...container.querySelectorAll(".ha-group-header")].map(h => h.textContent);

const tileNames = (container, group) => {
  const g = [...container.querySelectorAll(".ha-group")].find(
    el => el.querySelector(".ha-group-header").textContent === group);
  return g ? [...g.querySelectorAll(".ha-tile-name")].map(n => n.title) : [];
};

// --- _getKind ---------------------------------------------------------------

describe("_getKind auto-classification of the live entities", () => {
  beforeEach(() => setup());

  test.each(READING_IDS)("%s is a reading", id => {
    const ec = ENTITIES.find(e => e.entity_id === id);
    expect(mod._getKind(ec, mod.states[id])).toBe("reading");
  });

  test.each(ENTITIES.filter(e => !READING_IDS.includes(e.entity_id)).map(e => e.entity_id))(
    "%s is a status entity", id => {
      const ec = ENTITIES.find(e => e.entity_id === id);
      expect(mod._getKind(ec, mod.states[id])).toBe("status");
    });

  test("radon with only alertAbove (no warnStates) is still a reading", () => {
    expect(mod._getKind({ entity_id: "sensor.radon_level", alertAbove: 4 }, LIVE["sensor.radon_level"])).toBe("reading");
  });

  test("alertBelow alone does not make a status entity", () => {
    expect(mod._getKind({ entity_id: "sensor.t", alertBelow: 10 }, st("20"))).toBe("reading");
  });

  test("a bare numeric state with no unit is a reading", () => {
    expect(mod._getKind({ entity_id: "sensor.n" }, st("42"))).toBe("reading");
  });

  test("a unit alone makes a reading even if the state is text-like", () => {
    expect(mod._getKind({ entity_id: "sensor.n" }, st("abc", { unit_of_measurement: "W" }))).toBe("reading");
  });

  test.each(["measurement", "total", "total_increasing"])("state_class %s makes a reading", sc => {
    expect(mod._getKind({ entity_id: "sensor.n" }, st("abc", { state_class: sc }))).toBe("reading");
  });

  test("activeStates, warnStates or alertWhen force status even with a unit", () => {
    const state = st("5", { unit_of_measurement: "W" });
    expect(mod._getKind({ entity_id: "sensor.n", activeStates: ["5"] }, state)).toBe("status");
    expect(mod._getKind({ entity_id: "sensor.n", warnStates: ["5"] }, state)).toBe("status");
    expect(mod._getKind({ entity_id: "sensor.n", alertWhen: "5" }, state)).toBe("status");
  });

  test("explicit kind wins in both directions", () => {
    expect(mod._getKind({ entity_id: "sensor.n", kind: "status" }, st("5", { unit_of_measurement: "W" }))).toBe("status");
    expect(mod._getKind({ entity_id: "sensor.n", kind: "reading", activeStates: ["x"] }, st("x"))).toBe("reading");
  });

  test("invalid kind value falls back to auto-classification", () => {
    expect(mod._getKind({ entity_id: "sensor.n", kind: "bogus" }, st("5"))).toBe("reading");
  });

  test("missing state is a status entity", () => {
    expect(mod._getKind({ entity_id: "sensor.never_seen" }, undefined)).toBe("status");
  });

  test("an unavailable sensor keeps its last known reading kind", () => {
    const ec = { entity_id: "sensor.n" };
    expect(mod._getKind(ec, st("5"))).toBe("reading");
    expect(mod._getKind(ec, st("unavailable"))).toBe("reading");
  });

  test("an unavailable sensor that still reports a unit is a reading", () => {
    expect(mod._getKind({ entity_id: "sensor.fresh" }, st("unavailable", { unit_of_measurement: "%" }))).toBe("reading");
  });

  test("a status entity that goes unavailable stays status", () => {
    const ec = { entity_id: "light.x" };
    expect(mod._getKind(ec, st("on"))).toBe("status");
    expect(mod._getKind(ec, st("unavailable"))).toBe("status");
  });

  test("works without a kindCache (start() not called)", () => {
    delete mod.kindCache;
    expect(mod._getKind({ entity_id: "sensor.n" }, st("5"))).toBe("reading");
  });
});

// --- _getStateClass ---------------------------------------------------------

describe("_getStateClass for readings", () => {
  beforeEach(() => setup());

  test("reading tiles are blue (ha-state-reading), not inactive", () => {
    READING_IDS.forEach(id => {
      const ec = ENTITIES.find(e => e.entity_id === id);
      expect(mod._getStateClass(ec, mod.states[id])).toBe("ha-state-reading");
    });
  });

  test("unavailable/unknown readings keep the unavailable style", () => {
    const ec = { entity_id: "sensor.n" };
    mod._getKind(ec, st("5"));
    expect(mod._getStateClass(ec, st("unavailable"))).toBe("ha-state-unavailable");
    expect(mod._getStateClass(ec, st("unknown"))).toBe("ha-state-unavailable");
  });

  test("default warn list does not hijack a reading", () => {
    expect(mod._getStateClass({ entity_id: "sensor.n", kind: "reading" }, st("pending"))).toBe("ha-state-reading");
  });

  test("explicit warnStates on a reading still warn", () => {
    const ec = { entity_id: "sensor.n", kind: "reading", warnStates: ["5"] };
    expect(mod._getStateClass(ec, st("5"))).toBe("ha-state-warn");
  });

  test("status semantics are unchanged: active, warn, alert, inactive", () => {
    const get = id => mod._getStateClass(ENTITIES.find(e => e.entity_id === id), mod.states[id]);
    expect(get("switch.pi_hole")).toBe("ha-state-active");
    expect(get("sensor.alert_level")).toBe("ha-state-inactive");
    expect(get("sensor.top_load_washer_current_status")).toBe("ha-state-inactive");
    expect(get("sensor.cph50_charging_status")).toBe("ha-state-active");
    expect(get("sensor.cph50_charger_state")).toBe("ha-state-inactive");
    mod.states["sensor.alert_level"] = st("Yellow");
    expect(get("sensor.alert_level")).toBe("ha-state-warn");
    mod.states["sensor.alert_level"] = st("Red");
    expect(get("sensor.alert_level")).toBe("ha-state-alert");
  });

  test("threshold breach turns a reading red", () => {
    const ec = ENTITIES.find(e => e.entity_id === "sensor.radon_level");
    expect(mod._getStateClass(ec, st("4.2", { unit_of_measurement: "pCi/L" }))).toBe("ha-state-alert");
    expect(mod._getStateClass(ec, st("4", { unit_of_measurement: "pCi/L" }))).toBe("ha-state-reading");
  });

  test("an alerting reading renders the alert tile with its dot", () => {
    const ec = ENTITIES.find(e => e.entity_id === "sensor.radon_level");
    const tile = mod._buildEntityTile(ec, st("4.2", { unit_of_measurement: "pCi/L" }));
    expect(tile.className).toMatch(/ha-state-alert/);
    expect(tile.className).toMatch(/ha-tile-alert/);
    expect(tile.querySelector(".ha-alert-dot")).not.toBeNull();
  });
});

// --- _formatState -----------------------------------------------------------

describe("reading formatting", () => {
  beforeEach(() => setup());
  const fmt = id => mod._formatState(ENTITIES.find(e => e.entity_id === id), mod.states[id]);

  test("58.0 degF -> 58 degF", () => {
    expect(fmt("sensor.thermostat_1_outdoor_temperature")).toBe("58 °F");
  });

  test("50.0 % -> 50 %", () => {
    expect(fmt("sensor.thermostat_1_humidity")).toBe("50 %");
  });

  test("1.8 pCi/L stays 1.8 pCi/L", () => {
    expect(fmt("sensor.radon_level")).toBe("1.8 pCi/L");
  });

  test("display_precision from HA is respected", () => {
    const state = st("21.456", { unit_of_measurement: "kWh", state_class: "total", display_precision: 2 });
    expect(mod._formatState({ entity_id: "sensor.e" }, state)).toBe("21.46 kWh");
    const whole = st("58.4", { unit_of_measurement: "W", state_class: "measurement", display_precision: 0 });
    expect(mod._formatState({ entity_id: "sensor.e" }, whole)).toBe("58 W");
    const padded = st("5", { unit_of_measurement: "V", state_class: "measurement", suggested_display_precision: 1 });
    expect(mod._formatState({ entity_id: "sensor.e" }, padded)).toBe("5.0 V");
  });

  test("invalid precision falls back to trimmed one-decimal rounding", () => {
    const state = st("3.04", { unit_of_measurement: "x", state_class: "measurement", display_precision: -1 });
    expect(mod._formatState({ entity_id: "sensor.e" }, state)).toBe("3 x");
  });

  test("config unit overrides the attribute unit", () => {
    expect(mod._formatState({ entity_id: "sensor.e", unit: "ppm" }, st("7.0"))).toBe("7 ppm");
  });

  test("a unitless numeric reading shows just the number", () => {
    expect(mod._formatState({ entity_id: "sensor.e" }, st("12.0"))).toBe("12");
  });

  test("status entities keep the existing text formatting", () => {
    expect(mod._formatState({ entity_id: "sensor.top_load_washer_current_status" }, LIVE["sensor.top_load_washer_current_status"])).toBe("Off");
    expect(mod._formatState({ entity_id: "sensor.alert_level" }, LIVE["sensor.alert_level"])).toBe("Green");
  });
});

// --- _buildEntityGroups -----------------------------------------------------

describe("readings grouping and ordering", () => {
  test("readings are pulled into one Readings group appended last", () => {
    setup();
    const c = mod._buildEntityGroups();
    expect(groupNames(c)).toEqual(["People", "Security", "Climate", "Lights", "Appliances", "Network", "Readings"]);
    expect(tileNames(c, "Readings")).toEqual(READING_IDS);
  });

  test("readings no longer render inside their configured group", () => {
    setup();
    const c = mod._buildEntityGroups();
    const climate = tileNames(c, "Climate");
    READING_IDS.forEach(id => expect(climate).not.toContain(id));
    expect(climate).toEqual(["sensor.alert_level", "climate.arter_home_zone_1"]);
  });

  test("Readings is placed per groupOrder when listed", () => {
    setup({ groupOrder: ["Readings", "People", "Security"] });
    const names = groupNames(mod._buildEntityGroups());
    expect(names.slice(0, 3)).toEqual(["Readings", "People", "Security"]);
  });

  test("Readings goes after unlisted groups too", () => {
    setup({ groupOrder: ["People"] });
    const names = groupNames(mod._buildEntityGroups());
    expect(names[0]).toBe("People");
    expect(names[names.length - 1]).toBe("Readings");
    expect(names.slice(1, -1)).toEqual([...names.slice(1, -1)].sort());
  });

  test("a custom readingsGroup name is used", () => {
    setup({ readingsGroup: "Sensors" });
    const names = groupNames(mod._buildEntityGroups());
    expect(names[names.length - 1]).toBe("Sensors");
    expect(names).not.toContain("Readings");
  });

  test.each([false, null, undefined, ""])("readingsGroup %p disables regrouping", value => {
    setup({ readingsGroup: value });
    const c = mod._buildEntityGroups();
    expect(groupNames(c)).not.toContain("Readings");
    expect(tileNames(c, "Climate")).toEqual(expect.arrayContaining(READING_IDS));
    // tiles are still blue even when not regrouped
    expect(c.querySelectorAll(".ha-state-reading").length).toBe(3);
  });

  test("explicit kind: status keeps a numeric entity in its own group", () => {
    const entities = ENTITIES.map(e => e.entity_id === "sensor.thermostat_1_humidity" ? { ...e, kind: "status" } : e);
    setup({}, entities);
    const c = mod._buildEntityGroups();
    expect(tileNames(c, "Readings")).not.toContain("sensor.thermostat_1_humidity");
    expect(tileNames(c, "Climate")).toContain("sensor.thermostat_1_humidity");
  });

  test("explicit kind: reading moves a text entity into Readings", () => {
    const entities = [{ entity_id: "sensor.alert_level", group: "Climate", kind: "reading" }];
    setup({}, entities);
    expect(tileNames(mod._buildEntityGroups(), "Readings")).toEqual(["sensor.alert_level"]);
  });

  test("Readings group is omitted when there are no readings", () => {
    setup({}, [ENTITIES[3], ENTITIES[9]]);
    expect(groupNames(mod._buildEntityGroups())).not.toContain("Readings");
  });

  test("hideUnavailable hides an offline reading and drops the empty Readings group", () => {
    const states = { ...LIVE };
    READING_IDS.forEach(id => { states[id] = st("unavailable"); });
    setup({ hideUnavailable: true }, ENTITIES, states);
    mod.kindCache = Object.fromEntries(READING_IDS.map(id => [id, "reading"]));
    const c = mod._buildEntityGroups();
    expect(groupNames(c)).not.toContain("Readings");
  });

  test("an offline reading stays in Readings when not hidden", () => {
    const states = { ...LIVE, "sensor.radon_level": st("unavailable") };
    setup({}, ENTITIES, states);
    mod.kindCache = { "sensor.radon_level": "reading" };
    const c = mod._buildEntityGroups();
    expect(tileNames(c, "Readings")).toContain("sensor.radon_level");
  });

  test("tilesPerRow is applied to the Readings grid", () => {
    setup({ tilesPerRow: 5 });
    const grids = [...mod._buildEntityGroups().querySelectorAll(".ha-entity-grid")];
    expect(grids[grids.length - 1].style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
  });

  test("non-array groupOrder does not throw", () => {
    setup({ groupOrder: undefined });
    expect(() => mod._buildEntityGroups()).not.toThrow();
  });
});

// --- alert transitions on a reading -----------------------------------------

describe("threshold alert on a reading", () => {
  const radon = { entity_id: "sensor.radon_level", group: "Climate", alertAbove: 4, warnStates: [] };
  const attrs = { unit_of_measurement: "pCi/L", state_class: "measurement" };

  beforeEach(() => {
    mod.config = { entities: [radon], showMmAlert: true, renderDebounce: 1000, animationSpeed: 0, readingsGroup: "Readings", groupOrder: [] };
    mod.entityIds = new Set([radon.entity_id]);
    mod.states = { "sensor.radon_level": st("1.8", attrs) };
    mod.sendNotification = jest.fn();
    mod._scheduleRender = jest.fn();
  });

  const change = value => mod.socketNotificationReceived("HA_STATE_CHANGED", {
    entity_id: radon.entity_id,
    new_state: st(value, attrs)
  });

  test("crossing the threshold fires SHOW_ALERT once, not on every update", () => {
    change("3.9");
    expect(mod.sendNotification).not.toHaveBeenCalled();
    change("4.3");
    expect(mod.sendNotification).toHaveBeenCalledTimes(1);
    expect(mod.sendNotification).toHaveBeenCalledWith("SHOW_ALERT", expect.objectContaining({
      message: expect.stringContaining("radon_level")
    }));
    change("4.6");
    change("5.0");
    expect(mod.sendNotification).toHaveBeenCalledTimes(1);
  });

  test("it fires again after dropping below and re-crossing", () => {
    change("4.3");
    change("2.0");
    change("4.4");
    expect(mod.sendNotification).toHaveBeenCalledTimes(2);
  });

  test("the alerting reading appears in the banner", () => {
    change("4.3");
    const banner = mod._buildAlertBanner();
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/4\.3 pCi\/L/);
  });

  test("a reading below threshold produces no banner", () => {
    expect(mod._buildAlertBanner()).toBeNull();
  });
});

// --- enum, strict numeric parsing, readingsGroup values ---------------------

describe("device_class enum", () => {
  beforeEach(() => setup());

  test("a numeric enum state is status, not a reading", () => {
    const state = st("2", { device_class: "enum" });
    expect(mod._getKind({ entity_id: "sensor.fan_speed" }, state)).toBe("status");
    expect(mod._getStateClass({ entity_id: "sensor.fan_speed" }, state)).toBe("ha-state-inactive");
  });

  test("explicit kind reading still wins for an enum", () => {
    expect(mod._getKind({ entity_id: "sensor.fan_speed", kind: "reading" }, st("2", { device_class: "enum" }))).toBe("reading");
  });
});

describe("strict numeric parsing shared by classification and formatting", () => {
  beforeEach(() => setup());

  test.each(["Infinity", "-Infinity", "0x1A", "1e400", "1,5", "12abc", ""])("%p is not a numeric reading", value => {
    expect(mod._parseFinite(value)).toBeNull();
    expect(mod._getKind({ entity_id: "sensor.n" }, st(value))).toBe("status");
  });

  test.each([["5", 5], ["-0.4", -0.4], [".5", 0.5], ["1e3", 1000], [" 7 ", 7]])("%p parses to %p", (value, expected) => {
    expect(mod._parseFinite(value)).toBe(expected);
  });

  test("a non-finite state with a unit renders as text, never 'Infinity W'", () => {
    const attrs = { unit_of_measurement: "W", state_class: "measurement" };
    expect(mod._formatState({ entity_id: "sensor.n" }, st("Infinity", attrs))).toBe("Infinity");
    expect(mod._formatState({ entity_id: "sensor.n" }, st("0x1A", attrs))).toBe("0x1A");
    expect(mod._formatState({ entity_id: "sensor.n" }, st("1e400", attrs))).toBe("1e400");
  });

  test("negative readings keep their sign", () => {
    expect(mod._formatState({ entity_id: "sensor.n" }, st("-3.46", { unit_of_measurement: "°F" }))).toBe("-3.5\u202f°F");
  });

  test("negative zero is normalised at precision 0 and by one-decimal rounding", () => {
    const attrs = { unit_of_measurement: "°F", state_class: "measurement", display_precision: 0 };
    expect(mod._formatState({ entity_id: "sensor.n" }, st("-0.4", attrs))).toBe("0\u202f°F");
    expect(mod._formatState({ entity_id: "sensor.n" }, st("-0.04", { unit_of_measurement: "°F" }))).toBe("0\u202f°F");
    expect(mod._formatReading(-0.4, { display_precision: 2 })).toBe("-0.40");
  });

  test("status-path formatting is unchanged", () => {
    const ec = { entity_id: "sensor.n", kind: "status" };
    expect(mod._formatState(ec, st("21.456", { unit_of_measurement: "°C" }))).toBe("21.5\u202f°C");
    expect(mod._formatState(ec, st("-3.46", { unit_of_measurement: "°C" }))).toBe("-3.5 °C");
  });
});

describe("readingsGroup value handling", () => {
  beforeEach(() => { setup(); mod.warnedReadingsGroup = false; mod.name = "MMM-Test"; });

  test("true means the default Readings group", () => {
    mod.config.readingsGroup = true;
    expect(mod._getReadingsGroup()).toBe("Readings");
  });

  test.each([false, null, "", "   "])("%p disables", value => {
    mod.config.readingsGroup = value;
    expect(mod._getReadingsGroup()).toBeNull();
  });

  test.each([5, {}, []])("non-string %p uses Readings and warns once", value => {
    const warn = jest.spyOn(global.Log, "warn").mockImplementation(() => {});
    mod.config.readingsGroup = value;
    expect(mod._getReadingsGroup()).toBe("Readings");
    expect(mod._getReadingsGroup()).toBe("Readings");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
