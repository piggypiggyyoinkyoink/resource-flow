# Resource Flow: contributor and AI-agent context

Last reviewed: **2026-11-22**. This document describes the implementation in this repository, rather than promising complete compatibility with Machinations.

## 1. Read this first

Resource Flow is a local diagram editor and discrete-step resource-flow simulator inspired by Machinations. The repository directory is still called `machinations-offline`, but the application is named **Resource Flow**. It runs a small Node.js HTTP server and a browser application written in plain JavaScript ES modules, HTML, CSS, and SVG.

There is no framework, bundler, package manifest, dependency installation, database, authentication system, or build step. The Node server serves a fixed list of assets and optionally imports public Machinations diagrams. Editing, simulation, saving, and file imports happen in the browser. Public URL imports require internet access; exact preview capture additionally requires an installed Chromium-family browser.

### Documentation maintenance instruction

The user explicitly requested this file on 2026-11-22 and instructed that **after every future prompt in this chat, update `CONTEXT.md` instead of `README.md`**.

For subsequent work in this conversation:

1. Read the relevant sections before changing code; verify details against the source.
2. Complete the requested work and its appropriate checks.
3. Update this file during the same turn with changes to behavior, implementation, schemas, limitations, or testing.
4. Add a brief dated entry to the maintenance log at the end. If a prompt results in no code changes, record the relevant decision or finding without inventing implementation work.
5. Keep this a description of the current system: rewrite obsolete sections instead of accumulating contradictory historical notes.
6. Leave `README.md` alone unless the user explicitly requests an edit to it. It remains a user-facing introduction and may be less detailed than this document.

This file is contributor documentation, not a substitute for the user's instructions or any applicable `AGENTS.md`. No `AGENTS.md` was present in the repository when this document was created. Do not assume another agent automatically loads `CONTEXT.md`; point new contributors to it.

### Important contribution boundaries

- Preserve user changes already in the working tree. Run `git status --short` and inspect relevant diffs before editing.
- Treat native project JSON and imported unsupported values as compatibility contracts. Do not remove valid saved enum values just because the editor cannot create or simulate them.
- Keep editor state, persisted project data, and simulation state separate.
- Use the existing mutation/undo helpers for persistent edits. A bulk edit must be one undoable operation.
- Keep zoom and camera position unchanged during undo/redo.
- Keep connector labels attached to their actual path, including imported connectors that have never had their labels dragged.
- Preserve the distinction between a resource colour preset and a custom colour with the same hex value.
- Do not present unsupported features as functioning simulation options. Preserve imported unsupported settings, show their current choices in red, and offer supported replacements.
- Do not claim exact Machinations parity. Read the simulation tests before changing ordering, register evaluation, gates, converters, triggers, or end conditions.
- There is no deployment or publishing step in the normal development workflow.

## 2. Running the application

Run commands from the repository root, which contains `server.mjs`.

```sh
node --version
node server.mjs
```

Open `http://127.0.0.1:4177`. Stop the server with Ctrl+C. Do not open `public/index.html` directly using a `file:` URL: the application expects HTTP asset paths and ES-module loading.

The documented minimum is Node.js 20 or newer. The current code and tests were verified with **Node.js v24.14.0** on Windows. Modern browser APIs used include ES modules, `structuredClone`, `crypto.randomUUID`, `DOMParser`, pointer capture, `ResizeObserver`, native dialogs, and SVG geometry methods. Recent Chrome/Edge have been used for browser checks.

On Windows, `Launch.cmd` changes into its own directory, checks that `node` exists, and runs `node server.mjs --open`. The `--open` flag opens Explorer with the localhost URL only on Windows; it is optional.

### Environment variables

| Variable | Purpose | Default / behavior |
| --- | --- | --- |
| `PORT` | Port used when executing `server.mjs` as the entry point | `4177`; the server always binds to `127.0.0.1` |
| `RESOURCE_FLOW_BROWSER` | Preferred Chrome/Edge/Chromium executable for exact public-preview capture | Tried before platform-specific candidates; missing candidates are skipped |

PowerShell example:

```powershell
$env:PORT = '4178'
node server.mjs
```

POSIX shell example:

```sh
PORT=4178 node server.mjs
```

Changing the host name or port also changes the browser origin and therefore which localStorage data the editor sees. `localhost` and `127.0.0.1` do not share their stored project.

## 3. Repository map

| File | Responsibility |
| --- | --- |
| `CONTEXT.md` | This living technical and contribution guide; update it after future prompts in this chat |
| `README.md` | Existing user-facing overview; do not use it as the routine update target for this chat |
| `LICENSE` | MIT license, copyright 2026 piggypiggyyoinkyoink |
| `Launch.cmd` | Windows launcher and optional browser opening |
| `server.mjs` | Local HTTP server, static asset allowlist, public URL validation, public model fetch, preview capture integration |
| `rendered-layout.mjs` | Optional headless-browser discovery, DevTools pipe client, and extraction of rendered Machinations connector paths/colours |
| `public/index.html` | Static application shell, panel containers, SVG layers, dialogs, simulation controls |
| `public/style.css` | Dark theme, responsive layout, SVG appearance, selection/waypoint states, unsupported option styling |
| `public/app.mjs` | Browser entry point: state, persistence, rendering, Properties panel, interactions, imports, charts, forecasts, keyboard shortcuts, downloads |
| `public/model.mjs` | Plain project schema, factories, normalization, enums, palettes, example project, label-to-variable conversion |
| `public/sim.mjs` | Browser-independent `Simulation` engine and per-tick runtime state |
| `public/formula.mjs` | Expression tokenizer/parser, compiled closures, supported functions, comparison shorthand, seeded RNG |
| `public/geometry.mjs` | Route validation, imported route rendering, label projection, simplification, box enclosure, snapping |
| `public/colors.mjs` | Graphite default, imported colour parsing, preset references/migration, effective colour resolution and updates |
| `public/selection.mjs` | Pure selection toggling, shared-property comparison, cloned bulk assignments, filtered dropdown option descriptions |
| `public/import.mjs` | Native JSON, wrapped XML responses, Machinations XML and captured SVG/HTML import into the native model |
| `public/icons.mjs` | Trusted built-in SVG icon fragments and icon rendering helpers |
| `test/colors.test.mjs` | Colour parsing, defaults, binding, migration, persistence, ambiguous matching |
| `test/geometry.test.mjs` | Path projection, imported label migration, route persistence, snapping and selection geometry |
| `test/selection.test.mjs` | Ctrl-click selection, matching properties, cloned arrays, saved colours, unsupported menu filtering and preservation |
| `test/sim.test.mjs` | Formula evaluation, simulation behavior/order, random seeds, and URL validation |
| `.gitignore` | Currently ignores `*.txt`; remember this when creating fixtures or documentation |

There is no `package.json`, `node_modules` requirement, `npm test`, CI workflow, checked-in browser automation suite, generated production bundle, or third-party charting library. Add a new browser-served file to the explicit `files` map in `server.mjs`; merely creating a file under `public/` does not make it available over HTTP.

### Dependency directions

- `app.mjs` imports the model, simulator, formulas, geometry, import, icons, selection and colour utilities.
- `sim.mjs` imports only the formula engine and model helpers; it must remain usable in Node without a DOM.
- `model.mjs` imports geometry normalization and colour normalization; it is also DOM-independent.
- `import.mjs` imports model/colour helpers and uses browser DOM/SVG APIs. Its XML/SVG paths require a DOM environment.
- `geometry.mjs` does not create a DOM. Some functions accept an SVG-path-like object exposing `getTotalLength()` and `getPointAtLength()`; Node tests provide lightweight equivalents.
- `server.mjs` imports the optional preview helper. Importing the module does not start a listener; executing it directly does.
- `rendered-layout.mjs` itself runs in Node, but serializes `previewPaths` for execution inside the remote preview browser. That function must not depend on inaccessible Node closures or module imports.

## 4. Data and state boundaries

### Persisted project

The project is a JSON-serializable object. It contains diagram configuration, not simulation history or DOM references.

