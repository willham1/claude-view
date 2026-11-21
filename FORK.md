# This fork

Personal fork of [tombelieber/claude-view](https://github.com/tombelieber/claude-view) (MIT, Copyright 2025-2026
Tom Tang), used as a local dashboard for Claude Code sessions, sub-agents and prompt-cache warmth.
Started 2026-11-10 as a quick install; made a proper fork on 2026-11-11.

## Where things are

- **This repo (fork):** https://github.com/willham1/claude-view, working copy `~/Documents/claudeview`.
  Remotes: `origin` = the fork, `upstream` = tombelieber/claude-view.
- **Fork base:** upstream `main` at e78ca6b (2026-11-03, v0.46.3).
- **Running copy:** this folder. Spotlight "claude-view" / "Stop claude-view" (apps in `~/Applications`) run
  `fork/launcher/claude-view-open.sh` / `claude-view-stop.sh`; recreate them with `fork/launcher/make-spotlight-apps.sh`
  if the repo moves. The app runs whatever is built here (`target/release/claude-view`, `apps/web/dist`), so after
  merging changes, rebuild (see below) and restart it (Stop, then start).
- **Kept in `~/tools`:** `bun-npm` (Bun, needed to build and at run time) and the settings backup
  `claude-settings-backup-2026-11-10.json`. The original quick install there (`~/tools/claude-view`, its notes and
  scripts) was retired on 2026-11-11; its code is this fork's PR #1.
- **App data:** `~/.claude-view` (its local index and logs). Not part of the repo.

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
2. **Sub-agent context window:** the Sub-Agents tab shows per sub-agent a "ctx" line (model and effort level of the
   latest request, then start / now / peak and request count), read from `subagents/agent-*.jsonl` via `GET /api/sessions/{id}/subagents/context`, polled every 5 s on
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

7. **Sub-Agents tab on one screen:** a strip at the top shows the main session's prompt-cache countdown (with bar),
   context fill, turns and helper counts; each helper row shows its own cache countdown (`cacheTtlSeconds` from its
   transcript, counted from its latest request); long error text is cut to two lines (full text on hover); the
   timeline has a one-line "how to read it" and a colour key, colours by status (running / finished / failed), and
   sizes to its rows instead of half the panel.
8. **Sub-Agents tab, follow-up (W1):** helper rows sort by last activity, most recent first (latest of start,
   completion and the transcript's latest request; re-sorts live), `sortSubAgentsByLastActive`. The timeline is
   collapsed by default under a "Timeline" toggle (choice kept in localStorage); it stays in start order, as a Gantt
   chart (`CollapsibleTimeline.tsx`). A helper's task title is selectable text that wraps instead of being cut with
   "…" (rows can be taller): clicking or selecting it doesn't open the helper; the row's "Open" button (or a plain
   click elsewhere on the row) does. In the helper's view, the header's loaded / loading / error label is gone
   (only "running" shows); each view says "Loading…" in its body instead, and errors show there as before. Opening a helper now shows a **Progress** view by
   default, beside Chat and Developer: the helper's messages, with the tool calls between them folded into one
   expandable summary row ("Ran 5 commands, edited 1 file +10 −29"; lines counted from the edit inputs) and
   "Running …" for the call in progress; re-read every 3 s while the helper runs
   (`apps/web/src/lib/subagent-progress.ts`, `SubAgentProgressView.tsx`).

9. **Sub-Agents tab, at a glance:** each helper's type label has its own colour (builder sky, builder-browser cyan,
   reviewer violet, senior-reviewer fuchsia, Explore emerald; others get a stable colour from the name). A running
   helper's bar now means something: **blue** = its latest request finished under 2 minutes ago (working),
   **yellow** = quiet for longer but its prompt cache is still warm, **grey and still** = the cache has expired
   (stalled). A helper that shows its current activity has a dot instead of the bar; the dot uses the same colours
   and stops pulsing when expired. Hover either for the state in words. A request is only logged when it finishes,
   so a helper on one long command can show yellow, or even grey, while still busy
   (`subAgentActivity`, `agentTypeColor` in `SwimLanes.tsx`).

