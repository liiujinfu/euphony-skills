#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
EUPHONY_DIR="${EUPHONY_DIR:-$CODEX_HOME/cache/euphony}"
CODEX_SESSIONS_DIR="${CODEX_SESSIONS_DIR:-$CODEX_HOME/sessions}"
HOST="${EUPHONY_HOST:-127.0.0.1}"
PORT="${EUPHONY_PORT:-3000}"
URL="http://${HOST}:${PORT}/"
RUN_DIR="${EUPHONY_RUN_DIR:-$EUPHONY_DIR/.codex-euphony}"
PID_FILE="$RUN_DIR/vite.pid"
LOG_FILE="$RUN_DIR/vite.log"
EUPHONY_REPO="${EUPHONY_REPO:-https://github.com/openai/euphony.git}"
TMUX_SESSION="${EUPHONY_TMUX_SESSION:-codex-euphony-${PORT}}"
STAGE_MODE="${EUPHONY_STAGE_MODE:-symlink}"
MAX_LINES="${EUPHONY_FRONTEND_ONLY_MAX_LINES:-100000}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [session-jsonl]

Commands:
  list             List recent Codex session JSONL files.
  latest           Print the newest Codex session JSONL path.
  status           Check whether Euphony appears to be listening.
  ensure           Ensure the Euphony runtime checkout and dependencies exist.
  stage [file]     Copy a session JSONL into Euphony public/local-codex/latest.jsonl and print a load URL.
  url [file]       Ensure Euphony is running, stage a session, and print the load URL.
  open [file]      Ensure Euphony is running, stage a session, and open the load URL in the browser.
  up               Start Euphony in the background if it is not already running.
  start            Start Euphony Vite dev server in the foreground.
  stop             Stop the Euphony Vite server for this checkout.
  restart          Stop then start Euphony in the background.

Environment:
  CODEX_HOME           Default: \$HOME/.codex
  EUPHONY_DIR          Default: \$CODEX_HOME/cache/euphony
  CODEX_SESSIONS_DIR  Default: \$CODEX_HOME/sessions
  EUPHONY_HOST         Default: 127.0.0.1
  EUPHONY_PORT         Default: 3000
  EUPHONY_RUN_DIR      Default: \$EUPHONY_DIR/.codex-euphony
  EUPHONY_REPO         Default: https://github.com/openai/euphony.git
  EUPHONY_TMUX_SESSION Default: codex-euphony-\$EUPHONY_PORT
  EUPHONY_STAGE_MODE   Default: symlink (use copy to force snapshot staging)
  EUPHONY_FRONTEND_ONLY_MAX_LINES
                       Default: 100000
EOF
}

require_sessions_dir() {
  if [[ ! -d "$CODEX_SESSIONS_DIR" ]]; then
    echo "Codex sessions directory not found: $CODEX_SESSIONS_DIR" >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required for this command." >&2
    exit 1
  fi
}

patch_euphony_frontend_limit() {
  local api_manager="$EUPHONY_DIR/src/utils/api-manager.ts"
  if [[ ! -f "$api_manager" ]]; then
    return
  fi
  if grep -q "VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES" "$api_manager"; then
    return
  fi
  if ! grep -q "const FRONTEND_ONLY_MODE_MAX_LINES = 100;" "$api_manager"; then
    return
  fi

  perl -0pi -e 's#// The maximum number of lines in a JSONL file to read in frontend-only mode\nconst FRONTEND_ONLY_MODE_MAX_LINES = 100;#// The maximum number of lines in a JSONL file to read in frontend-only mode.\n// Codex rollout files are event streams and routinely exceed 100 lines, so keep\n// the default high while allowing local deployments to lower it.\nconst FRONTEND_ONLY_MODE_MAX_LINES = Number.parseInt(\n  (import.meta.env.VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES as string) || '\''100000'\'',\n  10\n);#' "$api_manager"
}

ensure_euphony_dir() {
  if [[ -f "$EUPHONY_DIR/package.json" ]]; then
    patch_euphony_frontend_limit
    if [[ ! -d "$EUPHONY_DIR/node_modules" ]]; then
      require_command corepack
      echo "Installing Euphony dependencies in $EUPHONY_DIR..."
      (cd "$EUPHONY_DIR" && corepack pnpm install)
    fi
    return
  fi

  if [[ -e "$EUPHONY_DIR" ]]; then
    echo "EUPHONY_DIR exists but is not an Euphony checkout: $EUPHONY_DIR" >&2
    echo "Remove it or set EUPHONY_DIR to another path." >&2
    exit 1
  fi

  require_command git
  require_command corepack
  mkdir -p "$(dirname "$EUPHONY_DIR")"
  echo "Cloning Euphony into $EUPHONY_DIR..."
  git clone "$EUPHONY_REPO" "$EUPHONY_DIR"
  patch_euphony_frontend_limit
  echo "Installing Euphony dependencies in $EUPHONY_DIR..."
  (cd "$EUPHONY_DIR" && corepack pnpm install)
}

latest_session() {
  require_sessions_dir
  find "$CODEX_SESSIONS_DIR" -type f -name '*.jsonl' -print0 \
    | xargs -0 ls -t 2>/dev/null \
    | head -1
}