| Root field | Meaning / normalization |
| --- | --- |
| `version` | Currently emitted as `1`; normalization rebuilds the current schema rather than dispatching a versioned migration chain |
| `title` | Diagram name; blank factory default is `Untitled diagram` |
| `steps` | UI/forecast run limit, default `30`, normalized to an integer from `1` through `9999` |
| `resources` | Array of `{id, name, color}`; `color` is a six-digit hex colour |
| `nodes` | Array of node configurations |
| `edges` | Array of resource-flow or state-link configurations |
| `variables` | Array of `{name, formula}` parameters |
| `warnings` | Import/compatibility warnings carried into simulation issues |
| `origin` | Imported source URL or an empty string after normalization; `blank()` initially omits it |

The fallback resource ID is the literal string **`default`**, exported as `fallback`. `blank()` includes this resource. `normalize()` inserts it if missing. The UI does not allow deleting it.

Node IDs and edge IDs share one uniqueness namespace. Resource IDs have a separate uniqueness check. Factory-generated component IDs use a prefix and the first 12 characters of `crypto.randomUUID()`; these are identifiers, not full UUIDs. Prefer explicit IDs in tests.

### Node fields

All nodes carry the broad common schema even when a field is irrelevant to their type. Properties only shows relevant fields.

| Field(s) | Meaning / factory default |
| --- | --- |
| `id`, `type`, `label` | Component identity, enum type, and visible label |
| `x`, `y` | Node center in world coordinates, default `0, 0` |
| `labelOffset` | Optional `{x,y}` caption offset, especially for imported Registers; normalized independently |
| `color`, `colorResource` | Custom/cached hex colour and optional appearance-preset resource ID; default `''`, `''` |
| `resource` | Produced/primary resource ID, default `default`; distinct from the appearance preset |
| `trigger` | `passive`, `auto`, `click`, `enable`, `start`, or imported `agent` |
| `direction` | `push` or `pull`; Source, Delay and Queue factories default to `push`, other factories to `pull` |
| `all` | All-or-nothing transfers, default `false` |
| `initial` | Initial amount or Register value expression, default `'0'` |
| `initialResources` | Optional Pool inventory entries `{resource, value}`; when nonempty these replace the single `resource`/`initial` initialization path |
| `capacity` | Capacity expression; blank means unlimited; engine also accepts `'-1'` as unlimited |
| `min`, `max` | Optional numeric bounds expressed as formulas |
| `formula` | Register/End expression or Delay/Queue fallback expression, default `''` |
| `condition` | Optional activation/enablement condition, default `''` |
| `overflow` | `block` or `sink`, default `block` |
| `distribution` | Gate routing: `deterministic` or `random`, default `deterministic` |
| `conversion` | Converter behavior: `single` or `multiple`, default `single` |
| `resourceFilter` | Accepted resource ID array, default `[]`; the current Properties control edits the first filter as a single-resource selection |
| `stepValue` | Interactive Register increment expression, default `'1'` |
| `ignoreDisabled` | Converter input behavior, default `true` |
| `note` | User context, default `''` |

Known node type IDs are `source`, `pool`, `sink`, `gate`, `converter`, `register`, `delay`, `queue`, `end`, `trader`, `text`, and `unknown`.

**Factory versus loader distinction:** `makeNode('source')` defaults its trigger to `auto`; normalization of a raw node with a missing/invalid trigger uses `passive`. Likewise normalization supplies its own direction fallbacks. Build programmatic test fixtures with the factories rather than assuming a minimal raw object acquires every factory behavior unchanged. Factories accept overrides and are not full input validators.

### Edge fields

| Field(s) | Meaning / default |
| --- | --- |
| `id`, `type` | Identity and `flow` or `state`; invalid raw edge types normalize to `flow` |
| `source`, `target` | IDs of components; normal resource flows join nodes, state links can attach to connections |
| `label` | Optional descriptive label, default `''`; the canvas pill normally displays `edgeSummary()` behavior/formula text |
| `color`, `colorResource` | State link appearance and resource-preset reference; default empty |
| `formula` | Flow amount or state behavior expression; factory defaults to `'1'` for flows, `'> 0'` for states |
| `condition` | Optional connection condition |
| `mode` | State mode, default `enable`; also present on flows and used in gate routing decisions |
| `triggerOn` | State trigger subtype: `change`, `chance`, `gain`, `loss`, or `failed`; meaningful in trigger mode |
| `chanceAmount` | Flow amount when a percentage chance succeeds, default `'1'` |
| `interval` | Transfer interval expression, default `'1'` |
| `transfer` | `interval` or imported `instant`; default `interval`; `instant` currently has no separate engine implementation |
| `decimals` | Allow noninteger transfer amounts, default `false` |
| `min`, `max` | Optional bounds on rates |
| `resource` | Optional resource filter; `''` means any resource |
| `shuffle` | Randomize resource-type allocation order, default `false` |
| `bend` | Native quadratic-curve bend, default `0` |
| `labelPosition` | Normalized visible-path arc-length fraction `0..1`, or `null` when no explicit position exists |
| `route` | Optional imported/edited route structure; factory may omit it, normalization produces `null` if absent |
| `note` | User context |

State modes are `enable`, `trigger`, `triggerIf`, `input`, `add`, `multiply`, `overwrite`, `split`, and imported `unsupported`.

`makeEdge()` migrates legacy `reverse` triggers to `mode:'trigger', triggerOn:'failed'`. It also infers missing trigger subtypes from legacy formulas, converts percentage-style trigger formulas to numeric strings, uses `'*'` for non-chance triggers, and clears the formula for overwrite mode. Preserve these migrations when changing defaults.

Normalization rejects missing endpoints, duplicate/missing component IDs, duplicate/missing resource IDs, and oversized node/edge arrays. It filters invalid resource references and rebuilds supported fields. Unknown extra JSON fields are generally dropped; it is not a lossless raw-Machinations storage format. Endpoint existence is validated more broadly than semantic endpoint-type correctness, so callers must still construct sensible flow/state relationships.

### Route structure

```js
{
  routing: 'straight', // or 'orthogonal'
  points: [{x: 200, y: 100}], // interior world-coordinate waypoints
  label: {x: 240, y: 100}, // optional legacy absolute label coordinate
  rendered: { // optional exact path from a public preview
    d: 'M 128 100 L 472 100',
    source: {x: 100, y: 100},
    target: {x: 500, y: 100},
    center: {x: 300, y: 100},
    end: {x: 472, y: 100},
    angle: 0,
    bounds: [{x: 128, y: 100}, {x: 472, y: 100}]
  }
}
```

`normalizeRoute()` validates finite points, filters invalid waypoint entries, restricts SVG path text to supported path-command characters, and only retains a structurally valid rendered path. Exact preview geometry is reused only while both endpoint anchor coordinates match the captured anchors. Otherwise routing falls back to stored points.

### Transient browser state

`app.mjs` owns module-local variables, not global window properties:

| State | Purpose |
| --- | --- |
| `project` | Current persisted model |
| `selected` | Single selection, multiple selection, resource, parameter, or null |
| `tool`, `from` | Active tool and partially selected connector origin |
| `view` | `{x,y,scale}` camera; separate from project history |
| `drag`, `alignmentGuides` | Active pointer gesture and visual guides |
| `undo`, `redo` | Project snapshots, not simulation or view snapshots |
| `waypointCache`, `edgeLayoutCache` | Derived geometry caches |
| `sim`, `timer` | Current simulation and play-loop timeout |
| `preview` | Separate chart-only example history on initial demo startup |
| `chartVisible`, `showAllSeries` | Plot visibility overrides and legend filter |
| `chartVisible` values | Explicit booleans; absence means use the current default series set |
| `importTask`, `forecastTask` | Import abort controller / forecast cancellation state |

Seed, speed, selection, camera, history, and chart controls are not saved as project configuration. The HTML seed input starts **blank**. `Simulation` also defaults to an unseeded run when the constructor seed is omitted.

## 5. Browser startup, edits, and persistence

1. `app.mjs` reads localStorage key **`resource-flow-project-v1`** and calls `normalize()`.
2. If storage is absent or invalid, it loads `example()` and enables demo mode. An invalid saved value is caught rather than crashing startup.
3. It creates a fresh live simulator. For the initial example only, it also runs a separate 12-step simulation to populate the example chart preview; the live simulation remains at step zero.
4. It renders tools, sidebar, graph, inspector, simulation/chart, and camera transform.
5. An animation-frame callback fits the diagram. `ResizeObserver` refreshes the chart when its container changes.

