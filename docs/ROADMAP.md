# Reference port roadmap

Tracks the port of the legacy WPF
[Assets-Editor](https://github.com/luanluciano93/Assets-Editor) features into
this Tauri/React rewrite. Each phase ships independently on its own
`feat/phase-N-*` branch and lands on `main` only after the acceptance criteria
pass. Estimates are calendar-light: hours of focused work, not wall-clock.

## Status

| # | Phase                       | Effort | Branch                              | Status |
|---|-----------------------------|--------|-------------------------------------|--------|
| 1 | Attribute editor            | ~16h   | `feat/phase-1-attribute-editor`     | Done |
| 2 | Image export                | ~12h   | `feat/phase-2-image-export`         | Done |
| 3 | Batch export queue          | ~6h    | `feat/phase-3-export-queue`         | Done |
| 4 | Search dialog               | ~6h    | `feat/phase-4-search-dialog`        | Done |
| 5 | Sprite sheet editor (v1)    | ~8h    | `feat/phase-5-sheet-editor`         | Done |
| 5b| Sprite sheet write-back     | ~12h   | `feat/phase-5b-sheet-writeback`     | Done |
| 6 | Cross-client importer (OBD) | ~14h   | `feat/phase-6-importer`             | Done |
| 7 | Profiles                    | ~8h    | `feat/phase-7-profiles`             | Done |
| 8 | Lua scripting               | ~24h   | `feat/phase-8-lua`                  | Skipped (user opted out) |

Total: ~106h. All non-skipped phases shipped to `main`.

The remaining open work (cross-client `.dat`/`.spr` import, Map
Converter, Map Editor) is tracked outside this roadmap because it is
not part of the legacy WPF feature port.

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

## Phase 5 — Sprite sheet editor (v1, read-only)

**Scope:** browse and export the existing sprite sheets. The write
path (replace sprite, create new sheet) is deferred to Phase 5b
because it needs the Cipsoft sheet-header format reverse-engineered
first — we never had to encode one, only decode.

**Changes**
- `crates/atlas-sprites/src/lib.rs` — `Atlas::sheet_image` made public
  so callers can pull the full decoded `RgbaImage` for a sheet.
- `crates/atlas-sprites/src/export.rs` — `png_to_data_url` helper so
  the Tauri commands don't each pull `base64` in.
- `src-tauri/src/assets/commands.rs` — `get_sheet_png_url`,
  `export_sheet_png_file`, `export_sprite_png_file` commands.
- `frontend/src/tools/assets/Tabs.tsx` — new "Sheets" category.
- `frontend/src/tools/assets/AssetsEditor.tsx` — drops the right
  attribute panel when the Sheets tab is active so the sheet view
  gets the whole width.
- `frontend/src/tools/assets/SheetEditor.tsx` (new) — sidebar listing
  every sheet plus a main pane that renders the decoded PNG with a
  grid overlay, hover magnifier (radius 80 px, 3× zoom) and an
  "Export sheet PNG" button.
- `frontend/src/tools/assets/SpriteGrid.tsx` — right-click menu on
  every sprite tile with "Export sprite PNG" and "View in sheet"
  (deep-links into the Sheets tab via `selectedSheetFile`).

**Acceptance:** opening the Sheets tab lists every sheet from the
catalog, picking one renders it with a grid overlay and working
magnifier, the toolbar "Export sheet PNG" button writes a PNG that
opens cleanly outside the editor, and right-clicking any sprite in
the Sprites tab can export it as PNG or jump to its sheet.

## Phase 5b — Sprite sheet write-back

**Scope:** sprite-sheet mutation — replace pixels for an existing
`sprite_id`, create new blank sheets, persist back to disk.

**Header finding:** a sheet file is `[32-byte prefix][LZMA1 stream]`.
The prefix is 24 zero bytes + an 8-byte Cipsoft content checksum that
neither our reader nor OT clients validate. The LZMA payload is a
`BITMAPV4HEADER` 32-bpp BMP (R=0x00ff0000, G=0x0000ff00,
B=0x000000ff, A=0xff000000, bottom-up). We preserve the original
prefix verbatim on write-back rather than re-derive the checksum.

**Changes**
- `crates/atlas-sprites/src/pack.rs` (new) — `encode_sheet_bmp`
  (exact V4 layout), `encode_sheet_file` (BMP → LZMA1 → prefix),
  `blank_sheet`. Round-trip unit tests through the loader path.
- `crates/atlas-sprites/src/lib.rs` — `Atlas::replace_sprite`,
  per-sheet dirty tracking, `save_dirty_sheets` (atomic tmp+rename,
  original prefix preserved), `create_sheet`, `decode_rgba`.
- `src-tauri/src/assets/commands.rs` — `replace_sprite_from_png`,
  `save_sprite_sheets`, `has_unsaved_sheets`, `create_sprite_sheet`
  (appends to `catalog-content.json` then reloads the atlas).
- Frontend — "Replace from file…" on the sprite context menu (auto-
  saves), "New sheet" size-preset dropdown on the Sheets tab,
  `replaceSpriteFromFile` / `saveSpriteSheets` / `createSpriteSheet`
  store actions, i18n.

**Caveat:** the preserved checksum goes stale after an edit. Verified
to round-trip through our own decoder; OT-client (OTClient/Canary)
acceptance still to be confirmed against a live client by the user.

**Acceptance:** right-click a sprite → Replace from file → pick a
matching-size PNG → the sheet on disk re-decodes with the new pixels
and the thumbnail updates; "New sheet 32×32" adds a blank sheet to
`catalog-content.json` and its id range becomes browsable.

## Phase 6 — Cross-client importer (OBD)

**Scope:** import a single appearance + its sprites from an `.obd`
(Object Builder Data) file. External-`.dat` import is out of scope —
that needs the 10.98 attribute parser, and OBD already covers the
community workflow (forum-shared appearances ship as `.obd`).

**Format finding:** after a standard LZMA1-alone decompress the layout
is `u16 version` (200=V2 / 300=V3), `u16 clientVersion`, `u8 category`,
`u32 texturePos`, the legacy 10.98 attribute blob, then the frame
groups. `texturePos` is the absolute offset where the frame groups
start, so we **seek past the attribute blob entirely** instead of
porting the opcode soup — the legacy flags wouldn't map onto the modern
proto cleanly anyway. Each embedded sprite is a 32×32 ARGB tile
(alpha-first byte order); composed sprites stitch a `tile_w × tile_h`
grid of those.

**Changes**
- `crates/atlas-sprites` — `lzma_decompress_alone` helper, `Rgba`
  re-export.
- `src-tauri/src/assets/obd.rs` (new) — V2/V3 parser → neutral
  `ObdImport`, plus `build_appearance` that maps OBD pattern dims
  (x→pattern_width, y→pattern_height, z→pattern_depth, layers, frames→
  animation phases) onto the proto model.
- `src-tauri/src/assets/commands.rs` — `preview_obd` (parse + base64
  sprite previews, no commit) and `import_obd` (allocate a sheet via
  the Phase 5b path, blit every composed sprite, append the appearance
  to the proto, persist appearances.dat with backup). Catalog append +
  atlas reload factored into shared helpers.
- `frontend/src/tools/assets/ImportDialog.tsx` (new) — pick → preview
  (frame group breakdown + sprite thumbnails) → commit; opened from a
  FileBar button. i18n in en/pt/es.

**Limits (documented, not blocking):** single sheet per import (errors
clearly if the appearance needs more than one sheet's worth of
sprites); only the four 32/64 tile compositions; legacy-vs-proto sprite
ordering is preserved as-is (the reference's own comments flag this as
imperfect — the user eyeballs the result).

**Acceptance:** importing an `.obd` shows the correct preview and, on
commit, creates a sheet, writes the sprites, appends a new appearance
in the right category and selects it; appearances.dat is saved.

## Phase 7 — Profiles

**Scope:** named profiles (e.g. "Tibia 12.91", "Server 15.0") with their own
asset paths and decoding flags.

**Changes**
- No new dependency: profiles persist via the same hand-rolled
  app-config-dir JSON strategy as `RecentFiles` (`profiles.json`),
  not `tauri-plugin-store` — a flat list doesn't justify the dep.
- `Profile { name, assets_path, pixel_format }` lives in
  `commands.rs` (next to `RecentFiles`). The legacy reference's
  `transparent`/`extended`/`server_path` fields don't apply to the
  modern bundle — assets dir + pixel format is all that matters.
- `src-tauri/src/assets/commands.rs` — `list_profiles`,
  `save_profile` (upsert), `rename_profile`, `delete_profile`.
  `apply_profile` is composed frontend-side (reuses
  `openAssetsBundlePath` + `set_sprite_pixel_format`) rather than a
  dedicated backend command.
- `frontend/src/tools/assets/ProfileSwitcher.tsx` (new) — toolbar
  dropdown: switch / save-current / inline-rename / delete; shows the
  active profile + pixel format.
- Launcher lists profiles as a primary entry above the recent-files
  MRU; clicking one applies it.

**Acceptance:** creating "Live 12.91" and "Server 15.0" profiles and
switching between them opens the right bundle (and its pixel format)
without re-picking a folder; profiles survive an app restart.

## Phase 8 — Lua scripting — SKIPPED

The user opted out of this phase (2026-05-16): the search/filter/bulk
work from phases 1–4 already covers the common audit cases, and the
~24h cost + bug surface of embedding a Lua VM, Monaco and a chart
library wasn't worth it for this project. Kept below for reference if
it's ever revisited.

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