10. **Live Monitor sorts by last activity (LM2):** like the Sub-Agents tab, sessions show most recently active
    first and re-order live, by default in every view: Grid (the page's default sort is now "last active, newest
    first"), List (starts on the Last Active column, newest first; other column headers still sort), Board (each
    column, newest first, instead of upstream's cache-warmth / urgency order for Needs You and turn-start order for
    Running; with Project + Branch grouping, projects and branches come in order of their most recently active
    session and re-order live, where upstream froze them in first-seen order), Harness (Needs You sidebar) and
    Monitor (auto-grid panes keep their place in the page and are positioned with CSS `order`, so re-ordering
    doesn't move a terminal in the page; the auto grid now shows only as many panes as fit uncut, measured from
    the window, instead of a fixed 8 that ran past the bottom edge (an off-screen pane unmounts its terminal):
    at most 2 columns (the page is at most 1280px wide, panes at least 480px) and one row per ~304px of height, so
    a laptop window usually gets 2 or 4 panes where it showed 3–4 before, the last ones cut off; with more
    sessions than slots, the most recently active fill free slots, and a busier session takes the slot of the
    quietest pane on screen only once that pane's transcript has had no new line for 5 minutes, so panes don't
    trade places on every line written (upstream's auto-fill instead counts from when a session started waiting,
    and only in a fixed grid); a session busy on one long silent command (a build or test run over 5 minutes)
    counts as quiet and can lose its pane; selecting a pane, or arriving from History with `?focus=`, doesn't
    protect it; a session waiting on you stays for those 5 minutes too; only the leaving
    pane's terminal unmounts; pinned and "Move to front" panes are never swapped out; hiding a pane frees a slot;
    custom (dock) layouts and phones keep 8, and custom layouts never swap: their panels change only when a
    session ends, as upstream). The Board's Sort control ("Last activity", "Alphabetical", "Highest cost") still
    works; Alphabetical and
    Highest cost order the groups, cards in a column stay newest first. Alphabetical no longer freezes groups either:
    a project or branch that appears later goes into its alphabetical place (upstream added it at the bottom); Highest
    cost keeps upstream's frozen order. Picking "last active" from the command palette starts newest first (it read
    a stale or default address before). A Sort choice stored in the browser before this change is
    dropped once (marker `claude-view:kanban-sort-lm2` in localStorage), so the new default shows without clearing
    anything; later choices are kept (`live-filter.ts`, `use-kanban-grouping.ts`, `monitor-pane-order.ts`).

11. **Live Monitor columns without hooks (LM1):** upstream sets a live session's state only from hooks, so with hooks
    off (how this fork runs) every session sat in **Needs You** labelled "Unknown" and **Running** stayed empty. Until
    a hook reports on a session, its state now comes from its transcript (the same reading startup recovery used),
    refreshed on each transcript write and every 30 s. A session whose turn has ended while a background helper is
    still working shows in **Running** as "Waiting on a background helper"; a helper counts as working while its
    `subagents/agent-*.meta.json` lacks `"finished": true` and its transcript was written in the last 30 minutes
    (`crates/server/src/live/manager/transcript_state.rs`; a hook event sets `agent_state_set_at` and hands the state
    back to hooks). A question (AskUserQuestion), a plan for review (ExitPlanMode), an interrupt and a local slash
    command (`/context`, `/usage`, `/compact`) read as **Needs You**, as with hooks. If the last lines are only
    bookkeeping (no message), the state is kept, so a busy session doesn't flip columns mid-turn. A helper that has
    just finished still counts for 10 s, covering the moment before its hand-back reaches the lead's transcript,
    but only while the lead has written no message since the helper finished (compared to the millisecond). Tool
    output is never read as a local command or an interrupt. A `<task-notification>` line counts as the start of a
    turn only once a model request (`api-request` line) follows it. Leftover notices after an answered hand-back,
    and "stopped" notices written when a session is reopened, get no reply, so they don't keep a session in
    Running.
    What you will notice:
    - **Dings:** a session that ends its turn now moves into Needs You, so the Live Monitor's sound (on by default)
      chimes at each turn end. Before, every card already sat in Needs You and never moved.
    - **"Paused":** a session waiting for your prompt says "Paused" with an amber dot in its panel header, where it
      said "Running".
    - **Permission prompts are not visible:** a session stopped at a permission prompt still shows in Running as
      "Using <tool>". The transcript doesn't record the prompt; only hooks can see it.
    - **Background commands don't count:** only helpers keep an ended turn in Running. A session waiting on its own
      background command (a `run_in_background` Bash call) shows in Needs You as "Waiting for your next prompt" and
      chimes, though it will carry on by itself when the command ends.
    - **Brief false chime on a queued hand-back:** when a helper finishes while the lead is still busy, its hand-back
      is delivered 1–3 s after the lead's turn ends. If no other helper is running, the lead shows in Needs You (and
      chimes) for those seconds, then goes back to Running. Seen twice in 14 days of the owner's transcripts.

12. **Last activity follows the transcript after a restart (LM3):** upstream stamped the discovery time as a live
    session's last activity whenever it found the session (its `sessions/<pid>.json`), overwriting the transcript
    time it had just read, and nothing replaced it until the transcript was next written (an unchanged transcript
    is not re-read). So after a server restart every session not written to since showed
    the restart time ("8m ago" for all of them) and the last-activity sort (change 10) was arbitrary. Finding a
    session is no longer counted as activity: it starts at its transcript's modification time, or the process
    start time when it has no transcript yet (`coordinator/dispatch.rs`, `session_factory.rs`). Hooks still count
    as activity, including hooks that arrived before the session was found.

