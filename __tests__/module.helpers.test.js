// Capture the module definition by overriding Module.register before require
let mod;
global.Module = { register: (_name, def) => { mod = def; } };
require("../MMM-HomeAssistantStatusDashboard.js");

// ─── _isAlertState ────────────────────────────────────────────────────────────

describe("_isAlertState", () => {
  test("returns false when state is null", () => {
    expect(mod._isAlertState({}, null)).toBe(false);
  });

  test("returns false for unavailable", () => {
    expect(mod._isAlertState({}, { state: "unavailable" })).toBe(false);
  });

  test("returns false for unknown", () => {
    expect(mod._isAlertState({}, { state: "unknown" })).toBe(false);
  });

  test("alertWhen matches → true", () => {
    expect(mod._isAlertState({ alertWhen: "on" }, { state: "on" })).toBe(true);
  });

  test("alertWhen does not match → false", () => {
    expect(mod._isAlertState({ alertWhen: "on" }, { state: "off" })).toBe(false);
  });

  test("alertWhen coerces to string — numeric value", () => {
    expect(mod._isAlertState({ alertWhen: 1 }, { state: "1" })).toBe(true);
  });

  test("alertAbove exceeded → true", () => {
    expect(mod._isAlertState({ alertAbove: 28 }, { state: "29" })).toBe(true);
  });

  test("alertAbove equal → false (not strictly above)", () => {
    expect(mod._isAlertState({ alertAbove: 28 }, { state: "28" })).toBe(false);
  });

  test("alertBelow triggered → true", () => {
    expect(mod._isAlertState({ alertBelow: 14 }, { state: "13.5" })).toBe(true);
  });

  test("alertBelow equal → false (not strictly below)", () => {
    expect(mod._isAlertState({ alertBelow: 14 }, { state: "14" })).toBe(false);
  });

  test("no alert config → false", () => {
    expect(mod._isAlertState({}, { state: "on" })).toBe(false);
  });

  test("non-numeric state with alertAbove → false", () => {
    expect(mod._isAlertState({ alertAbove: 5 }, { state: "hot" })).toBe(false);
  });
});

// ─── _getStateClass ───────────────────────────────────────────────────────────

describe("_getStateClass", () => {
  test("no state → unavailable", () => {
    expect(mod._getStateClass({}, null)).toBe("ha-state-unavailable");
  });

  test('"unavailable" → unavailable', () => {
    expect(mod._getStateClass({}, { state: "unavailable" })).toBe("ha-state-unavailable");
  });

  test('"unknown" → unavailable', () => {
    expect(mod._getStateClass({}, { state: "unknown" })).toBe("ha-state-unavailable");
  });

  test("alert condition → alert", () => {
    expect(mod._getStateClass({ alertWhen: "on" }, { state: "on" })).toBe("ha-state-alert");
  });

  test('"on" → active', () => {
    expect(mod._getStateClass({}, { state: "on" })).toBe("ha-state-active");
  });

  test('"home" → active', () => {
    expect(mod._getStateClass({}, { state: "home" })).toBe("ha-state-active");
  });

  test('"detected" → active', () => {
    expect(mod._getStateClass({}, { state: "detected" })).toBe("ha-state-active");
  });

  test('"opening" → warn', () => {
    expect(mod._getStateClass({}, { state: "opening" })).toBe("ha-state-warn");
  });

  test('"triggered" → warn', () => {
    expect(mod._getStateClass({}, { state: "triggered" })).toBe("ha-state-warn");
  });

  test('"off" → inactive', () => {
    expect(mod._getStateClass({}, { state: "off" })).toBe("ha-state-inactive");
  });

  test("unrecognised state → inactive", () => {
    expect(mod._getStateClass({}, { state: "idle" })).toBe("ha-state-inactive");
  });
});

// ─── _formatState ─────────────────────────────────────────────────────────────

