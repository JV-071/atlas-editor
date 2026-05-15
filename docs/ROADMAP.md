# Reference port roadmap

Tracks the port of the legacy WPF
[Assets-Editor](https://github.com/luanluciano93/Assets-Editor) features into
this Tauri/React rewrite. Each phase ships independently on its own
`feat/phase-N-*` branch and lands on `main` only after the acceptance criteria
pass. Estimates are calendar-light: hours of focused work, not wall-clock.

## Status

| # | Phase                       | Effort | Branch                              | Status |
|---|-----------------------------|--------|-------------------------------------|--------|
| 1 | Attribute editor            | ~16h   | `feat/phase-1-attribute-editor`     | In progress |
| 2 | Image export                | ~12h   | `feat/phase-2-image-export`         | Pending |
| 3 | Batch export queue          | ~6h    | `feat/phase-3-export-queue`         | Pending |
| 4 | Search dialog               | ~6h    | `feat/phase-4-search-dialog`        | Pending |
| 5 | Sprite sheet editor         | ~20h   | `feat/phase-5-sheet-editor`         | Pending |
| 6 | Cross-client importer       | ~14h   | `feat/phase-6-importer`             | Pending |
| 7 | Profiles                    | ~8h    | `feat/phase-7-profiles`             | Pending |
| 8 | Lua scripting               | ~24h   | `feat/phase-8-lua`                  | Pending |

Total: ~106h.

## Tech decisions

| Concern         | Choice                       | Why                                              |
|-----------------|------------------------------|--------------------------------------------------|
| GIF encoder     | `image` + `gif` crates       | Already depend on `image`; runs server-side      |
| Lua VM          | `wasmoon` (Lua 5.4 in WASM)  | Runs in the webview, no Rust binding needed      |
| Code editor     | `@monaco-editor/react`       | Lua autocomplete + better than CodeMirror here   |
| Chart library   | `recharts`                   | Small (15 kB), declarative                       |
| Color picker    | `react-colorful`             | 2 kB, no deps                                    |
| Profile storage | `tauri-plugin-store`         | Matches existing plugin pattern                  |

## Phase 1 — Attribute editor completion

**Scope:** every appearance field the reference exposes (~50 booleans plus the
composite scalars).

**Changes**
- `frontend/src/tools/assets/AttributeEditor.tsx` — add sections for Light
  (brightness + color), Shift (X/Y), Height (elevation), Automap (color + ID),
  Lenshelp (dropdown), Clothes (slot dropdown), DefaultAction (dropdown), Market
  (category + trade/show IDs), Hook (direction), Bank (waypoints), Write /
  WriteOnce (max length), Cyclopedia, UpgradeClassification, Imbueable (slot
  count).
- `frontend/src/tools/assets/widgets/` (new) — `FlagToggle`, `NumberField`,
  `ColorField`, `EnumSelect` so every section composes from the same
  primitives.
- `src-tauri/src/assets/edits.rs` — handlers for the ~25 missing boolean flags
  and every composite-field setter.
- `frontend/src/i18n/messages/{en,pt,es}.ts` — flag and field labels.

**Acceptance:** every field surfaced in `AppearanceFlags` (`model.rs`) is
editable from the right pane with working undo/redo and persistence on save.

## Phase 2 — Image export

**Scope:** export items as animated GIFs and outfits in the Gesior PNG naming
scheme, mirroring `ImageExporter.cs` from the reference.

**Changes**
- `crates/atlas-sprites/src/export.rs` (new) — `export_item_gif`,
  `export_outfit_pngs`, `export_effect_gif`, `export_missile_gif`. Honors
  the missile direction sequence `1,2,5,8,7,6,3,0` and the Gesior naming
  `{fg}_{h}_{d}_{w}_{frame}{_template}.png`.
- `src-tauri/src/assets/commands.rs` — `export_appearance(scope, id, format, path)`.
- `frontend/src/tools/assets/ExportDialog.tsx` (new) — modal with transparent
  checkbox, id range, folder picker. Wired from a header button on
  `AttributeEditor`.

**Acceptance:** exporting one outfit produces the correct N PNGs with the
Gesior names; exporting one effect produces a GIF whose loop count and
per-frame durations match the proto.

## Phase 3 — Batch export queue

**Scope:** persistent "add to export" list with badge counter, fed by both the
item list and the search dialog.

**Changes**
- `frontend/src/tools/assets/store.ts` — new `exportQueue` slice with
  `add/remove/clear`.
- `frontend/src/tools/assets/ItemList.tsx` — per-row `+` toggle and a blue dot
  indicator when queued.
- Header badge `Export (N)` with popover listing queued items and a "Run all"
  button that loops through Phase 2.

**Acceptance:** queue 10 outfits, hit Run all, get 10 sets of PNGs with
progress visible.

## Phase 4 — Search dialog

**Scope:** dedicated search window with multi-select results and batch actions,
evolved from the current flag-filter popover.

**Changes**
- `frontend/src/tools/assets/SearchDialog.tsx` (new) — full-screen modal with
  name field, id range, three-state flag picker (ignore / on / off), result
  grid with checkboxes. Bound to `Ctrl+F`.
- Bulk actions on selected rows: add to export queue, toggle a flag across
  the selection.

**Acceptance:** `Ctrl+F` opens, querying by flag returns ~50 rows, "Add to
export" pushes them into the Phase 3 queue.

## Phase 5 — Sprite sheet editor

**Scope:** create, import, and export sprite sheets — not just browse them.

**Changes**
- `crates/atlas-sprites/src/pack.rs` (new) — packing/repacking sprites between
  sheets honoring the 36 size presets (32×32 … 384×384) from the reference.
- `src-tauri/src/assets/commands.rs` — `create_sheet`, `replace_sheet_sprite`,
  `export_sheet_png`.
- `frontend/src/tools/assets/SpriteGrid.tsx` — per-sprite context menu
  (Export, Replace, View sheet).
- `frontend/src/tools/assets/SheetEditor.tsx` (new) — standalone view rendering
  the full sheet PNG with a grid overlay, size-preset picker, and hover
  magnifier (radius 80 px, 0.3× zoom).
- New "Sheets" tab next to "Sprites" in `Tabs.tsx`.

**Acceptance:** importing a 384×384 PNG creates a new sheet, assigns sprite
ids, updates `catalog-content.json`, and the new sprites surface both in the
Sprites tab and on any row that references them.

## Phase 6 — Cross-client importer

**Scope:** import appearances from another `.dat` or from an `.obd` (Tibia
Object Builder Data) file.

**Changes**
- `crates/atlas-appearances/src/obd.rs` (new) — OBD parser ported from the
  reference's `OBD/ObdDecoder.cs`.
- `src-tauri/src/assets/commands.rs` — `import_appearance(source_path, target_category)`,
  `preview_obd(path)`.
- `frontend/src/tools/assets/ImportDialog.tsx` (new) — wizard: pick source
  (external `.dat` or `.obd`) → preview appearance → resolve sprite-id
  conflicts via `SpriteGrid` in selection mode.

**Acceptance:** importing an `.obd` downloaded from a forum thread shows the
correct preview and applies cleanly with remapped sprite ids.

## Phase 7 — Profiles

**Scope:** named profiles (e.g. "Tibia 12.91", "Server 15.0") with their own
asset paths and decoding flags.

**Changes**
- `tauri-plugin-store` added for persisted profile storage.
- `src-tauri/src/profiles.rs` (new) — `Profile { name, assets_path, transparent, extended, sprite_format }`.
- `src-tauri/src/assets/commands.rs` — `list_profiles`, `save_profile`,
  `delete_profile`, `apply_profile`.
- `frontend/src/tools/assets/ProfileSwitcher.tsx` (new) — combobox in the
  editor header with New / Rename / Delete.
- Launcher reads `currentProfile` as the primary source ahead of the
  recent-files MRU.

**Acceptance:** creating "Live 12.91" and "Server 15.0" profiles and switching
between them opens the right bundle without re-picking a folder.

## Phase 8 — Lua scripting

**Scope:** a Lua editor + execution + tabular and chart output, matching
`LuaWindow.xaml.cs` from the reference.

**New frontend deps**
- `wasmoon ^1.16` (Lua 5.4 in WASM)
- `@monaco-editor/react ^4.6`
- `recharts ^2.12`

**Changes**
- `frontend/src/tools/assets/lua/` (new module) — `runtime.ts` (wasmoon
  wrapper), `api.ts` (bindings like `g_things.getItems()`, `getItemById()`
  that hit existing IPC), `scripts.ts` (CRUD on `lua_scripts.json` via
  `tauri-plugin-fs`), `Editor.tsx`, `ResultTable.tsx`, `ResultChart.tsx`,
  `LuaScreen.tsx` (3-pane layout).
- 4 default scripts bundled: `data-generator.lua`, `weapon-calculator.lua`,
  `multi-curve.lua`, `read-items.lua`.
- `src-tauri/src/assets/commands.rs` — `lua_get_appearances(scope, filter)`
  returning JSON for the Lua runtime to consume.

**Acceptance:** opening the Lua tab and running
`for i,o in ipairs(g_things.getItems()) do if o.flags.container then print(o.id) end end`
prints container ids; switching to the table view renders a DataGrid; CSV
export works.