13. **Session cards show the same details in every state (LM4):** a Live Monitor card (Board, Grid, Harness,
    recently closed) now has detail lines under its state line, the same whether the session is running or
    awaiting input, at the Sub-Agents tab's level of detail: model and effort level of the latest request,
    request and turn counts, the prompt-cache countdown with its lifetime (hover for the cache explainer), the
    context window at the first request / now / at its peak against the window with a percentage, and helper
    counts (running / done / failed). Before, an "Awaiting input" card showed no model or tokens and a running
    card no cache countdown. The state line keeps the spinner, elapsed time and tokens (or "Awaiting input" /
    "Baked"), but leaves the model and countdown to the details. Cards are taller. The server now reads the
    main session's effort (the top-level `effort` on assistant lines), its first and peak context, and its
    request count (deduplicated by message + request id) from the transcript (`effort`, `startContextTokens`,
    `peakContextTokens`, `requestCount` on live sessions). Start and peak count from the server's start (it
    reads the whole transcript then), so peak spans compactions. A card from a server without these fields
    leaves effort, requests, start and peak out (`SessionCardDetails.tsx`). Helper cost is not on the card:
    it needs each helper's transcript, which only the Sub-Agents tab fetches.
    What you will notice:
    - **"turns" is not your prompt count:** it is upstream's turn count, which with hooks off counts every user
      line in the transcript, tool results and task notices included, so it often sits close to the request
      count. The hover says so.
    - **"helpers N running"** is the status the server reports; change 15 made it right for background helpers.

14. **(Rolled back.)** LM7 made a card's top-right cost the session total (main session plus helpers), PR #14.
    The owner rolled it back on 2026-11-15: the main session's own share was no longer visible anywhere on the
    card. The card again shows the main session's cost; the session panel's top right still shows the total.

15. **Finished helpers show as finished (LM6):** Claude Code now usually writes a background helper's hand-back
    (`<task-notification>`) as a queued command, a `queue-operation` line and a `queued_command` attachment line,
    rather than as a user line, and upstream read only user lines. So almost every background helper stayed
    "running" for good: one lead session with 28 helpers, 26 of them finished, showed "27 running, 1 done" on its
    card and a green dot on every helper in the Sub-Agents tab. All three forms are read now. One hand-back is
    written up to three times (enqueue, remove, attachment), byte-identical; only the first copy counts, so its
    time is the finish time and a copy written after the lead has resumed the helper is ignored. A helper the lead
    resumes with SendMessage (its result carries `resumedAgentId`) shows as running again until its next
    hand-back, and a notice saying the helper "is waiting on its own background work" no longer counts as
    finished (`live_parser/parse_line.rs`, `content.rs`, `subagent.rs`, `line_processor/sub_agents.rs`). The same
    session now reads "2 running, 26 done", matching each helper's `meta.json`. The card's helpers line, the
    Sub-Agents tab's strip, rows and dots all follow. How a session's own state or column is decided (change 11)
    is unchanged.
    What you will notice:
    - **Ended sessions:** History's session detail and recently closed cards turn any helper still "running" when
      the session ends into failed ("Session ended"). Before, that was nearly every background helper; now they
      read done.
    - **A helper that never reports back after "waiting on its own background work"** stays running until its
      session closes (about 2 in 1,600 such notices in the owner's history); its `meta.json` may say finished.

16. **Contributions cost prices 1-hour cache writes at the 1-hour rate:** the Contributions page's total cost and
    cost per line charged every cache write at the 5-minute rate, so sessions using 1-hour caching were undercounted
    (on Opus 4.6, $10/MTok written as $6.25). It now splits writes by lifetime like the rest of the app, from the
    5m/1h counts already stored per model in `session_stats.per_model_tokens_json` (`cache_creation_cost` in
    `crates/core/src/pricing/calculate.rs`). Writes with no recorded lifetime keep the 5-minute rate, including
    when they are summed with writes that have one (the part of the total in neither split count).

17. **Rust git hooks find the toolchain without `cargo` on PATH:** Homebrew's rustup keeps its proxies in
    `/opt/homebrew/opt/rustup/bin`, often not on PATH, so upstream's hooks failed (exit 127) and blocked every Rust
    commit and push. In `lefthook.yml`, pre-commit runs rustfmt as `"$(rustup which rustfmt)"` (follows
    `rust-toolchain.toml`), and pre-push runs `./scripts/cq deny check` instead of `cargo deny check` (cq puts the
    pinned toolchain first on PATH). Keep both when merging upstream's `lefthook.yml`.

18. **cargo-deny ignores RUSTSEC-2026-0543 (chrono unmaintained)**, the owner's decision on 2026-11-21: a maintenance
    notice with no vulnerability and no fixed version, and claude-view uses chrono throughout (`deny.toml`). Undo it
    (drop the ignore) once chrono is replaced by jiff or time, here or upstream; check when merging upstream.

## Running it

- Launcher scripts are in `fork/launcher/` and find the repo from their own location. They run read-only:
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