### Persistent edit contract

`change(mutator, {preserveSim=false})`:

1. Records `structuredClone(project)` for undo and clears redo.
2. Applies the mutation.
3. Resets simulation unless `preserveSim` is true.
4. Saves project JSON to localStorage.
5. Calls `renderAll()`.

`record()` caps undo history at 60 snapshots. Use one `change()` for one user action, especially bulk edits. Assign arrays/objects independently to each object; `setProperty()` clones its value per target to avoid aliased inventories/filter arrays.

Geometry drags are a separate transaction path: they capture a `before` snapshot when movement crosses a four-screen-pixel threshold, update/render during movement, and record/save once on completion. Cancel restores coordinates/routes/label positions and the prior selection. Geometry drags preserve the running simulation state; do not accidentally rerun formulas for every mouse move.

`restore()` handles undo and redo, clears waypoint caches and selection, resets the active tool/simulation, saves, and rerenders. It **does not call `fit()`** or replace `view`, so zoom/pan survive. Undoing an appearance edit still resets simulation because `restore()` always does so.

`load()` handles imports, New, and the example loader. It is an undoable project replacement, clears geometry/plot selection caches, resets the legend to Pools only, and explicitly fits the new diagram. A successful import replaces the localStorage project; undo exists only in that browser session, so export important projects first.

`saveLocal()` catches storage failures, changes the status text, and asks the user to use Save file. There is no server-side persistence.

### Downloads

- Save file downloads the project as formatted JSON through an object URL.
- CSV exports the actual simulation's aggregate snapshot values for every recorded graphable node, not just visible series, and not individual resource stacks.
- CSV headers escape quotes and prefix potentially spreadsheet-executable labels with an apostrophe.
- The initial example chart preview is separate from CSV/live history; CSV remains disabled until the live simulation advances.
- Download file names are sanitized from the project title. Object URLs are revoked after use.

## 6. Editor rendering and interactions

### DOM and SVG contract

The main SVG is `#diagram`. `#graph` carries `translate(view.x view.y) scale(view.scale)` and contains layers `#edges`, `#nodes`, `#alignment-guides`, `#waypoint-handles`, and `#selection-area`. Layer order matters for hit testing and overlays.

Node/edge groups have `data-kind`, `data-id`, keyboard focusability and accessible labels. Important selectors used by rendering, interaction code and browser checks include:

- `.wire`: visible connector SVG path; `.wire-hit`: transparent larger hit target.
- `.tip`: arrowhead.
- `[data-label]`: connector label group. Old historical code used `data-bend`; the current label gesture does not bend the connector.
- `[data-waypoint]`, `[data-insert-waypoint]`, `data-edge`: editable handle identities.
- `.node-bg`, `.shape`, `.type-symbol`, `.count`, `.caption`: node rendering parts.
- `#properties`: rebuilt Properties panel.
- `#legend button[title]`: graph series choices; `#show-all-series`: legend filter.
- `#import-dialog`, `#import-text`, `#paste-import`, `#url-form`, `#import-url`, `#import-error`: import UI.
- `#seed`, `#step`, `#play`, `#reset`, `#forecast-dialog`, `#forecast-form`, `#forecast-count`, `#forecast-result`: simulation/forecast UI.

`renderGraph()` rebuilds the SVG nodes/edges with `replaceChildren()`. Do not keep assuming a previously queried child remains attached across a render. Rendering recovers focus for selected component groups where possible. Icons are trusted built-in fragments; imported user labels use text content rather than arbitrary `innerHTML`.

### Selection and bulk Properties

- Single component selection: `{kind:'node'|'edge', id}`.
- Multiple selection: `{kind:'multiple', items:[{kind,id}, ...]}`.
- Resource selections use `kind:'resource'`; parameters use `kind:'parameter'` with an array index.
- `selectionItems()` exposes only node/edge items. `setSelection()` reduces zero/one/many items to the corresponding shape.
- Ctrl+left-click or Cmd+click toggles component membership without starting a drag or firing an interactive node. This also works on connector handles.
- Dragging empty canvas makes a marquee. A component's full bounding box must be enclosed; a connector is selected through its label bounds, not by enclosing its entire path.
- Dragging a node already in the selection moves the selected node group.
- A normal click replaces selection. Deleting components also recursively removes incident connections and state links that refer to removed connections.

`renderInspector()` enables bulk editing only when every selected item has the same category (`node` or `edge`) and the same `.type`. State links of differing `.mode` still share the `state` category, but mode-dependent fields are hidden unless their controlling values agree.

`fields(items)` produces `common`, `set`, `edit`, `field`, `menu`, and `flag` helpers. `commonProperty()` compares `JSON.stringify` values, so separate arrays with identical ordered contents compare equal. This is structural equality for the normalized model, not a general unordered-object comparator.

Only shared values are editable. Differing labels/formulas/etc. are hidden, not replaced by blanks that could accidentally overwrite them. Custom inventory controls update the corresponding entry in every matching inventory. State-mode changes apply their dependent formula defaults and trigger subtype changes to every selected edge inside one transaction. Live values and single-node queue actions are not presented as one misleading aggregate value for a group.

Changing state mode resets formula defaults: `trigger -> '*'`, `input -> 'a'`, `enable/triggerIf -> '> 0'`, `add -> '+1'`, `multiply -> '10%'`, `split -> '1'`, otherwise empty. Trigger mode defaults `triggerOn` to `change`; other modes remove it. Changing trigger subtype sets its formula to `'100'` for chance or `'*'` otherwise. These are explicit UI transitions; merely displaying imported settings must not apply these defaults.

### Unsupported dropdown options

The `unsupportedOptions` map in `app.mjs` currently marks:

| Setting key | Unsupported values preserved for existing objects |
| --- | --- |
| `trigger` | `agent` |
| `mode` | `unsupported` |
| `type` | `trader`, `unknown` |
| `transfer` | `instant` |

`editorOptions()` filters unavailable choices out unless a choice equals the current value. `selectField()` marks those current options with `.unsupported-option`, marks the selected control `.unsupported-value`, and adds an unsupported label when needed. CSS uses the danger/red colour for both the option and the closed control; supported alternatives explicitly retain normal text colour.

Filtering is scoped to the specific setting. A resource ID named `agent` or an endpoint ID named `unsupported` must remain available in unrelated menus. The import/model enums are deliberately broader than the offered editor choices. Do not filter them out of `normalize()` or the importer. Once a user switches to a supported value, the old unavailable value disappears from that object's menu; undo can restore it. Matching unsupported bulk values behave the same way. `split` is implemented and must stay selectable.

### Camera and gestures

Screen positions are converted through `localPoint()` and `world()`. Zoom is cursor-anchored, clamped to `0.04..4`; explicit fit uses its own range/diagram padding. Node snapping uses a tolerance of seven screen pixels converted to world units; waypoint snapping uses eight. Guide/handle sizes compensate for zoom.

| Input | Behavior |
| --- | --- |
| `V` | Select tool |
| `H` | Pan tool |
| Space + drag, middle-button drag | Temporary pan |
| Mouse wheel | Zoom around cursor |
| `F` | Fit diagram |
| Ctrl/Cmd+click | Add/remove an object from selection |
| Alt during node/waypoint placement or drag | Bypass alignment/right-angle snapping |
| Drag connector label | Slide its center along its existing path |
| Drag insertion handle | Add a waypoint |
| Drag waypoint | Reposition it |
| Double-click a waypoint, or Delete/Backspace on a focused waypoint | Remove the waypoint |
| Delete/Backspace on canvas | Delete selection and dependent connections |
| Ctrl/Cmd+Z | Undo without moving camera |
| Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y | Redo without moving camera |
| Ctrl/Cmd+S | Download project JSON |
| Escape | Cancel active drag/tool/partial connection as applicable |
| Enter/Space on a focused component | Activate its normal graph-click behavior |

Global shortcuts intentionally ignore events originating in `input`, `textarea`, `select`, or `button`, and are suppressed while a dialog is open. Browser automation may need to blur a form control before testing canvas shortcuts. Window blur cancels a drag and releases temporary pan state.

## 7. Geometry and connector labels

