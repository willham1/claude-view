#!/bin/bash
# Opens the claude-view dashboard, starting it in the background first if it isn't running.
URL="http://localhost:47892"
if ! curl -s -o /dev/null "$URL"; then
  mkdir -p "$HOME/.claude-view/logs"
  NO_OPEN=1 nohup "$HOME/tools/Start claude-view.command" >>"$HOME/.claude-view/logs/launcher.log" 2>&1 &
  for i in $(seq 1 40); do curl -s -o /dev/null "$URL" && break; sleep 0.5; done
fi
open "$URL"
