#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/school_israel_expo.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No running Expo PID file found."
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID" || true
  echo "Stopped Expo (pid=$PID)."
else
  echo "Expo process already stopped."
fi

rm -f "$PID_FILE"