`edgeLayout()` builds node anchors, recursively resolves edge endpoints that refer to other connections, and caches derived shapes. A connector-to-connector anchor is the other edge's current label/mid point. A recursion guard avoids infinitely resolving cyclic edge references; invalid/cyclic geometry can fail to produce a drawable shape even when IDs exist.

For native connectors it generates a quadratic SVG path, trims endpoints toward the control point, and handles self-loops with a raised control point. For imported/edited routes it delegates to `importedEdgeShape()`.

Key geometry exports:

| Helper | Purpose |
| --- | --- |
| `point`, `normalizeRoute` | Validate saved finite points and route data |
| `routePoints` | Expand explicit routing, including implicit orthogonal corners, and remove consecutive duplicate points |
| `importedEdgeShape` | Reuse a valid matching exact preview, otherwise build a trimmed polyline and compute label/end/arrow geometry |
| `closestPathPosition` | Find nearest position on the actual SVG path, returning normalized arc-length fraction |
| `edgeLabelPoint` | Convert legacy imported absolute label coordinates once, store their fraction, and evaluate the current path at that position |
| `containsBox` | Full enclosure test for marquee selection |
| `simplifyPoints` | Iterative distance-based path simplification preserving significant bends |
| `straightenCorners` | Recover sharp orthogonal bends from sampled rounded paths |
| `snapAlignment` | Axis alignment and guide geometry for a moving point/group |
| `snapWaypoint` | Adjacent-axis alignment and near-right-angle snapping, including rotated right angles |

### Label invariant

`labelPosition` is a fraction of **arc length**, not a quadratic-curve parameter and not an absolute coordinate. Projection samples the entire actual path (at most 1024 divisions), then refines around the nearest sample. It handles straight lines, routed bends, rounded/curved imported paths, and self-loops; endpoint clamping follows from the allowed length range.

`remember()` in `edgeLayout()` calls `edgeLabelPoint()` for existing fractions **or legacy `route.label` coordinates**. This eager migration is essential: an imported label must start following endpoint/waypoint edits without first being manually dragged. This is an intentional model mutation during otherwise derived rendering. Removing it recreates the historical imported-label bug.

`editablePoints()` uses saved route points when possible. For an exact preview/native curve, it samples the live SVG path, simplifies it, and straightens small rounded corners. `editRoute()` converts the edited geometry to straight interior points and clears `bend`; it preserves legacy label data while the normalized label fraction remains authoritative.

When both endpoints move together, stored route points move with them. Selected labels on other connections project their proposed positions onto those connections rather than dragging the paths freely. Moving a single endpoint recomputes the path while the label retains its fraction. Reconnecting through Properties clears the old route.

Editing a captured rounded/native curve may convert its representation to an approximated polyline. Exact imported paths are not guaranteed after geometry edits. Label centers can reach endpoints; there is no additional inset based on label width to prevent overlap with an arrow or node.

## 8. Appearance and resource colour presets

`stateLinkColor` in `colors.mjs` is **`#7b818a`**, graphite grey. The same constant is used as the Register default. A Register's hidden production resource field must not override its default appearance; use `colorResource` to choose a resource appearance preset explicitly.

- `colorResource` identifies a resource preset by **resource ID**, not by hex string or resource name.
- `color` is the custom value or cached current preset value.
- `componentColor()` prefers a live matching resource reference, then `color`, then the supplied default.
- `setColorPreset()` stores the reference and current resource colour for every selected object.
- `setCustomColor()` clears the preset reference, including when the chosen hex happens to equal a resource colour. Default colour clears both fields.
- `setResourceColor()` updates the resource and cached colours of all linked nodes/edges; custom colours remain independent.
- Deleting a resource first converts bound appearances to custom colours using their last effective colour. Undo restores the bindings.
- Preset menu values are `resource:<id>` to avoid collisions with `custom` or duplicate hex colours.
- `normalizeAppearance()` restores valid references, refreshes stale caches, and falls back to saved colours if a resource is missing. Older Register/State link files that lack `colorResource` can infer a preset only if their saved colour has exactly one matching resource. Explicit custom values and ambiguous matches are not rebound.
- Colour changes use `preserveSim:true`; choosing colours does not change resource ownership/filtering or reroll the simulation.

Resource-capable node colours generally follow their assigned/accepted resource. Flows use their source's resource tint. State links use their appearance colour for path/arrow and derived pill colours. Registers use `--node-tint`; state/flow paths use `--edge-tint`. Chart colours are computed separately from resource assignments/palette and currently do not mirror every custom Register appearance.

`importedColor()` accepts six-/three-digit hex and supported `rgb`/`rgba` syntax, converting to six-digit hex. Fully transparent/invalid strokes are rejected; nonzero alpha is not retained as a separate appearance channel. General model colour validation remains six-digit hex.

## 9. Simulation engine

### Public API and runtime state

```js
import {blank, makeNode, makeEdge} from './public/model.mjs';
import {Simulation} from './public/sim.mjs';

const project = blank('Small test');
project.nodes = [
  makeNode('source', {id: 's', label: 'Source'}),
  makeNode('pool', {id: 'p', label: 'Pool'}),
];
project.edges = [makeEdge('flow', 's', 'p', {id: 'f', formula: '3'})];

const run = new Simulation(project, 'repeatable-test');
run.advance();
run.advance();
console.log(run.value('p')); // 6
console.log(run.history.at(-1).step); // 2
```

The example is a standalone ES-module program run from the repository root. `Simulation` assumes a valid/factory-built model; use `normalize()` for untrusted raw objects. It references project configuration but keeps stocks, values and events in its own maps.

| API / property | Meaning |
| --- | --- |
| `new Simulation(project, seed=null, {retainHistory=true}={})` | Initialize runtime and step-zero snapshot |
| `advance()` | Execute one tick and return its snapshot; if already ended, return the latest snapshot |
| `value(id, resource='')` | Register value, held stock total/type quantity, or current/previous connection runtime |
| `queueClick(id, amount=1)` | Queue an interactive node action/direction for the next tick |
| `step` | Current tick number |
| `ended` | Empty or the label of the End Condition that stopped the run |
| `issues` | Set of import, expression, cycle, or unsupported-feature warnings |
| `history` | Snapshots; with `retainHistory:false` only the latest one is retained in slot zero |
| `activeEdges`, `edgeOverwrites`, `disabledRegisterOutputs` | Derived information used by canvas styling/live formula pills |
| `events`, `activity` | Transfers and node activity for the current tick, including resource-specific gain/loss and failures |

Important map groups are `nodes/edges/flow/states` and incoming/outgoing/control indexes; `stocks`, `registers`, `buffer`; `runtime/previousRuntime`; `nameScope/nameSources/base`; `registerInputs/lastModifiers/overwrittenRegisters`; `available/delivered`; and `pending/clicks/triggerAttempts/enabledBefore`.

`snapshot()` emits `{step, values, resources}`. `values` includes only Pools, Converters, Delays, Queues and Registers. `resources` stores resource-type breakdowns for stock-holding nodes. Values are cleaned to 12 significant digits; tiny stock remnants below the engine's `1e-9` threshold are removed.

The engine itself does not stop at `project.steps`. The UI and forecast loops enforce that run limit. Direct callers must apply their own step limit.

### Randomness contract

`null`, omitted seeds, empty strings, and whitespace-only seeds use `Math.random` directly. Nonempty seeds, including numeric/string zero, use `seeded(seed)`. There is no hidden deterministic fallback for a blank UI input. All stochastic formulas, dice, random distribution and shuffle paths should use `this.rng`, never introduce an unrelated RNG inside an engine branch.

`seeded()` hashes the string seed with integer operations and returns a repeatable 32-bit-generator closure. This is application reproducibility, not Machinations' original generator or cryptographic randomness. The same seed reproduces results only with the same model, actions and evaluation order.

### Tick order: preserve this when changing the engine

`advance()` currently performs these phases:

1. Return the last snapshot immediately if the run has ended; otherwise increment `step`.
2. Clear tick-specific overwrite state, move current runtimes into `previousRuntime`, and reset current runtimes.
3. Update `step`/`time` scope entries and evaluate project variables.
4. Reset activity, rate cache, edge highlighting, transfer events and trigger-attempt tracking.
5. Refresh names, evaluate Registers, apply state modifiers/overwrites, and refresh names again.
6. Copy stocks into the tick's `available` reservations view; compute node/flow enablement and disabled Register outputs.
7. Move prior `pending` actions into a local set and create the next tick's pending set.
8. Check end conditions before actions; if still running, execute `runActions()`.
9. If not ended, refresh names, reevaluate only changed/passive Registers, process state triggers, and check end conditions again.
10. Clear queued manual clicks, take a snapshot, and append/replace history according to `retainHistory`.

`runActions()` chooses enabled auto/start/newly-enabled/click/pending actions. It processes **Sinks first**, then due Delay/Queue releases, then other active nodes. It retries enabled Converters with newly delivered inputs until no more same-step work occurs or a bound is reached.

End checks also happen inside transfers, gate handling, buffer releases, and converter stages. Lethal damage must stop later regeneration/heals/conversion output in the same step. Moving checks only to the end of a tick breaks several existing regressions. Pending ordinary trigger actions generally execute on a subsequent tick, while triggering an End Condition can stop immediately.

### Stocks, rates, transfers and reservations

- Stock-holding types are Pool, Converter, Delay and Queue. Sources mint resources; Sinks consume them; Gates route arrivals without retaining normal stocks.
- `due()` uses `step % max(1, floor(interval))`.
- `rate()` supports amount formulas, dice, percent-chance flows, `all`, bounds, rounding, and state modifiers. Rates without `.runtime` references are cached within a tick so repeated planning does not reroll them. `.runtime` formulas are reevaluated as transfers change runtimes.
- Flow percentage suffixes use `chanceAmount` on success. Gate weights use percentage/numeric values as weights instead of ordinary chance flows.
- `all` requires a finite existing source stock; it is invalid for a minting Source and produces an issue.
- `plan()` reserves source quantities and destination capacity across the requested edge group. All-or-nothing planning returns no moves when the full request cannot be satisfied.
- `commit()` debits stocks, records runtime/events/activity, delivers resources, and checks end conditions after each transfer.
- Regular stock availability starts as a tick snapshot. Newly received resources do not automatically enable arbitrary same-step Pool chains; Gate recursion and Converter delivery have explicit additional handling.
- Capacity limits accepted stock. `overflow:'sink'` permits an incoming transfer whose excess is discarded. Edge and target filters restrict resource types.
- Resource allocation can be shuffled through the simulation RNG. Ordinary rates round unless `decimals` is enabled.
- `transfer:'instant'` is retained for compatibility but does not currently select a separate instant-transfer algorithm.

### Registers, scopes and feedback

`refreshNames()` exposes node labels where usable, snake-case names, `<name>.runtime`, generated `n_<sanitized-id>` names, and flow `<edge-name>.runtime` / `e_<sanitized-id>.runtime` names. `variableName()` lowercases and replaces runs of non-ASCII letters/digits with underscores; it is not a general identifier validator. Parameter names are checked against the expression identifier pattern.

`scope()` provides `x` and `value`, named project values, and explicit Register input state links. Input aliases also expose `<alias>.runtime`. A state link can provide the source quantity of a particular resource via its filter.

Auto Registers evaluate at the normal tick evaluation stage. Passive Registers with unchanged explicit/named dependencies retain their values instead of rerolling random formulas on every refresh. `registerInputsChanged()` tracks formula/min/max dependencies and explicit input links, including unused input aliases. Interactive Registers skip ordinary expression evaluation and use their configured click increment in `act()`.

Feedback writes update the relevant cached input values so an internal write is not treated as a new external input and does not reroll the same Register again. Circular register resolution falls back to a previous/current value and reports an issue; it is not a general fixed-point solver. Parameters are evaluated in project order and are not topologically solved.

### State links

| Mode | Local behavior |
| --- | --- |
| `enable` | Evaluate comparison/condition using the source value; multiple active conditions gate the target together |
| `input` | Supply an alias to the target's expression scope |
| `add`, `multiply` | Apply a source-derived modifier; node modifications use source changes since the prior modifier application, while flow modifiers affect computed rates |
| `overwrite` | Copy an origin value into a Pool/Register or override another connection's live behavior |
| `trigger` | Schedule/terminate on change, chance, gain, loss or failed action |
| `triggerIf` | Trigger on relevant activity when its comparison holds |
| `split` | Select one enabled weighted outgoing trigger using the source's distribution behavior |
| `unsupported` | Preserve an imported unmapped type; no supported local behavior is promised |

State outputs from a disabled Register are disabled. `stateOverride()` resolves overwrites of other state links, chooses the last enabled overwrite, and guards recursive resolution. Overwritten flow amounts bypass the old formula; overwritten comparisons retain their comparison operator. Preserve the distinction between overriding an input's value, a comparison threshold, and a flow amount.

Chance triggers use `triggerAttempts` to avoid multiple rolls for the same tick's qualifying activity. Resource-specific gain/loss are tracked separately. A Sink counts as active for gain/change triggers when it actually drains resources; merely being an automatic Sink must not fake a successful drain. Failed-action triggers depend on recorded unsuccessful work.

### Gates, Delay/Queue and Converters

- `pick()` implements random weighted choice or deterministic remainder-based weighted allocation.
- `routeGate()` handles weighted output and comparison-based output. For deterministic percentage routing, missing probability mass can be an explicit discard branch. Same-step gate cycles are guarded, and per-arrival routing work is capped at 100,000 tokens.
- Delay/Queue batches store resource type, count, due step and delay. Their first output connection controls timing when available, otherwise the node formula is used; delay is at least one step.
- Delays can release each due batch; Queues serialize releases and emit at most one token/unit from the current batch per release pass. A queue's subsequent batch due times account for queued work.
- Converter inputs can be pulled atomically or recognized from the `delivered` ledger. Conversion consumes input resources and mints the output resource. Disabled inputs respect `ignoreDisabled`; `single` and `multiple` control iterations. Multiple conversion has a 10,000-iteration per-step bound.
- Do not assume these are full Machinations semantics. Complex gate conditions, timing, feedback, routing and conversion combinations require concrete regression examples.

## 10. Formula language

`compile(expression)` returns a closure `(scope: Map, rng: Function) => value` and attaches a `.references` Set used by dependency tracking. It uses a tokenizer and precedence parser, not `eval` or arbitrary JavaScript execution. A cache stores up to 2000 compiled expressions, clearing when full.

Supported syntax includes numbers/scientific notation, identifiers/dotted identifiers, parentheses, array literals, unary `+`, `-`, `!`/`not`, arithmetic, comparisons, logical operators, and conditional expressions. Power `^` (or normalized `**`) is right-associative; it binds more tightly than unary minus. Logical AND/OR and conditional branches short-circuit.

Precedence from low to high: OR, XOR, AND, equality, relational comparisons, addition/subtraction, multiplication/division/remainder/modulo, unary operators, power. Use `==` for equality in full expressions. `comparison()` additionally expands leading shorthand such as `>= 3`, `= 2`, and `a..b` to tests against `x`.

Unicode aliases normalized by the parser include U+2265/U+2264/U+2260 comparisons, U+2212 minus, U+00D7 multiplication and U+00F7 division. This file uses ASCII examples so shell encoding does not obscure syntax.

| Category | Supported forms / important semantics |
| --- | --- |
| Arithmetic | `+ - * / % mod ^`; `%` is JavaScript remainder, `mod` is mathematical modulo |
| Comparisons | `== != < <= > >=` |
| Logic | `and`, `or`, `xor`, `not`, `&&`, `||`, `!` |
| Conditional | `test ? yes : no`, `if(test,yes,no)`, `ifElse(test,yes,no)` |
| Constants | `pi`, `e`, `true`, `false`, `infinity`, `nan` |
| Dice | `D6`, `2D6`; 1..1000 dice, 1..1,000,000,000 sides |
| Random | `random()`, `random(high)`, `random(low,high)` |
| Integer random | `randomInt(low,high)` has an exclusive upper bound; one argument starts from zero |
| Weighted choice | `pickRandom([values])`, optionally with an equal-length array of nonnegative weights with positive sum |
| Rounding | `floor`, `ceil`, `trunc`, `round(x,digits)`, `fix(x)`; **`fix` intentionally means `Math.round`, not truncation** |
| Aggregation | `sum`, `mean`, `min`, `max`; these accept flattened array arguments as implemented |
| Math | `abs`, `acos`, `asin`, `atan`, `atan2`, `cos`, `sin`, `tan`, `exp`, `sqrt`, `hypot`, `log`, `ln`, `log10`, `log2`, `pow`, `sign` |
| Helpers | `clamp`, `larger`, `largerEq`, `smaller`, `smallerEq`, `equal`, `unequal` |

