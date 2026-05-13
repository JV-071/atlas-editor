# Contributing

Thanks for considering a contribution. This document covers local setup,
coding standards, and the PR flow.

## Prerequisites

- **Rust 1.80+** with `rustfmt` and `clippy` (installed automatically by
  `rust-toolchain.toml`).
- **Node.js 20+** and `npm`.
- **Tauri prerequisites** for your OS — see
  [https://tauri.app/start/prerequisites/](https://tauri.app/start/prerequisites/).

## Local development

```bash
git clone https://github.com/atlas-kit/atlas-assets-editor.git
cd atlas-assets-editor

# Install frontend deps
npm --prefix frontend install

# Run the desktop app in dev mode (auto-reload on Rust + frontend changes)
npm --prefix frontend run dev   # one terminal — Vite dev server
cargo tauri dev                 # another terminal — Tauri shell
```

Or simply run `cargo tauri dev` and let Tauri spawn the Vite dev server
via `beforeDevCommand` in `tauri.conf.json`.

## Build

```bash
cargo tauri build
```

Outputs platform installers under `src-tauri/target/release/bundle/`.

## Code style

- **Rust**: `cargo fmt --all` and `cargo clippy --workspace --all-targets
  -- -D warnings` must pass.
- **TypeScript/React**: 2-space indent, double quotes. Follow Tailwind
  utility-class ordering.
- **Commits**: conventional commits format
  (`feat:`, `fix:`, `chore:`, `docs:`, etc.). Keep the subject under 70
  characters.

## Tests

- Rust: `cargo test --workspace`.
- Frontend: there are no UI tests in the Phase 0 bootstrap yet.

## Releases

Releases are built by GitHub Actions on tag push. To cut a release:

```bash
# Bump version in src-tauri/tauri.conf.json + Cargo.toml first.
git tag v0.2.0
git push origin v0.2.0
```

The `.github/workflows/release.yml` workflow builds Windows, macOS
(universal), and Linux installers in parallel via
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action),
attaches them to a draft GitHub Release, and promotes it to published
once every job succeeds. Manual dispatch with a `version` input also
works for re-running a release without re-tagging.

Builds are unsigned by default. If/when code signing is set up, add the
secrets the action documents (`APPLE_CERTIFICATE`, `TAURI_PRIVATE_KEY`,
etc.) and pass them through `env:` in the release workflow.

## License

By contributing, you agree your contributions will be licensed under the
Apache License 2.0 (see `LICENSE`).