describe("_formatState", () => {
  test("no state → N/A", () => {
    expect(mod._formatState({}, null)).toBe("N/A");
  });

  test('"unavailable" → N/A', () => {
    expect(mod._formatState({}, { state: "unavailable" })).toBe("N/A");
  });

  test('"unknown" → ?', () => {
    expect(mod._formatState({}, { state: "unknown" })).toBe("?");
  });

  test("decimal numeric with HA unit attribute", () => {
    const state = { state: "21.5", attributes: { unit_of_measurement: "°C" } };
    expect(mod._formatState({}, state)).toBe("21.5 °C");
  });

  test("integer numeric — no trailing decimal", () => {
    const state = { state: "22", attributes: { unit_of_measurement: "°C" } };
    expect(mod._formatState({}, state)).toBe("22 °C");
  });

  test("entity config unit overrides HA attribute", () => {
    const state = { state: "50", attributes: { unit_of_measurement: "%" } };
    expect(mod._formatState({ unit: "pct" }, state)).toBe("50 pct");
  });

  test("numeric with no unit → bare number", () => {
    expect(mod._formatState({}, { state: "42", attributes: {} })).toBe("42");
  });

  test("numeric zero", () => {
    expect(mod._formatState({}, { state: "0", attributes: {} })).toBe("0");
  });

  test("non-numeric state passed through verbatim", () => {
    expect(mod._formatState({}, { state: "heating", attributes: {} })).toBe("heating");
  });

  test("value rounded to 1 decimal place", () => {
    const state = { state: "21.456", attributes: { unit_of_measurement: "°C" } };
    expect(mod._formatState({}, state)).toBe("21.5 °C");
  });
});

  test("attribute shown when present", () => {
    const state = { state: "on", attributes: { effect: "Festive" } };
    expect(mod._formatState({ attribute: "effect" }, state)).toBe("Festive");
  });

  test("attribute falls back to state when key is absent", () => {
    const state = { state: "on", attributes: {} };
    expect(mod._formatState({ attribute: "effect" }, state)).toBe("on");
  });

  test("attribute falls back to state when value is empty string", () => {
    const state = { state: "on", attributes: { effect: "" } };
    expect(mod._formatState({ attribute: "effect" }, state)).toBe("on");
  });

  test("attribute falls back to state when value is null", () => {
    const state = { state: "on", attributes: { effect: null } };
    expect(mod._formatState({ attribute: "effect" }, state)).toBe("on");
  });

  test("attribute coerces non-string values to string", () => {
    const state = { state: "on", attributes: { color_temp: 370 } };
    expect(mod._formatState({ attribute: "color_temp" }, state)).toBe("370");
  });

// ─── _getDomainIcon ───────────────────────────────────────────────────────────

describe("_getDomainIcon", () => {
  test("device_class motion", () => {
    expect(mod._getDomainIcon("binary_sensor.x", { device_class: "motion" }))
      .toBe("fa-solid fa-person-walking");
  });

  test("device_class door", () => {
    expect(mod._getDomainIcon("binary_sensor.x", { device_class: "door" }))
      .toBe("fa-solid fa-door-open");
  });

  test("device_class temperature", () => {
    expect(mod._getDomainIcon("sensor.x", { device_class: "temperature" }))
      .toBe("fa-solid fa-temperature-half");
  });

  test("device_class battery", () => {
    expect(mod._getDomainIcon("sensor.x", { device_class: "battery" }))
      .toBe("fa-solid fa-battery-half");
  });

  test("binary_sensor domain without device_class", () => {
    expect(mod._getDomainIcon("binary_sensor.x", {}))
      .toBe("fa-solid fa-circle-dot");
  });

  test("sensor domain", () => {
    expect(mod._getDomainIcon("sensor.x", {}))
      .toBe("fa-solid fa-gauge");
  });

  test("light domain", () => {
    expect(mod._getDomainIcon("light.x", {}))
      .toBe("fa-solid fa-lightbulb");
  });

  test("switch domain", () => {
    expect(mod._getDomainIcon("switch.x", {}))
      .toBe("fa-solid fa-toggle-on");
  });

  test("unknown domain → circle-info fallback", () => {
    expect(mod._getDomainIcon("completely_unknown.x", {}))
      .toBe("fa-solid fa-circle-info");
  });

  test("null attributes → falls back to domain map", () => {
    expect(mod._getDomainIcon("switch.x", null))
      .toBe("fa-solid fa-toggle-on");
  });
});