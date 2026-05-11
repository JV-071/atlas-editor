# Architecture

Atlas Assets Editor is a desktop application built with a Rust backend
(Tauri 2) and a TypeScript/React frontend (Vite). The goal is to unify
editing of two complementary file formats — modern `appearances.dat`
(Protocol Buffers, Tibia 12+) and legacy `items.otb` (binary TLV) — into a
single workspace.

## Component overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        Frontend (React + TS)                       │
│  Item list · Sprite viewer · Attribute editor · Import/Export UI   │
└────────────────────────────┬───────────────────────────────────────┘
                             │ Tauri IPC (commands + events)
┌────────────────────────────▼───────────────────────────────────────┐
│                     Tauri backend (`src-tauri/`)                   │
│            Thin command shims, plugin wiring, app state            │
└──┬─────────────────┬──────────────────┬──────────────────┬─────────┘
   │                 │                  │                  │
┌──▼──────────┐ ┌────▼──────────┐ ┌─────▼─────────┐ ┌──────▼────────┐
│ atlas-core  │ │ atlas-        │ │ atlas-otb     │ │ atlas-sprites │
│             │ │ appearances   │ │               │ │               │
│ Shared      │ │ Read/write    │ │ Read/write    │ │ LZMA decomp.  │
│ types       │ │ .dat (prost)  │ │ .otb (+ Atlas │ │ + image       │
│             │ │               │ │   ext attrs)  │ │   decoding    │
└─────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
```

## Why this split

- **Crate per responsibility.** Each format parser is independently
  testable and reusable. Other tools (or even the atlas-server itself, if
  licensing allows in the future) can depend on `atlas-otb` or
  `atlas-appearances` alone.
- **Thin Tauri layer.** The backend should not contain business logic —
  only IPC plumbing. This keeps the surface area for permissions and
  serialization small.
- **Frontend-agnostic core.** Swapping the UI framework later (or shipping
  a CLI tool reusing the same crates) is trivial.

## Format unification

The editor maintains an in-memory model where items can carry data from
either source (or both). When a workspace contains both an
`appearances.dat` and an `items.otb`, the editor:

1. Loads both into separate `Vec`-backed indices.
2. Cross-references them by `clientId` (which matches `appearance.id`).
3. Surfaces mismatches to the user (e.g. an item exists in OTB but not in
   the appearances file, or vice versa).
4. Lets the user edit attributes on either side, with optional sync.

See [`otb-format.md`](otb-format.md) for the byte-level specification of
the Atlas OTB extensions.

## State management

- **Backend state**: an open `Workspace` (paths + parsed models) lives in
  `tauri::State`, gated by `Mutex`/`RwLock`. Mutations go through commands
  that return a fresh snapshot to the frontend.
- **Frontend state**: Zustand stores keep UI-local state (selection,
  filters, modal open/close) separate from the canonical model coming
  from the backend.

## Threading

- Heavy parsing (large `.dat` or `.otb` files) runs on a `tokio` or
  `rayon` worker so the UI thread stays responsive.
- Sprite decoding uses a lock-free `DashMap` cache keyed by sprite ID.

## Persistence

Atlas Assets Editor never silently overwrites the user's files. Save
operations write to a temp file then atomically rename, and the user is
always asked before overwriting an existing path (unless they explicitly
chose "Save"). Backups (`.bak`) are written next to the original on every
save.
