# CLAUDE.md — MMM-HomeAssistantStatusDashboard

## What this project is

A **MagicMirror²** module that displays a real-time Home Assistant entity status dashboard. It uses the **HA WebSocket API** (not polling) for instant state updates and supports visual alerting at tile, banner, and MM-Alert-module level.

## File map

| File | Role |
|---|---|
| [MMM-HomeAssistantStatusDashboard.js](MMM-HomeAssistantStatusDashboard.js) | Front-end MM module — DOM building, state diffing, alert logic |
| [node_helper.js](node_helper.js) | Node.js back-end — WebSocket lifecycle, HA auth, message dispatch |
| [MMM-HomeAssistantStatusDashboard.css](MMM-HomeAssistantStatusDashboard.css) | Glass-aesthetic styles (dark + light themes, animations) |
| [package.json](package.json) | Single runtime dependency: `ws` ^8 |
| [README.md](README.md) | Full user-facing docs including config reference |

## Architecture

```
MagicMirror renderer process
  └─ MMM-HomeAssistantStatusDashboard.js   (Module.register — browser-side)
       │  sendSocketNotification("HA_CONNECT", …)
       │  socketNotificationReceived(…)
       ▼
  node_helper.js   (NodeHelper.create — Node.js process)
       └─ WebSocket → Home Assistant /api/websocket
            auth_required → auth → auth_ok
            get_states (snapshot) + subscribe_events(state_changed)
```

Socket notifications flowing **front→back**: `HA_CONNECT`  
Socket notifications flowing **back→front**: `HA_CONNECTED`, `HA_DISCONNECTED`, `HA_STATES`, `HA_STATE_CHANGED`, `HA_ERROR`

## Key design decisions

- **No polling.** All updates come through the persistent WebSocket. `reconnectInterval` (default 10 s) handles drops.
- **Alert transitions only.** The `SHOW_ALERT` MM notification fires once per *transition into* alert state, not repeatedly while alerting. The comparison is `wasAlert && isAlert` guarded.
- **No auth retry.** `auth_invalid` stops reconnection — a bad token won't self-heal, so it's treated as terminal.
- **Portrait display** — the physical monitor is rotated 90°. The default `tilesPerRow` is 3 (not 4) to suit the narrower column width. Avoid changes that assume landscape proportions.
- **CSS class names are all prefixed `ha-`** to avoid collisions with other MM modules.
- **Font Awesome** — the module uses MagicMirror's own vendored `font-awesome.css` (currently FA 7 free) via `getStyles()`. No local `lib/fontawesome/` copy or symlink is needed.

## State colour logic (`_getStateClass`)

0. (Classification) `_getKind` decides `reading` vs `status`; see below
1. No state object → `ha-state-unavailable`
2. HA state `"unavailable"` / `"unknown"` → `ha-state-unavailable`
3. `_isAlertState` returns true → `ha-state-alert` (pulsing red tile + blinking dot)
3a. Reading kind → `ha-state-reading` (same blue as active; only an explicit non-empty `warnStates` match gives `ha-state-warn` first)
4. State in `activeStates` set → `ha-state-active` (blue glow)
5. State in `warnStates` set → `ha-state-warn` (amber)
6. Otherwise → `ha-state-inactive` (dimmed)

## Readings vs status (`_getKind`)

Per-entity `kind: "reading" | "status"` wins. Otherwise an entity is a reading when its live HA state has `unit_of_measurement`, `state_class` measurement/total/total_increasing, or a numeric state, AND the entity config has no `activeStates`, non-empty `warnStates`, or `alertWhen`. `alertAbove`/`alertBelow` are thresholds and do not make a status entity (radon is a reading with a threshold; its red alert still wins). Classification is at render time from the forwarded HA attributes (node_helper forwards full state objects). `kindCache` remembers the last kind so an unavailable sensor does not hop groups. Readings render in the `readingsGroup` (default "Readings"; `false`/`null` disables), placed per `groupOrder` else last, and are formatted with unit (`display_precision` if HA sends it, else one decimal with trailing `.0` trimmed).

## Alert trigger types (entity config)

| Field | Behaviour |
|---|---|
| `alertWhen` | `state === String(alertWhen)` |
| `alertAbove` | numeric state `> alertAbove` |
| `alertBelow` | numeric state `< alertBelow` |

`"unavailable"` and `"unknown"` states never trigger alerts regardless of config.

## Coding conventions

- Vanilla JS throughout — no build step, no bundler. Compatible with MagicMirror's Electron runtime.
- DOM built with `document.createElement` — no innerHTML.
- `/* global Module, Log, config */` comment at top of the front-end file suppresses linter warnings for MM globals.
- CSS animations use `@keyframes ha-*` naming. All class names use `ha-` prefix.
- Comments in code explain *why*, not *what*. Keep them sparse.

## Testing

Automated: `npm install && npm test` (jest) inside the module directory. Four suites (`jsdom` is a devDependency; jest's node environment has no DOM without it):
- `__tests__/node_helper.test.js` — WebSocket lifecycle, auth, reconnect/close handling, heartbeat, entity filtering (mocks `ws` and `logger`).
- `__tests__/node_helper.attributes.test.js` — state attributes (unit, state_class, device_class) pass through the helper intact.
- `__tests__/readings.test.js` — reading/status classification of the live entities, grouping/ordering, reading formatting, threshold alert transitions.
- `__tests__/module.helpers.test.js` — pure DOM/state helpers (`_isAlertState`, `_getStateClass`, `_formatState`, `_getDomainIcon`, `_isEntityHidden`, `_buildEntityGroups`, `_buildEntityTile`, `getDom`), plus `start()` config normalization. `jest.setup.js` stubs the MagicMirror browser globals and provides a jsdom `document` so DOM-building methods can run under Node.

Manual, for anything the suites can't cover (real HA auth, actual reconnect timing on the network):
1. Install in a real MagicMirror instance at `~/MagicMirror/modules/`
2. Add a config block to MagicMirror's `config.js` (see README for example)
3. Start MagicMirror and verify tiles, alerts, and reconnect behaviour manually

## Things to watch out for

- `this.msgId` is incremented for each WS message sent from `node_helper.js`. The `result` handler assumes the first `result` with an array is the `get_states` response — this is fine as long as no other array-returning commands are sent before it.
- `rejectUnauthorized: false` is set on the WebSocket to allow self-signed HA certs on local networks. Do not change this.
- `config.js` (MagicMirror's main config) contains the HA long-lived token — it must never be committed to a public repo.
