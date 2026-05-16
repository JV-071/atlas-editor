# Performance audit — 2026-05-16

Full sweep of the Tauri backend + React frontend after the 8-phase
reference port. All six findings were fixed on `perf/audit-fixes`.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | Critical | `update_*_field` cloned the whole `Workspace` per edit for undo (tens of MB on a 45k bundle × 64 history slots — regressed by Phase 1 preserving frame groups). | Per-entity history: each undo entry stores just the one affected `AppearanceInfo`/`OtbItem` (a few KB). `Snapshot::before == None` makes create undoable too. Import clears the stack (it writes files — not a pure in-memory delta). |
| 2 | High | `refreshRows()` re-listed all 4 categories + sprite ranges + re-serialized every row after a single-field undo/redo/create. | `refreshCategoryRows(category)` re-lists only the active (edits/creates are category-scoped); `refreshSpriteRanges()` for sheet creation. Full `refreshRows` kept only for bundle open/import. |
| 3 | High | `CrossRef::build` (O(objects+items), several N-sized Vec allocs) rebuilt on every Object `list_appearances`. | Memoized on `WorkspaceState`; invalidated only on structural changes (open/close/create/undo/redo/import). Field edits are cross-ref-invariant (flags/name never touch id↔client_id) so the hot path never rebuilds. |
| 4 | Medium | Each animated `SpriteThumb` ran its own recursive `setTimeout` chain (dozens of timers on a screen of outfits). | One shared `spriteClock` `setInterval` (auto start/stop with subscribers); phase derived from absolute elapsed time via prefix-summed durations, so the coarse tick can't drift it. |
| 5 | Medium | `get_sprite_png` shipped a base64 data-URL **string** over JSON IPC (+33% inflation, double-encode). | Returns raw PNG bytes via binary IPC (`tauri::ipc::Response`); frontend wraps in a `Blob` + object URL (decode off the JS thread). Atlas PNG cache now holds raw bytes; object URLs revoked on cache clear. |
| 6 | Low | `create_sheet`/`import_obd` reloaded the whole `Atlas` (re-parsed `catalog-content.json`, dropped the decoded-sheet cache → full re-LZMA on next view). | `Atlas` keeps a runtime `appended_sheets` overlay; `resolve_sheet`/`all_sheets` consult it. New sheets are resolvable + browsable with no reload and a warm cache. Disk catalog still updated for persistence. |

## Notes

- Undo/redo UX is unchanged; only the storage grain changed.
- `import_obd` and bundle-open intentionally clear undo history (they
  persist to disk; an in-memory delta couldn't revert the file writes).
- The shared sprite clock ticks at 60 ms — fine because the phase is a
  pure function of elapsed time, not an accumulator.
- Binary-IPC sprites: one chokepoint (`store.fetchSpritePng`); the
  one-shot sheet PNG (`get_sheet_png_url`) stays a data URL — it's
  decoded once and cached, low value to convert.
