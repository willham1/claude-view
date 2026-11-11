#!/bin/bash
# (Re)creates the two Spotlight apps in ~/Applications so they run the launcher scripts in this repo:
#   "claude-view"       -> claude-view-open.sh (starts it in the background if needed, opens the dashboard)
#   "Stop claude-view"  -> claude-view-stop.sh
# Run again whenever the repo moves. Replaces any existing apps of the same name.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/Applications"
make_app() {   # $1 = app name, $2 = script to run
  local app="$HOME/Applications/$1.app" tmp
  tmp="$(mktemp -d)"
  printf 'do shell script quoted form of "%s"\n' "$HERE/$2" > "$tmp/main.applescript"
  rm -rf "$app"
  osacompile -o "$app" "$tmp/main.applescript"
  rm -rf "$tmp"
  echo "made $app -> $HERE/$2"
}
make_app "claude-view" "claude-view-open.sh"
make_app "Stop claude-view" "claude-view-stop.sh"
