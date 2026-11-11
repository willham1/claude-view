#!/bin/bash
# Starts claude-view (built from source on 2026-11-10, MIT licence) and opens it in the browser.
# Double-click in Finder to start. Close this Terminal window (or press Ctrl+C) to stop it.
# It runs read-only (see CLAUDE_VIEW_SKIP_HOOKS below) and leaves ~/.claude/settings.json alone.
# Settings backup taken before the first run: ~/tools/claude-settings-backup-2026-11-10.json
cd "$HOME/tools/claude-view" || exit 1
unset CLAUDECODE CLAUDE_CODE_SSE_PORT CLAUDE_CODE_ENTRYPOINT
export CLAUDE_VIEW_TELEMETRY=0            # belt and braces: source builds have no analytics key anyway
# Read-only mode: do not add hooks/status line to ~/.claude/settings.json. Live view, cache warm/cold,
# subagents and history all work from the session log files. Remove this line for the extra hook detail.
export CLAUDE_VIEW_SKIP_HOOKS=1
export STATIC_DIR="$HOME/tools/claude-view/apps/web/dist"
export PATH="$HOME/tools/bun-npm/node_modules/.bin:$PATH"
export RUST_LOG=warn,claude_view_server=info
[ -z "$NO_OPEN" ] && (sleep 4; open "http://localhost:47892") &
exec ./target/release/claude-view
