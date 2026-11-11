# This fork

Personal fork of [tombelieber/claude-view](https://github.com/tombelieber/claude-view) (MIT, Copyright 2025-2026
Tom Tang), used as a local dashboard for Claude Code sessions, sub-agents and prompt-cache warmth.
Started 2026-11-10 as a quick install; made a proper fork on 2026-11-11.

## Where things are

- **This repo (fork):** https://github.com/willham1/claude-view, working copy `~/Documents/claudeview`.
  Remotes: `origin` = the fork, `upstream` = tombelieber/claude-view.
- **Fork base:** upstream `main` at e78ca6b (2026-11-03, v0.46.3).
- **Running copy (as of 2026-11-11):** the app you start from Spotlight is still the build in `~/tools/claude-view`
  (branch `local/owner-fixes`, same code as this fork's fixes). Notes for it: `~/tools/claude-view-NOTES.md`.
  Moving the build here means changing `cd` and `STATIC_DIR` in the launcher (see `fork/launcher/`) and rebuilding.

## Branches and workflow

- `main` = upstream plus our merged changes. Each change goes on its own branch and lands through a PR on the fork
  (`gh` is set to default to `willham1/claude-view`; never open PRs against upstream unless the owner asks).
- Commits use the GitHub no-reply address, not the Mac's local email.
- **Updating from upstream:** `git fetch upstream && git merge upstream/main` on a branch, rebuild, run the checks
  below, PR it into `main`.

## Changes over upstream

1. **Prompt-cache countdown uses the real lifetime** the session wrote: 1 hour when the latest cache write was 1h
   (`cache_creation.ephemeral_1h_input_tokens`), 5 minutes when 5m or unknown. Upstream hard-coded 5 minutes.
   Applies to warm/cold status, card countdown/tooltip and the resume cost estimate
   (`crates/core/src/cache_ttl.rs`, `cacheTtlSeconds` on live sessions, `apps/web/src/lib/cache-ttl.ts`).
2. **Sub-agent context window:** the Sub-Agents tab shows per sub-agent a "ctx" line (start / now / peak and request
   count), read from `subagents/agent-*.jsonl` via `GET /api/sessions/{id}/subagents/context`, polled every 5 s on
   live sessions, cached per file (size + mtime).
3. **Context window from the model** (`apps/web/src/lib/model-context-windows.ts`): models that are 1M natively in
   Claude Code's model table (Opus 5.5/5/4.8/4.7, Sonnet 5.5/5, Haiku 5.5, Fable 5.2/5.1/5, Mythos 5.x) get 1M from
   the first request; others keep upstream's rule. Autocompact reserve is a fixed 33k tokens.
4. **Sub-agent cost** (list-price equivalent): background helpers report no usage to the parent transcript, so
   upstream showed $0.00. Each helper is now priced from its own transcript. Fable 5.2 and Haiku 5.5 added to
   `data/anthropic-pricing.json`. Not modelled: Haiku 5.5's higher rate for prompts over 100k.
5. Helper cost is not double-counted in team sessions.
6. **Security advisories (2026-11-11):** tokio 1.52.3 -> 1.54.1 (RUSTSEC-2026-0386). SQLite (RUSTSEC-2026-0459,
   CVE-2026-119375, fixed in SQLite 3.54.0): upstream bundles a vulnerable SQLite inside libsqlite3-sys 0.30.1, and
   sqlx (0.8 and the newest 0.9) can't use the fixed libsqlite3-sys 0.39 yet. macOS's own SQLite lacks functions
   sqlx needs, so the fork builds without `bundled` and links **Homebrew's SQLite** (`.cargo/config.toml`).
   - Needs `brew install sqlite`; keep it current with `brew upgrade sqlite` (no rebuild needed for SQLite fixes).
   - `crates/db/tests/sqlite_version.rs` fails if the linked SQLite is older than 3.54.0; `deny.toml` ignores the
     advisory on that basis.
   - Undo all of this (restore `bundled` on rusqlite and `sqlite` on sqlx, drop the config and ignore) once sqlx
     accepts libsqlite3-sys >= 0.39 — check when merging upstream.

## Running it

- Launcher scripts are in `fork/launcher/` (copies of the ones in `~/tools`). They run read-only:
  `CLAUDE_VIEW_SKIP_HOOKS=1` so it never edits `~/.claude/settings.json`, and `CLAUDE_VIEW_TELEMETRY=0`.
  Don't turn hook mode on without the owner's say-so.
- Source builds have no analytics key, and login/sharing/mobile relay are off (no SUPABASE/RELAY/SHARE URLs).
- **Build** (PATH needs Rust from Homebrew `rustup`, `$(brew --prefix rustup)/bin`, and Bun from `~/tools/bun-npm`):
  `bun install && bun run build:sidecar && (cd apps/web && bun run build) && cargo build --release -p claude-view-server`
  Run it **from inside the repo** (that's where `.cargo/config.toml` points the build at Homebrew's SQLite), then
  confirm with `otool -L target/release/claude-view | grep sqlite`: it must show `/opt/homebrew/opt/sqlite/lib/...`.
  If it shows `/usr/lib/libsqlite3.dylib` or nothing, the build missed the config (or `SQLITE3_LIB_DIR` was set in
  the shell): rebuild from the repo root.
- **Don't use upstream's Release workflow** (`.github/workflows/release.yml`, runs on `v*` tags or by hand): its
  runners have no Homebrew SQLite, and its binaries are for distribution, which this fork doesn't do.

## Checks

- `cargo test -p claude-view-core --lib`
- From `apps/web`: root `node_modules/.bin/vitest run` (one test reads a cwd-relative path) and
  `tsc --noEmit -p apps/web/tsconfig.json`.
- Biome: pass `--config-path <repo>/biome.json`, or it reformats with its defaults.
