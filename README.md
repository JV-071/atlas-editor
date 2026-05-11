# Atlas Assets Editor

> Atlas Assets Editor bridges legacy OTB and modern `appearances.dat` into a
> single workspace for Tibia 15.x — built with Rust and Tauri 2 for Windows,
> macOS, and Linux. Edit items, sprites, outfits, and effects with full
> attribute control, and seamlessly mirror modern client features like
> imbuements, gems, and vocation restrictions.

[![CI](https://github.com/atlas-kit/atlas-assets-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/atlas-kit/atlas-assets-editor/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-phase_0-orange.svg)](docs/architecture.md)

## What it is

A desktop editor for Tibia 12+/15.x game assets. Unlike existing tools
that focus on either `appearances.dat` *or* `items.otb`, Atlas Assets
Editor treats them as two views of the same catalog and keeps them in
sync — including modern client features that the classic OTB format
never had (imbuements, gems, vocation restrictions, weapon type, …).

The format extensions are open and specified in
[`docs/otb-format.md`](docs/otb-format.md), so any server can adopt them.

## Status

**Phase 0 — bootstrap.** The repository scaffolding compiles end-to-end
(Rust workspace + Tauri shell + React frontend), but no real editing
features are implemented yet. See the roadmap below.

## Roadmap

| Phase | Goal                                          |
|-------|-----------------------------------------------|
| 0     | Workspace, Tauri shell, CI, docs (current)    |
| 1     | `atlas-appearances` and `atlas-otb` parsers   |
| 2     | Open file, virtualized item list, search      |
| 3     | Attribute editor + save with undo/redo        |
| 4     | Sprite rendering (read-only)                  |
| 5     | Multi-OS releases via `tauri-action`          |
| 6     | Create new items, import PNG → sprites        |
| 7     | Full sprite editor (cut, animate, sheets)     |

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
atlas-assets-editor/
├── crates/
│   ├── atlas-core/          Shared types (AssetId, errors, categories)
│   ├── atlas-appearances/   Read/write appearances.dat (prost)
│   ├── atlas-otb/           Read/write items.otb + Atlas extensions
│   └── atlas-sprites/       LZMA decompression + PNG decoding
├── src-tauri/               Tauri 2 backend (thin IPC layer)
├── frontend/                React + Vite + Tailwind UI
├── docs/
│   ├── architecture.md      Component overview
│   ├── otb-format.md        Byte-level spec of OTB extensions
│   └── contributing.md      Dev setup and PR flow
└── .github/workflows/       CI (multi-OS rust + frontend)
```

See [`docs/architecture.md`](docs/architecture.md) for the deeper
picture.

## License

[Apache License 2.0](LICENSE). Atlas Assets Editor is free for commercial
and non-commercial use, including in proprietary or paid Tibia servers.