stage_session() {
  ensure_euphony_dir
  local session_path="${1:-$(latest_session)}"
  if [[ -z "${session_path:-}" || ! -f "$session_path" ]]; then
    echo "Session file not found: ${session_path:-<empty>}" >&2
    exit 1
  fi
  mkdir -p "$EUPHONY_DIR/public/local-codex"
  if [[ "$STAGE_MODE" == "copy" ]]; then
    cp "$session_path" "$EUPHONY_DIR/public/local-codex/latest.jsonl"
  elif ln -sfn "$session_path" "$EUPHONY_DIR/public/local-codex/latest.jsonl" 2>/dev/null; then
    :
  else
    cp "$session_path" "$EUPHONY_DIR/public/local-codex/latest.jsonl"
  fi
  printf '%s\n' "$session_path" > "$EUPHONY_DIR/public/local-codex/latest-source.txt"
  echo "Staged: $session_path"
  echo "Open: ${URL}?path=${URL}local-codex/latest.jsonl&no-cache=true"
}

listening_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  fi
}

pid_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}

euphony_pids() {
  local pid cwd
  listening_pids | while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    cwd="$(pid_cwd "$pid" || true)"
    if [[ "$cwd" == "$EUPHONY_DIR" ]]; then
      echo "$pid"
    fi
  done
}

is_running() {
  [[ -n "$(euphony_pids)" ]]
}

http_ready() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSI --max-time 2 "$URL" >/dev/null 2>&1
    return
  fi
  is_running
}

shell_quote() {
  printf "%q" "$1"
}

start_vite_background() {
  mkdir -p "$RUN_DIR"
  local runner="$RUN_DIR/start-vite.sh"
  cat > "$runner" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd $(shell_quote "$EUPHONY_DIR")
exec env VITE_EUPHONY_FRONTEND_ONLY=true VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES=$(shell_quote "$MAX_LINES") corepack pnpm exec vite --host $(shell_quote "$HOST") --port $(shell_quote "$PORT")
EOF
  chmod +x "$runner"

  if command -v tmux >/dev/null 2>&1; then
    tmux has-session -t "$TMUX_SESSION" 2>/dev/null && tmux kill-session -t "$TMUX_SESSION"
    tmux new-session -d -s "$TMUX_SESSION" "$runner > $(shell_quote "$LOG_FILE") 2>&1"
    echo "tmux:$TMUX_SESSION" > "$PID_FILE"
    return
  fi

  nohup "$runner" > "$LOG_FILE" 2>&1 </dev/null &
  echo $! > "$PID_FILE"
}

ensure_running() {
  ensure_euphony_dir
  if http_ready; then
    return
  fi

  if ! is_running; then
    start_vite_background
  fi

  for _ in $(seq 1 300); do
    if http_ready; then
      return
    fi
    sleep 0.2
  done

  echo "Euphony did not start on $URL" >&2
  echo "Log: $LOG_FILE" >&2
  exit 1
}

case "${1:-help}" in
  list)
    require_sessions_dir
    find "$CODEX_SESSIONS_DIR" -type f -name '*.jsonl' -print0 \
      | xargs -0 ls -t 2>/dev/null \
      | head -20
    ;;
  latest)
    latest_session
    ;;
  status)
    if is_running; then
      echo "Euphony is listening at $URL"
      euphony_pids | sed 's/^/PID: /'
    else
      echo "Euphony is not listening on $URL"
      exit 1
    fi
    ;;
  ensure)
    ensure_euphony_dir
    echo "Euphony is ready at $EUPHONY_DIR"
    ;;
  stage)
    shift
    stage_session "${1:-}"
    ;;
  url)
    shift
    ensure_running
    stage_session "${1:-}"
    ;;
  open)
    shift
    ensure_running
    load_url="$(stage_session "${1:-}" | tee /dev/stderr | sed -n 's/^Open: //p' | tail -1)"
    if command -v open >/dev/null 2>&1; then
      open "$load_url"
    else
      echo "Open this URL in a browser: $load_url"
    fi
    ;;
  up)
    ensure_running
    echo "Euphony is listening at $URL"
    echo "Log: $LOG_FILE"
    ;;
  start)
    ensure_euphony_dir
    cd "$EUPHONY_DIR"
    exec env VITE_EUPHONY_FRONTEND_ONLY=true VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES="$MAX_LINES" corepack pnpm exec vite --host "$HOST" --port "$PORT"
    ;;
  stop)
    pids="$(euphony_pids)"
    stopped=0
    if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
      tmux kill-session -t "$TMUX_SESSION"
      echo "Stopped Euphony tmux session $TMUX_SESSION"
      stopped=1
    fi
    if [[ -n "$pids" ]]; then
      echo "$pids" | while IFS= read -r pid; do
        [[ -n "$pid" ]] || continue
        kill "$pid" 2>/dev/null || true
        echo "Stopped Euphony PID $pid"
      done
      stopped=1
    fi
    if [[ "$stopped" -eq 0 ]]; then
      echo "No Euphony process for $EUPHONY_DIR is listening on port $PORT."
      exit 0
    fi
    rm -f "$PID_FILE"
    ;;
  restart)
    "$0" stop
    "$0" up
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