Function lookup is case-insensitive; variable lookup tries the exact name and lowercase key. Quoted strings, object literals, arbitrary methods, assignments, custom functions, external services and full Math.js syntax are not implemented.

The parser rejects formulas over 1800 characters and reports invalid/unknown syntax or functions. `Simulation.expr()` converts the final result to Number: nonfinite results become zero, while actual parse/evaluation errors add an issue and use the caller's fallback. Empty formulas use the caller's fallback without compiling. Capacity uses Infinity as its empty fallback separately.

## 11. Charts, simulation controls and forecasting

`plotTypes` is the set Pool/Register/Delay/Queue/Converter. These correspond to saved snapshot values; Source/Sink/Gate/End/Text do not acquire graph series through Show all.

- The scrolling legend initially lists only Pools, and the first three Pools are selected by default, independent of earlier Registers in node order.
- Show all reveals the other graphable node types; Pools only filters them out of the legend again.
- Filtering the legend does not deselect already plotted non-Pool series. Their visibility returns unchanged when Show all is reopened.
- If no Pools exist, the empty chart directs the user to Show all. If there are no additional types, the toggle is hidden.
- Chart visibility/filter state is UI-only. Loading a project resets it; stepping, colour changes and reset do not need to discard it.
- `renderPlot()` uses the preview or live history, rescales to the data range, draws native SVG axes/lines, and downsamples long histories according to display width. No chart package is involved.

Step advances once, Play uses a `setTimeout` loop, and Reset creates a new `Simulation` with the current seed. Editing seed also resets the run. Speed changes the timeout spacing, not simulation math. Clicking an interactive canvas node during a run queues it for the next step; Properties also offers queue actions. `queueClick()` stores an amount per ID, replacing the prior queued amount rather than accumulating arbitrarily many clicks.

Forecasting stops Play, runs 1..1000 fresh simulations, and records final values for all graphable nodes. Seeded run `i` uses `seed + ' / ' + i`; a blank seed stays blank rather than accidentally becoming the deterministic string `' / i'`. Runs use `retainHistory:false`. The loop yields after roughly 23 ms of work and supports dialog-close cancellation. Results report min/median/max, completed run count and runs with issues. Forecasts do not supply manual clicks.

## 12. Imports and optional public-preview capture

### Dispatch and normalization

`readDiagram(source, {name='', url='', rendered}={})` trims BOM/whitespace and dispatches:

1. JSON with `xml` or `content.xml`: import the wrapped Machinations XML; use its metadata where available.
2. Other JSON: normalize a native Resource Flow project.
3. XML containing `mxGraphModel`: import XML.
4. SVG/HTML containing an SVG: infer a diagram from the capture.
5. Otherwise throw a user-facing import error.

The text guard is 20,000,000 characters. The file picker separately checks file bytes. Normalization is the boundary for IDs, supported schema fields, resources, colour references, routes and numeric defaults.

### Machinations XML

`xmlModel()` rejects DOCTYPE/ENTITY documents and parser errors, requires a graph root, imports resources, then nodes, then connections. It recognizes common `mx*ShapeCell` classes and preserves other identifiable node cells as `unknown`. Coordinates are converted from geometry top-left/size to node center. Register display names, expression values and label offsets have separate extraction paths because Machinations stores those differently from ordinary nodes.

The importer translates activation synonyms, resource/filter information, initial resource stacks, bounds, capacity, conditions, direction, distribution and conversion settings. It translates flow formula type/value/value2 fields into numbers, dice, percentages and `all`, and maps state connection types/subtypes into the model enums. Unmapped state behavior becomes `unsupported`, with an import warning. Agentic triggers stay `agent`, and instant transfer values stay `instant`; UI filtering must not alter that.

Saved routing reads `mxGeometry` interior points, orthogonal style, and `formulaPoint`/`labelPoint`. State colours come from `strokeColor` style or explicit colour attributes. When rendered previews exist, their valid computed state stroke colour takes precedence over XML, with XML as fallback.

`discardDangling()` repeatedly removes connections with unresolved endpoints, including cascading state links, and records a warning. Native JSON with invalid endpoint IDs is rejected by normalization instead of taking this XML/SVG omission path.

Parameters are read from recognizable variable groups. External/json/sheet/market/http/feed-style parameters are warned about, not fetched or executed. Register formulas are not guaranteed recoverable from a screenshot-like SVG capture.

### SVG/HTML captures

`svgModel()` parses the capture into an inert document after removing style/URL-bearing attributes used for embedded assets. It reconstructs native objects; it does not insert the imported SVG/HTML verbatim into the live editor.

It inspects Machinations classes, node silhouette path signatures, labels, badges, text values, translations and connection paths. `pathGeometry()` uses SVG measurements when available and a simpler numeric start/end fallback if they fail. State links are inferred from dashed strokes or state-label structure. Endpoints are inferred from nearest nodes, other connection segments and label bounds, so densely packed captures can be ambiguous.

Known visible labels can infer input/enable/trigger/overwrite/modifier formulas and resource pills. State stroke attributes are imported as colours. The path shape is approximated by a native bend here rather than guaranteeing the exact public-URL rendered-path format. Warnings explicitly ask users to review hidden formulas, initial quantities, capacities and unresolved types.

### Public URL route

`GET /import-url?url=<encoded public URL>`:

1. `diagramId()` validates an HTTPS Machinations host, rejects credentials/custom ports, and extracts a 16..100 character diagram ID from supported share/embed/public paths. Common accepted forms include `/d/diagram/<id>`, `/e/<id>` and `/e/diagram/<id>`; the exact accepted patterns are in its regex.
2. `fetchDiagram()` requests only `https://my.machinations.io/diagram/open-public/<encoded-id>`, with a 15-second timeout, no redirects, JSON content-type validation and a 20 MB streaming limit.
3. It requires a successful model response containing XML, and returns title/XML/source URL.
4. The server counts connections and attempts optional exact preview capture. Capture failure becomes `[]`, not a failed otherwise-valid XML import.
5. The browser receives `{title, xml, url, rendered}`, parses it, and performs the normal undoable load.

The fetch is fixed-host after validation; do not replace it with arbitrary server-side fetching of the supplied URL. Private diagrams requiring the user's browser login are not supported by this unauthenticated server fetch/profile.

### Headless helper details

`browserPath()` tries the configured executable followed by common Chrome/Edge/Chromium locations on Windows/macOS/Linux. `captureRenderedLayout()` creates a fresh temporary profile and launches a hidden headless browser. It does not reuse the user's logged-in browser profile.

`devtools()` sends JSON messages with IDs over extra process pipes, separated by NUL bytes, and resolves pending responses. `previewPaths()` is serialized via `.toString()` and executed in the preview browser. It verifies origin/path, queries `svg.m-ground-work-svg .m-connection-line`, and returns each connector's ID, SVG `d`, end point, midpoint, tangent angle, bounds and computed stroke colour.

Capture has an approximately 8.5-second overall deadline, polls up to 26 times with 220 ms spacing, and retains the largest completed result seen. It closes/kills its own process and removes only its checked temporary-profile path in `finally`. Treat partial captures and browsers that cannot launch as normal fallback cases. Do not turn a local permission problem into a global disabling of browser security or a requirement for every user to install browser-automation dependencies.

The Machinations XML/DOM selectors and silhouette signatures are external integration points and can change. Diagnose a failing URL import by inspecting the returned XML and `rendered` array separately before changing simulator behavior.

## 13. Server, security and offline behavior

The server is intentionally small and local:

| Route / condition | Result |
| --- | --- |
| `GET /` | `public/index.html` |
| Explicitly registered JS/CSS assets | Correct text/javascript or text/css response |
| `GET /favicon.ico` | 204 |
| `GET /import-url?...` | Public import response or 400 JSON error |
| Unknown asset/path, including documentation files | 404 |
| Non-GET method with an accepted host | 405 |
| Invalid Host or `Sec-Fetch-Site: cross-site` | 403 |

