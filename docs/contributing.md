# Contributing

Thanks for considering a contribution. Local setup and the build flow
live in [build.md](build.md); this document covers the PR flow,
coding standards, and release procedure.

## Branching

- Land everything on `main` via pull request.
- One change per branch — split unrelated work into separate PRs.
- Branch naming is unconstrained, but `feat/`, `fix/`, `refactor/`,
  `docs/` prefixes help reviewers triage.

## Code style

- **Rust**: `cargo fmt --all` and
  `cargo clippy --workspace --all-targets -- -D warnings` must pass.
- **TypeScript/React**: 2-space indent, double quotes. Follow Tailwind
  utility-class ordering.
- **Commits**: conventional commits format
  (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`).
  Keep the subject under 70 characters; put detail in the body.

## Tests

- Rust: `cargo test --workspace --all-targets`.
- Frontend: `npm --prefix frontend run typecheck` and
  `npm --prefix frontend run lint`. No UI test runner yet.
- CI runs both on every push and PR.

## Documentation

- All repo artifacts (code, commit messages, PR descriptions, docs)
  are written in English. The chat in PRs and issues can be in any
  language the reviewer is comfortable with.
- Surface user-facing changes in [roadmap.md](ROADMAP.md) and add
  format-spec notes to [otb-format.md](otb-format.md) where relevant.

## Releases

Releases are built by GitHub Actions on tag push. Before tagging, run
the **exact checks CI runs** locally and bump the version in all three
manifests:

```bash
# 1. Run the full CI matrix locally — the release workflow does NOT run
#    these, so a green release build does not imply a green CI.
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm --prefix frontend run build   # tsc -b + vite build

# 2. Bump the version in all three manifests (keep them in lockstep):
#    - Cargo.toml            [workspace.package] version
#    - frontend/package.json version   (the UI footer reads this at build time)
#    - src-tauri/tauri.conf.json version
#    Then `cargo check` once to refresh Cargo.lock.

# 3. Push main, wait for CI to go GREEN, then tag:
git push origin main
# …confirm the CI run on that commit succeeded…
git tag vX.Y.Z
git push origin vX.Y.Z
```

`.github/workflows/release.yml` builds Windows, macOS (universal),
and Linux installers in parallel via
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action),
attaches them to a draft GitHub Release, and promotes it to published
once every job succeeds. Manual dispatch with a `version` input also
works for re-running a release without re-tagging.

The frontend footer version is injected from `frontend/package.json`
at build time (Vite `define`), so it can never drift from the release —
just keep package.json in lockstep with the other two manifests.

Installer code signing (Apple/Windows certificates) is not set up;
builds are distributed unsigned. That is separate from updater signing
below.

## In-app updates

The app self-updates via `tauri-plugin-updater`. On launch it polls the
latest release's `latest.json` and, if a newer **signed** build exists,
offers a one-click download-install-relaunch (see
`frontend/src/UpdateBanner.tsx`).

For a release to be updatable, its artifacts must be signed. The
keypair was generated once with `cargo tauri signer generate`; the
**public** key lives in `tauri.conf.json` (`plugins.updater.pubkey`).
The **private** key must be added to the repo as two GitHub Actions
secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | full contents of the generated `.key` file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key's password (empty string if none) |

`release.yml` passes both to `tauri-action`, which signs every
installer and uploads `latest.json` to the release. Without the
secrets the build still succeeds but ships no updater manifest, so
clients won't see the update.

Note: the updater only works **forward** — a release made before the
updater existed (≤ v0.2.1) can't auto-update; users install the first
updater-enabled build manually, and every release after that updates
in place. Losing the private key means cutting a new keypair and a
manual reinstall for everyone, so keep it backed up.

## License

By contributing, you agree your contributions will be licensed under
the Apache License 2.0 (see [`LICENSE`](../LICENSE)).
