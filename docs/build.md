# Building Atlas Assets Editor

Atlas Assets Editor is a Tauri 2 app: a Rust workspace under
`crates/` and `src-tauri/`, plus a Vite + React frontend under
`frontend/`. This document walks through every supported platform and
the most common pitfalls.

## Prerequisites

| Requirement | Version            | Notes                                       |
|-------------|--------------------|---------------------------------------------|
| Rust        | 1.80+              | Toolchain pinned by `rust-toolchain.toml`   |
| Node.js     | 20+                | LTS recommended                             |
| npm         | 10+                | Bundled with Node                           |
| Tauri CLI   | `^2.0`             | One-time `cargo install`                    |

Atlas Assets Editor uses Tauri's native dependencies for its window
shell, so you also need a few OS-level packages. The official Tauri
prerequisites page is the source of truth:
[tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/).
The summary below covers the common case.

### Windows

1. Install **Microsoft Visual Studio Build Tools** with the
   "Desktop development with C++" workload (gives you MSVC + the
   Windows 10/11 SDK).
2. **WebView2** ships with Windows 11 and most Windows 10 boxes; if it
   is missing, grab the Evergreen Bootstrapper from Microsoft.
3. Install Rust via `rustup` (`https://rustup.rs`). Pick the
   `x86_64-pc-windows-msvc` host triple.
4. Install Node.js 20+ from the official installer or via `winget`:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

### macOS

1. Install the **Xcode Command Line Tools**:
   ```bash
   xcode-select --install
   ```
2. Install Rust via `rustup`.
3. Install Node.js 20+ (Homebrew or the official installer):
   ```bash
   brew install node@20
   ```

For a universal `.dmg` (Intel + Apple Silicon) the Rust toolchain needs
both targets:

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
```

### Linux

Debian / Ubuntu:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  build-essential \
  curl wget file
```

Fedora:

```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  gtk3-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  openssl-devel \
  curl wget file
```

Arch:

```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg \
  base-devel curl wget file
```

Then install Rust via `rustup` and Node.js 20+ via your distro or
`nvm`.

## Clone and bootstrap

```bash
git clone https://github.com/atlas-kit/atlas-assets-editor.git
cd atlas-assets-editor

# Frontend deps
npm --prefix frontend install

# Tauri CLI (one-time, global)
cargo install tauri-cli --version "^2.0" --locked
```

## Run in development

```bash
cargo tauri dev
```

This spawns the Vite dev server (via `beforeDevCommand`) and a Tauri
window with hot reload for both Rust and TypeScript.

If you want to run the two halves separately — useful when debugging
the frontend in a regular browser tab:

```bash
# Terminal 1
npm --prefix frontend run dev

# Terminal 2
cargo tauri dev
```

## Production build

```bash
cargo tauri build
```

Outputs platform installers under `src-tauri/target/release/bundle/`:

| Platform | Artifacts                          |
|----------|------------------------------------|
| Windows  | `.msi`, `.exe` (NSIS)              |
| macOS    | `.dmg`, `.app`                     |
| Linux    | `.AppImage`, `.deb`, `.rpm`        |

Builds are unsigned by default. Code-signing setup is documented in
[contributing.md](contributing.md#releases) when you cut a release.

## Tests and lint

```bash
# Rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets

# Frontend
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

CI runs the same commands on every push and PR — see
`.github/workflows/ci.yml`.

## Troubleshooting

### `cargo tauri dev` hangs on first launch

Tauri compiles ~600 crates on a clean checkout. The first build can
take 5–15 minutes depending on CPU; subsequent builds are incremental
and finish in seconds. The Vite dev server only starts after the Rust
side compiles.

### `webkit2gtk` link errors on Linux

Make sure you installed the `4.1` variant, not `4.0`. Tauri 2 dropped
the older one. On Ubuntu 22.04 you may need the upstream PPA — Ubuntu
24.04 has it in the default repos.

### MSVC: `link.exe not found` on Windows

The Visual Studio Build Tools installation either skipped the C++
workload or you have multiple Visual Studio versions and Rust picked
the wrong one. Reinstall the Build Tools with the C++ workload, then
restart your shell so `PATH` picks up the new `link.exe`.

### Build succeeds but installer is missing

`cargo tauri build` shows the bundle paths at the end. On Linux, the
default config emits AppImage + deb + rpm; if only some show up, check
that `appimagetool`, `dpkg`, and `rpmbuild` are on your PATH. They are
not strictly required, but missing tools just skip the matching
bundle.

### Cargo lock conflicts after pulling

Atlas Assets Editor pins exact versions for reproducible builds. If
`git pull` leaves `Cargo.lock` modified, run `cargo build` once — it
will rewrite the lockfile to match the workspace manifests. Do not
hand-edit it.

## Release builds via GitHub Actions

Tagged pushes (`v*`) trigger `.github/workflows/release.yml`, which
builds installers for all three platforms in parallel and attaches
them to a draft GitHub Release. See
[contributing.md#releases](contributing.md#releases) for the tag-cut
procedure.