Host validation accepts `127.0.0.1` or `localhost` with an optional port. There is no general static-directory traversal route. Files are resolved relative to `import.meta.url`, not arbitrary URL paths.

Responses use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive CSP: default none, scripts/styles/self, self or data images, self connections, self base/form targets, and no embedding. Existing code sets some SVG/CSS custom properties programmatically; do not add raw imported inline scripts or external asset loading as a shortcut.

User text is rendered as text. Formula evaluation is a whitelist parser. XML entities/document types are rejected. Preserved exact SVG path data is restricted by route normalization. These checks do not make public deployment supported: there are no accounts, persistent server projects, authorization checks for multiple users, or remote collaboration.

## 14. Testing and verification

### Current checked-in baseline

On **2026-11-22**, with Node.js **v24.14.0**, `node --test` completed with **59 passed, 0 failed, 0 skipped** across four files. The count is a dated baseline, not a permanently fixed requirement; update it when tests change.

| Test file | Current count | Main coverage |
| --- | --- | --- |
| `test/colors.test.mjs` | 6 | Imported hex/RGB values; graphite; live resource presets/custom independence; duplicate colours; old-file migration; missing/stale references |
| `test/geometry.test.mjs` | 13 | Straight/vertical/diagonal/curved/degenerate label projection; endpoint clamping; routed bends; untouched imported labels; save/reopen; exact route/caption offsets; marquee enclosure; waypoint expansion/deletion; simplification; alignment/right-angle snapping |
| `test/selection.test.mjs` | 7 | Toggle identity; same-value comparison including stacks; independent cloned arrays; colour normalization; unsupported option filtering; current imported type preservation |
| `test/sim.test.mjs` | 33 | Parser/math/dice; nonfinite values/errors; Register dependencies/feedback; activators/overwrites; stocks/capacity/interval; all-or-nothing; trigger chance/gain/loss/failure; buffers/queues; gates/conversion; resource filtering; end-condition ordering; seeds; public URL validation |

All checked-in tests use built-in `node:test` and `node:assert/strict`. They run offline without a DOM, browser, network request to Machinations, or dependency installation. Geometry tests use path-like test objects where actual SVG APIs are unavailable. Browser-only importing/rendering is not fully covered by that suite.

### Commands

```sh
# Full checked-in test suite
node --test

# Focused suites
node --test test/sim.test.mjs
node --test test/geometry.test.mjs
node --test test/colors.test.mjs
node --test test/selection.test.mjs

# One behavior by test name
node --test --test-name-pattern="same seed" test/sim.test.mjs

# Syntax checks for touched modules
node --check public/app.mjs
node --check public/import.mjs
node --check server.mjs
node --check rendered-layout.mjs

# Whitespace/conflict-marker-related diff inspection
git diff --check
git status --short
```

There is no configured lint/typecheck command. To syntax-check every `.mjs` under `public` and `test` on PowerShell:

```powershell
Get-ChildItem -Path public,test -Filter *.mjs -File | ForEach-Object {
  node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $($_.Name)" }
}
node --check server.mjs
node --check rendered-layout.mjs
```

Prefer deterministic fixtures and explicit seeds for assertions about stochastic histories. Tests can mock `Math.random` through `t.mock.method` to prove the blank-seed path uses runtime randomness without depending on chance. Use `makeNode`/`makeEdge` and explicit IDs to avoid malformed partial raw objects and nondeterministic identity assertions.

For engine tests, `model`, `node`, `flow`, `state`, and `values` helpers in `sim.test.mjs` illustrate the local fixture style. Cover actual observable behavior, including resource quantities, final/initial values, issue presence, edge activity, and ended state, rather than merely checking a helper mirrors its own implementation.

### Reproducible local HTTP smoke test

Save this code as a temporary `.mjs` in the repository root, run it with Node, and remove only that temporary file afterwards. It does not contact Machinations because the import URL intentionally fails local validation.

```js
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {start} from './server.mjs';

const server = start(0);
await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
try {
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes('id="diagram"'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('content-security-policy').includes("default-src 'none'"));
  for (const path of ['/app.mjs', '/model.mjs', '/sim.mjs', '/formula.mjs',
    '/geometry.mjs', '/colors.mjs', '/selection.mjs', '/import.mjs', '/icons.mjs', '/style.css']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.equal((await fetch(base + '/', {method: 'POST'})).status, 405);
  assert.equal((await fetch(base + '/', {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
  assert.equal((await fetch(base + '/import-url?url=https%3A%2F%2Fexample.com')).status, 400);
  console.log('HTTP smoke test passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
```

The same route/asset/security checks were run successfully when creating this document. `start(0)` is useful for tests because it requests an ephemeral port, and importing `server.mjs` does not open the normal UI server.

### Manual/browser regression matrix

Use a clean test browser profile or first export the user's current project. Do not clear a user's localStorage as a casual testing step. Watch the console for exceptions and inspect saved JSON where persistence matters.

| Area | Procedure and expected result |
| --- | --- |
| Startup | Open localhost; example appears if no saved project. Reload a saved project; its configuration remains. No module 404s or console errors. |
| Native persistence | Create nodes/resources/links, Save file, reload/import the JSON; labels, formulas, preset IDs, routes and label fractions survive. |
| Camera/history | Pan and zoom, move a node, undo/redo; geometry changes but the graph transform and zoom percentage stay fixed. |
| Label drag | Drag labels sideways/off-axis on native straight/curved paths, loops and imported paths; centers remain on the actual line, endpoints clamp, and path geometry does not bend. Repeat with Alt held. |
| Untouched imports | Import XML with absolute label coordinates. Without dragging a label, move an endpoint/waypoint and verify the label follows. Repeat after save/reopen. |
| Waypoints | Insert, drag with/without Alt, delete by double-click and focused Delete. Orthogonal corners remain editable; deleting a corner creates the expected segment. |
| Cancel | Start a node/waypoint/label drag, press Escape or blur the window; original project geometry/selection return without an extra committed edit. |
| Selection | Ctrl/Cmd-click nodes, wires, labels and handles; members toggle. A marquee requires full enclosure. Mixed types show a summary rather than misleading shared controls. |
| Bulk sources | Select three Sources with different labels, common resource Enemies and common trigger Auto. Edit resource/trigger once; all three change, labels remain distinct, undo reverses all three together. |
| Bulk dependency fields | Select matching state links; change mode/subtype/chance. Dependent defaults and fields update consistently for all selected links. |
| Bulk inventories | Select Pools with identical stacks/filters; edit quantity/resource/remove/add entries. Each Pool updates without sharing mutable arrays. |
| Defaults/colour | New Registers and State links use graphite. Choose a resource preset, change that resource colour, save/reopen, and change it again; linked appearances follow. |
| Custom independence | Set a custom colour equal to a preset hex. Change that resource; custom object remains unchanged. Delete a bound resource; last appearance stays; undo restores reference. |
| Duplicate presets | Two resources share one hex; choose each by name/ID on different objects. Recolour one resource; only its bound objects change. |
| Public import colour | Import a public Machinations diagram with a deliberately coloured state link; XML fallback and valid preview stroke produce the expected original colour. |
| Unsupported menus | Ordinary Sources must not offer Agentic; ordinary state links must not offer Unsupported; ordinary flows must not offer Instant. Current imported values appear in red, with normal supported alternatives. |
| Unsupported preservation | Import Agentic/Trader/Unknown/unsupported-state/instant-flow fixtures. Selecting or saving them must not rewrite those fields. Changing to supported values removes unavailable choices; undo restores them. Repeat with matching bulk selections. |
| Pool legend | Put a Register before Pools in node order. Initial legend lists only Pools and plots the first three Pools. Show all reveals other graphable types; toggling back preserves chosen lines. |
| No Pools | A Register-only graph offers Show all and can be plotted explicitly; a Pool-only graph hides the unnecessary toggle. Scroll long legends without losing the toggle. |
| Seeded runs | Use a dice flow and explicit seed; reset/repeat the same actions and get the same history. Zero is a valid seed. |
| Blank seeds | Clear seed, including whitespace-only input, reset/run repeatedly; runtime randomness is used. Test forecasts separately so `' / i'` does not become an accidental fixed seed. |
| Forecast | Try seeded/blank runs, early ending, cancellation and multiple counts; seeded results repeat, blank runs are unseeded, and normal live history is not replaced. |
| End ordering | Pool health, damage Sink and regeneration Source: lethal damage must stop before regeneration regardless of node array order. Extend to queued heals/converters when touching those paths. |
| Error handling | Invalid JSON/XML, dangling endpoints, missing preview browser, inaccessible/private URL, nonfinite/invalid formulas and storage errors must degrade as documented rather than execute imported code. |
| Responsive layout | Resize through the CSS breakpoints; Properties remains scrollable, legend scrolls, Show all remains usable, canvas shortcuts still work outside controls. |

