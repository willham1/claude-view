#!/bin/bash
# Stops the claude-view dashboard if it is running.
pkill -x claude-view && osascript -e 'display notification "claude-view stopped" with title "claude-view"'
exit 0
