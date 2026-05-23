# Architecture

Atlas Assets Editor is a desktop suite of three tools bundled into a
single Tauri 2 app. The backend is a Rust workspace (`crates/` plus
`src-tauri/`); the frontend is Vite + React + Tailwind. The tools
share the same core crates and the same UI shell — they are different
screens in one binary, not different binaries.

## Component overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        Frontend (React + TS)                       │
│  HomeScreen tile grid · AssetsEditor · OTBConverter · MapConverter │
└────────────────────────────┬───────────────────────────────────────┘
                             │ Tauri IPC (commands + events)
┌────────────────────────────▼───────────────────────────────────────┐
│                     Tauri backend (`src-tauri/`)                   │
│       assets/ · converter/ · (map/) — thin command shims,          │
│       plugin wiring, per-tool workspace state                      │
└──┬─────────────────┬──────────────────┬──────────────────┬─────────┘
   │                 │                  │                  │
┌──▼──────────┐ ┌────▼──────────┐ ┌─────▼─────────┐ ┌──────▼────────┐
│ atlas-core  │ │ atlas-        │ │ atlas-otb     │ │ atlas-sprites │
│             │ │ appearances   │ │               │ │               │
│ Shared      │ │ Read/write    │ │ Read/write    │ │ LZMA decomp + │
│ types,      │ │ .dat (prost)  │ │ .otb (+ Atlas │ │ BMP encode +  │
│ errors,     │ │ + sprite info │ │   ext attrs)  │ │ sheet writer  │
│ categories  │ │               │ │               │ │               │
└─────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
                                                    ┌───────────────┐
                                                    │ atlas-        │
                                                    │ workspace     │
                                                    │ Cross-ref     │
                                                    │ OTB ↔ proto   │
                                                    └───────────────┘
```

## The three tools

| Tool                | Status      | Backend module           | Frontend module                |
|---------------------|-------------|--------------------------|--------------------------------|
| **Assets Editor**   | Usable      | `src-tauri/src/assets/`  | `frontend/src/tools/assets/`   |
| **OTB Converter**   | Coming soon | `src-tauri/src/converter/` (stub) | `frontend/src/tools/converter/`|
| **Map Converter**   | Coming soon | not started              | not started                    |
| **Map Editor**      | Coming soon | not started              | not started                    |

The HomeScreen is the launcher; the active tool is tracked by a
`Tool` enum in `frontend/src/appStore.ts`. Each tool owns its own
backend state behind a `tauri::State<...>` wrapper and exposes its
commands with a tool prefix (`assets_*`, `converter_*`).

## Why a crate per format

- **Crate per responsibility.** `atlas-appearances`, `atlas-otb`, and
  `atlas-sprites` parse one file family each. They are independently
  testable and reusable; a server (or a CLI tool) can depend on just
  the parsers without pulling the Tauri shell.
- **Thin Tauri layer.** `src-tauri/` contains command shims, plugin
  wiring, and per-tool workspace state — no parsing logic. This keeps
  the IPC surface area small and easy to audit.
- **Frontend-agnostic core.** Swapping React for something else (or
  shipping a headless CLI) only touches `src-tauri/` and `frontend/`.

## Assets Editor: format unification

The Assets Editor treats `appearances.dat` (modern, Tibia 12+) and
`items.otb` (legacy, TFS-derived) as two views of the same catalog.
When a workspace contains both:

1. Each file parses into its own `Vec`-backed index.
2. `atlas-workspace::CrossRef` joins them by `clientId` (matches
   `appearance.id`).
3. The UI surfaces mismatches: orphan OTB items with no appearance,
   appearances missing from the OTB, conflicting attribute values.
4. Edits land on either side; an optional sync writes the change to
   the other side too.

Atlas extends OTB with attribute bytes `0x80+` so modern client fields
(imbuements, gems, vocation restrictions, weapon type, …) round-trip
through the legacy format. The byte assignments are stable and
specified in [otb-format.md](otb-format.md); the companion
[**atlas**](https://github.com/atlas-kit/atlas) OT server adopts them,
and any other TFS-derived server can do the same — classic TFS skips
them via the standard "unknown attribute" branch, so the format stays
backwards-compatible.

## State management

- **Backend state**: an open `WorkspaceState` (file paths + parsed
  models + atlas cache) lives in `tauri::State`, gated by
  `Mutex`/`RwLock`. Mutations go through commands that return a
  fresh snapshot (or just the affected row) to the frontend.
- **Frontend state**: Zustand stores keep UI-local state (selection,
  filters, modal open/close) separate from the canonical model coming
  from the backend.
- **Undo history**: per-entity snapshots, not full-workspace clones.
  Each undo entry stores just the one affected `AppearanceInfo` or
  `OtbItem` (a few KB) so the 64-slot history fits comfortably in
  memory even on a 45k-entry bundle. See
  [performance.md](performance.md) for the rationale.

## Threading

- Large-file parsing (`appearances.dat`, `items.otb`) runs on a
  worker so the IPC reply doesn't block the UI thread.
- Sprite decoding uses a lock-free `DashMap` cache keyed by sprite
  ID. Decoded sheets and PNG payloads are cached separately.
- Sprite previews are streamed as raw PNG bytes over binary IPC, not
  base64-encoded data URLs — the frontend wraps the bytes in a `Blob`
  + object URL, which decodes off the JS thread.

## Persistence

Atlas Assets Editor never silently overwrites the user's files. Save
operations:

1. Write to a temp file in the same directory.
2. Fsync.
3. Atomically rename over the original.
4. Emit a `.bak` copy of the original next to it.

The user is always asked before overwriting an existing destination
(unless they explicitly chose "Save", as opposed to "Save As").

Sprite sheet writes preserve the original 32-byte Cipsoft prefix
verbatim — we never re-derive the content checksum. The LZMA payload
is regenerated from a `BITMAPV4HEADER` 32-bpp BMP that round-trips
through our own decoder; OT-client acceptance is verified by the
user against a live client.
