#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-8088}"
PID_FILE="/tmp/school_israel_expo.pid"
LOG_FILE="/tmp/school_israel_expo.log"

cd "$ROOT_DIR"

get_local_ip() {
  local ip=""
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" { print $2; exit }' || true)"
  fi
  echo "$ip"
}

start_expo() {
  local mode="$1"
  EXPO_NO_TELEMETRY=1 npx expo start --"$mode" --port "$PORT" >"$LOG_FILE" 2>&1 &
  local pid="$!"
  echo "$pid" > "$PID_FILE"
  echo "Started Expo ($mode) (pid=$pid), waiting..."
}

CURRENT_PID=""
if [[ -f "$PID_FILE" ]]; then
  CURRENT_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${CURRENT_PID}" ]] && kill -0 "$CURRENT_PID" 2>/dev/null; then
    echo "Expo already running (pid=$CURRENT_PID)."
  else
    rm -f "$PID_FILE"
    CURRENT_PID=""
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  start_expo "tunnel"
  CURRENT_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
fi

ATTEMPTS=180
SLEEP_SEC=1
MANIFEST=""
HOST_URI=""
TUNNEL_HOST=""
for ((i=1; i<=ATTEMPTS; i++)); do
  if ! MANIFEST="$(curl -sS "http://127.0.0.1:${PORT}" 2>/dev/null)"; then
    sleep "$SLEEP_SEC"
    continue
  fi

  if [[ -z "$MANIFEST" ]]; then
    sleep "$SLEEP_SEC"
    continue
  fi

  HOST_URI="$(node -e "try { const data = JSON.parse(process.argv[1]); process.stdout.write((data?.extra?.expoClient?.hostUri || '').trim()); } catch { process.stdout.write(''); }" "$MANIFEST")"
  if [[ "$HOST_URI" == *".exp.direct" ]] && curl -fsS --max-time 5 "https://$HOST_URI" >/dev/null 2>&1; then
    TUNNEL_HOST="$HOST_URI"
    break
  fi

  if rg -q "CommandError: failed to start tunnel|remote gone away" "$LOG_FILE" 2>/dev/null; then
    break
  fi

  if [[ -n "${CURRENT_PID}" ]] && ! kill -0 "$CURRENT_PID" 2>/dev/null; then
    break
  fi

  sleep "$SLEEP_SEC"
done

if [[ -n "$TUNNEL_HOST" ]]; then
  echo ""
  echo "Project links:"
  echo "- Expo Go: exp://$TUNNEL_HOST"
  echo "- Browser/manifest: http://127.0.0.1:${PORT}"
  echo "- Tunnel host: https://$TUNNEL_HOST"
  echo ""
  echo "Logs: $LOG_FILE"
  echo "Stop: $ROOT_DIR/scripts/project-robot-stop.sh"
  exit 0
fi

# Tunnel can fail when ngrok is unavailable. Fall back to LAN mode automatically.
echo "Tunnel is unavailable, switching to LAN mode..."
if [[ -n "${CURRENT_PID}" ]] && kill -0 "$CURRENT_PID" 2>/dev/null; then
  kill "$CURRENT_PID" || true
fi
rm -f "$PID_FILE"
start_expo "lan"
CURRENT_PID="$(cat "$PID_FILE" 2>/dev/null || true)"

LAN_HOST=""
HOST_URI=""
for ((i=1; i<=ATTEMPTS; i++)); do
  if ! MANIFEST="$(curl -sS "http://127.0.0.1:${PORT}" 2>/dev/null)"; then
    sleep "$SLEEP_SEC"
    continue
  fi

  if [[ -z "$MANIFEST" ]]; then
    sleep "$SLEEP_SEC"
    continue
  fi

  HOST_URI="$(node -e "try { const data = JSON.parse(process.argv[1]); process.stdout.write((data?.extra?.expoClient?.hostUri || '').trim()); } catch { process.stdout.write(''); }" "$MANIFEST")"
  if [[ -n "$HOST_URI" ]] && [[ "$HOST_URI" != 127.0.0.1:* ]]; then
    LAN_HOST="$HOST_URI"
    break
  fi

  if [[ -n "${CURRENT_PID}" ]] && ! kill -0 "$CURRENT_PID" 2>/dev/null; then
    break
  fi

  sleep "$SLEEP_SEC"
done

if [[ -z "$LAN_HOST" ]]; then
  LOCAL_IP="$(get_local_ip)"
  if [[ -n "$LOCAL_IP" ]]; then
    LAN_HOST="${LOCAL_IP}:${PORT}"
  fi
fi

if [[ -z "$LAN_HOST" ]]; then
  echo "LAN URL was not ready on port $PORT."
  echo "Log tail:"
  tail -n 80 "$LOG_FILE" || true
  exit 1
fi

echo ""
echo "Project links:"
echo "- Expo Go: exp://$LAN_HOST"
echo "- Browser/manifest: http://127.0.0.1:${PORT}"
echo "- LAN host: http://$LAN_HOST"
echo ""
echo "Note: phone and Mac must be on the same Wi-Fi in LAN mode."
echo "Logs: $LOG_FILE"
echo "Stop: $ROOT_DIR/scripts/project-robot-stop.sh"