### Browser automation guidance and existing coverage limits

No Playwright/Puppeteer package or browser test runner is checked in. Prior development used temporary Node/Chrome DevTools scripts outside the repository, real mouse/key events, isolated browser profiles and screenshots of synthetic diagrams. Those scripts are **not a reproducible repository dependency** and may not exist on another machine; do not cite their temporary paths as required tooling.

For automation, start the app on an isolated port/profile, use a browser/automation tool already available in the environment, and query the DOM contracts above. Import through the dialog to exercise the actual parser. The pure model/engine can also be loaded through dynamic import in a browser page, but module-local `project` and `sim` are not window globals.

Use actual pointer events for drag coverage: pointer capture and replaced SVG children make synthetic DOM event-only drag tests misleading. Derive screen coordinates with `getScreenCTM()` and account for `view.scale`; test multiple move events, release, cancellation and undo. Read selected option classes/computed colours for unsupported controls; native popup rendering can differ by browser/OS, so the closed unsupported select is also red and text-labelled.

Inspect `localStorage.getItem('resource-flow-project-v1')` only within the isolated test profile. After interacting with a form/button, blur it before expecting the canvas-level Ctrl+Z handler to run. Screenshots should be test evidence, not accidentally committed user project data.

## 15. Safe contribution recipes

### Add or change a persisted field

Update the factory, normalization, relevant inspector/rendering/simulation paths, imports if needed, and save/reopen tests. Decide its old-file default and whether it belongs in project JSON or transient state. Do not assume arbitrary extra raw JSON survives normalization.

### Add a supported node/trigger/state mode

Update model enums/validation, import mapping, relevant simulation actions/scope/trigger handling, inspector conditional fields, icon/tooling, chart snapshot support if applicable, and tests. Remove its unsupported UI marker only after its behavior exists. Keep compatibility handling for older imported representations.

### Add a browser module or asset

Create the file, register its exact HTTP path in `server.mjs`, import it using relative ES-module paths, and check HTTP MIME/CSP behavior. There is no auto-discovery static server or bundler to resolve missing assets for you.

### Fix a simulation discrepancy

Reduce it to a small factory-built model with explicit IDs and seed. Assert quantities, intermediate snapshots, end state, activity and warnings as applicable. For ordering problems, reverse relevant node order in the test. Consider both history modes and avoid silently making imported unsupported data appear supported.

### Change an inspector field

Use `fields(items)` for matching/bulk behavior. If a field has dependent defaults or arrays, update every selected object in one `change()` and clone assigned values. Maintain context-specific unsupported filtering; do not accidentally filter resource/endpoint IDs by enum names.

### Change routes/drag behavior

Cover native and imported routes, exact preview and saved-waypoint fallback, untouched imported labels, fractional label persistence, zoom-adjusted snapping, group movement, cancellation, and one-step undo. Keep `getPointAtLength()` projection on the real curve, rather than only the endpoint chord or simplified editing polyline.

### Change colours

Go through the colour helpers and keep `colorResource` distinct from actual resource assignment/filtering. Test duplicate resource colours, explicit custom colours that happen to match a preset, old saved files, missing/deleted resources, bulk edits, undo and reload. Reuse the shared graphite constant for Register and State link defaults.

### Finish a contribution

Run the relevant tests/checks and inspect the final diff. Broaden testing when changes or unresolved concerns warrant it; do not repeatedly rerun unrelated live imports for a simple documentation edit. Update this file's affected sections and maintenance log. Report what changed, how it was checked, and any real remaining limitation without claiming tests that were not run.

## 16. Known limitations and troubleshooting

| Symptom / constraint | Where to investigate |
| --- | --- |
| Browser appears to lose a project | Check host/port/profile origin and localStorage; use exported JSON for durable backups. There is one autosaved project per origin. |
| Changed module is 404 / app fails to boot | Check `server.mjs` asset allowlist and relative imports. No compilation step can repair it. |
| `EADDRINUSE` | Another process owns the chosen port; select a different `PORT`. Do not kill unrelated user processes. |
| CTRL shortcuts seem ignored | Focus is inside a form/button or a dialog is open; the handler deliberately returns in those cases. |
| Imported label stays at old coordinates | Check eager `edgeLabelPoint()` migration and preserved `labelPosition`, not just label-drag code. |
| Undo recenters canvas | `restore()` must not call `fit()` or restore a different `view`. |
| Bulk property disappears | Values or controlling modes differ; only matching same-type properties are shown by design. |
| Unsupported value is missing/wrong after import | Check import/normalization separately from editor filtering. Do not remove compatibility enums. |
| Preset does not follow a resource | Check `colorResource` ID, cached colour, migration ambiguity, and whether the choice was explicitly custom. |
| Public preview fails but XML imports | Check installed/configured browser, launch permissions, remote DOM changes and capture deadline; fallback is intentional. |
| Private/public URL cannot be fetched | API access/visibility/network may differ from a signed-in user's browser; use a local file/capture. |
| SVG import looks plausible but simulates differently | It infers visible content and cannot recover every hidden formula/setting. Review warnings and compare with XML. |
| Infinity/NaN appears to become zero | `Simulation.expr()` intentionally coerces nonfinite results to zero. Empty capacity is handled separately as unlimited. |
| Seeded result changed after refactor | RNG call/evaluation/action order changed; inspect caches, dependency refresh, triggerAttempts and node iteration order. |
| Apparent one-step resource timing mismatch | Inspect `available`, `delivered`, Gate callbacks and buffer schedules; arbitrary newly received Pool stock is not universally transferable in the same tick. |
| Large diagrams/forecasts are slow | SVG/Properties rebuilds, cloned undo snapshots, full history and per-token gate work have real costs. Read the caps below before increasing them. |

Additional limits and caveats:

- Maximum normalized project size is 4000 nodes and 8000 edges; input text/file/network limits are separately enforced.
- Preserved path `d` text must be shorter than 32,000 characters. Projection/edit sampling is capped at 1024 divisions.
- Auto history retains every tick in memory; only forecast/explicit `retainHistory:false` bounds this to the latest snapshot.
- Warnings carried from imports are persisted strings; converting an object does not necessarily remove every historical import warning automatically.
- No arbitrary external variables, service calls, agentic triggers, Trader exchanges, full Math.js, multiuser collaboration or native export back into Machinations exists.
- Unsupported data is preserved only to the native schema's extent. Unknown original XML attributes, unsupported external configuration and arbitrary JSON extras are not all retained verbatim.
- CSS breaks layout at roughly 1150, 880 and 540 px; native select/picker presentation is browser-dependent.
- `.gitignore` ignores all `*.txt`, including prospective fixtures. Prefer tracked `.json`, `.xml`, `.svg`, `.mjs` or `.md` as appropriate.
- Current source plus checked-in regressions take precedence over historical files and past chat logs.

## 17. Maintenance log

### 2026-11-22: initial contributor context

- Created this comprehensive source-based guide at the user's request; designated `CONTEXT.md` rather than `README.md` as the documentation target after future prompts in this chat.
- Documented architecture, every production module, saved schemas, transient state, undo/persistence, SVG interaction, imported label migration, bulk Properties, unsupported options, colour references, simulation phases, formulas, public/XML/SVG imports, HTTP boundaries, tests and contribution recipes.
- Verified the current 59-test offline suite, syntax checks for all existing production/test ES modules, and local HTTP route/asset/security checks on Node.js v24.14.0.
- No application behavior or `README.md` changes are part of this documentation task.
