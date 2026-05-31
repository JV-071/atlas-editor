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

Builds are unsigned by default. If/when code signing is set up, add
the secrets the action documents (`APPLE_CERTIFICATE`,
`TAURI_PRIVATE_KEY`, `WINDOWS_CERTIFICATE`, etc.) and pass them
through `env:` in the release workflow.

## License

By contributing, you agree your contributions will be licensed under
the Apache License 2.0 (see [`LICENSE`](../LICENSE)).
