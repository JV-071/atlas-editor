# Atlas Editor

> A desktop suite of three Tibia 12+/15.x asset tools, bundled into a
> single Tauri 2 app for Windows, macOS, and Linux:
>
> - **Assets Editor** — browse and edit a modern client assets bundle
>   (`appearances.dat` + sprite sheets) and the optional `items.otb`
>   server catalog, with undo/redo + cross-reference badges.
> - **OTB Converter** — turn a legacy server bundle (`items.otb` plus
>   Tibia 7.x–10.x `.dat`/`.spr`) into a modern Tibia 12+ assets folder.
> - **Map Editor** — coming soon.

[![CI](https://github.com/atlas-kit/atlas-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/atlas-kit/atlas-editor/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-phase_6-blue.svg)](docs/architecture.md)

## What it is

A desktop launcher with three sibling tools that share the same Rust
core (`atlas-appearances`, `atlas-otb`, `atlas-sprites`, etc.) and
the same React+Tailwind UI shell.

- The **Assets Editor** treats `appearances.dat` and `items.otb` as
  two views of the same catalog, keeping them in sync — including
  modern client features the classic OTB format never had (imbuements,
  gems, vocation restrictions, weapon type, …).
- The **OTB Converter** takes a server bundle from an older client
  and emits a fresh assets folder targeting Tibia 12+/15.x.
- The **Map Editor** will eventually load `.otbm` worlds.

The OTB format extensions are open and specified in
[`docs/otb-format.md`](docs/otb-format.md), so any server can adopt them.

## Status

**Phase 6 — usable editor.** The Assets Editor is the most complete
tool: open `appearances.dat` + `items.otb` from disk, browse 30k+
items in a virtualized list with category tabs and cross-reference
badges, edit the common subset of attributes on both sides, undo/redo,
save with `.bak` backups, create new objects/OTB items from scratch,
and preview sprites once the client's `assets/` directory is pointed
at. Multi-OS installers are produced by GitHub Actions on tag push.

The **OTB Converter** has its UI scaffolded but the legacy `.dat`/
`.spr` readers and the modern sheet writer are still TODO — see
`docs/phase-7-todo.md`. The **Map Editor** is a placeholder card.

## Roadmap

| Phase | Goal                                          | Status   |
|-------|-----------------------------------------------|----------|
| 0     | Workspace, Tauri shell, CI, docs              | ✓ done   |
| 1     | `atlas-appearances` and `atlas-otb` parsers   | ✓ done   |
| 2     | Open file, virtualized item list, search      | ✓ done   |
| 3     | Attribute editor + save with undo/redo        | ✓ done   |
| 4     | Sprite rendering (read-only)                  | ✓ done¹  |
| 5     | Multi-OS releases via `tauri-action`          | ✓ done   |
| 6     | Create new items, import PNG → sprites        | ◑ partial² |
| 7     | Full sprite editor (cut, animate, sheets)     | ☐ todo   |

¹ Catalog parsing, sheet decompression, and sprite extraction are
  implemented and unit-tested. The sheet header offset assumes the
  modern Tibia 12+ layout; flip `Atlas::with_bmp_wrap(true)` if your
  client uses BMP-wrapped sheets.

² Create-new-item flows are wired in. PNG → sprite import is deferred
  until Phase 7 because it requires writing into the sprite atlas.

## Setup

### Prerequisites

- **Rust 1.80+** (toolchain pinned by `rust-toolchain.toml`)
- **Node.js 20+**
- **OS-specific Tauri prerequisites**:
  - Windows: WebView2 (preinstalled on Win11), MSVC build tools
  - macOS: Xcode CLI tools
  - Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`

Full list: [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/).

### Install

```bash
git clone https://github.com/atlas-kit/atlas-assets-editor.git
cd atlas-assets-editor

# Frontend
npm --prefix frontend install

# Tauri CLI (one-time)
cargo install tauri-cli --version "^2.0" --locked
```

### Dev

```bash
cargo tauri dev
```

This spawns the Vite dev server and a Tauri window with hot reload for
both Rust and TypeScript.

### Build

```bash
cargo tauri build
```

Outputs platform installers (`.msi`, `.dmg`, `.AppImage`, `.deb`) in
`src-tauri/target/release/bundle/`.

## Repository layout

```
atlas-editor/
├── crates/                  Shared Rust libraries
│   ├── atlas-core/          Shared types (AssetId, errors, categories)
│   ├── atlas-appearances/   Read/write appearances.dat (prost)
│   ├── atlas-otb/           Read/write items.otb + Atlas extensions
│   ├── atlas-sprites/       LZMA decompression + PNG decoding
│   └── atlas-workspace/     Cross-ref between OTB and appearances
├── src-tauri/
│   └── src/
│       ├── lib.rs           Tauri entry — registers commands per tool
│       ├── assets/          Assets Editor commands + edits dispatcher
│       └── converter/       OTB Converter commands (stub today)
├── frontend/
│   └── src/
│       ├── App.tsx          Top-level tool router
│       ├── HomeScreen.tsx   Tile grid for picking a tool
│       ├── appStore.ts      `currentTool` Zustand store
│       ├── shared/          Logo + cn() helper
│       └── tools/
│           ├── assets/      Launcher + Editor + sub-components
│           ├── converter/   File-picker UI (logic pending)
│           └── map/         Coming-soon placeholder
├── docs/
│   ├── architecture.md      Component overview
│   ├── otb-format.md        Byte-level spec of OTB extensions
│   ├── spr-legacy.md        Legacy .spr format notes
│   ├── phase-7-todo.md      Outstanding work
│   └── contributing.md      Dev setup and PR flow
└── .github/workflows/       CI (multi-OS rust + frontend)
```

See [`docs/architecture.md`](docs/architecture.md) for the deeper
picture.

## License

[Apache License 2.0](LICENSE). Atlas Editor is free for commercial
and non-commercial use, including in proprietary or paid Tibia servers.
