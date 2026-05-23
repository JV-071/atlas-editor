# Atlas Editor

[![CI](https://github.com/atlas-kit/atlas-assets-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/atlas-kit/atlas-assets-editor/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A desktop suite of Tibia 12+/15.x asset tools, bundled into a single
Tauri 2 app for Windows, macOS, and Linux.

- **Assets Editor** — browse and edit a modern client assets bundle
  (`appearances.dat` + sprite sheets) and the optional `items.otb`
  server catalog, with undo/redo, cross-reference badges, sprite
  editing, GIF/PNG export, and `.obd` cross-client import.
- **OTB Converter** — turn a legacy server bundle (`items.otb` plus
  Tibia 7.x–10.x `.dat`/`.spr`) into a modern Tibia 12+ assets
  folder. _Coming soon._
- **Map Converter** — convert item IDs in `.otbm` maps between client
  IDs and server IDs. _Coming soon._
- **Map Editor** — load and edit `.otbm` worlds. _Coming soon._

The Assets Editor is the only tool that is shippable today. The
others are placeholders in the launcher while the underlying parsers
catch up.

## Documentation

All deeper docs live under [`docs/`](docs/):

- [Build & dev setup](docs/build.md) — prerequisites, dev loop, and
  production installers per platform.
- [Architecture](docs/architecture.md) — crate split, IPC model,
  state management, persistence guarantees.
- [OTB format extensions](docs/otb-format.md) — byte-level spec of
  the `0x80+` Atlas attributes so any server can adopt them.
- [Legacy `.spr` notes](docs/spr-legacy.md) — for the planned
  cross-client importer.
- [Roadmap](docs/ROADMAP.md) — reference-port phases and status.
- [Performance audit](docs/PERFORMANCE.md) — recent findings and
  fixes.
- [Contributing](docs/contributing.md) — PR flow, code style,
  release procedure.

## Quick start

```bash
git clone https://github.com/atlas-kit/atlas-assets-editor.git
cd atlas-assets-editor
npm --prefix frontend install
cargo install tauri-cli --version "^2.0" --locked
cargo tauri dev
```

Hit a snag? See [`docs/build.md`](docs/build.md) for full
prerequisites and OS-specific setup.

## License

[Apache License 2.0](LICENSE). Atlas Editor is free for commercial
and non-commercial use, including in proprietary or paid Tibia
servers.
