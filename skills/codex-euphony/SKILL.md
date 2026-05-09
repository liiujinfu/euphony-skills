---
name: codex-euphony
description: View local Codex session JSONL logs in OpenAI Euphony. Use when the user asks to inspect, visualize, open, browse, debug, or share their local Codex conversations/sessions/logs/history with Euphony, including finding the latest ~/.codex/sessions rollout file, starting the local Euphony dev server, staging a session for browser loading, or explaining how to load a Codex JSONL file into Euphony.
---

# Codex Euphony

## Overview

Use this skill to inspect local Codex session JSONL files with Euphony.
The skill manages Euphony as a disposable runtime checkout under `${CODEX_HOME:-$HOME/.codex}/cache/euphony` by default.
Local Codex rollouts live under `${CODEX_HOME:-$HOME/.codex}/sessions` by default.
The primary script is `scripts/codex-euphony.mjs` and works on macOS, Linux, and Windows with Node.js 18+.
`scripts/codex-euphony.sh` is only a Unix compatibility wrapper around the Node script.

If the Euphony cache is deleted, the script recreates it on the next command that needs Euphony.
If `node_modules` is deleted, the script reruns `corepack pnpm install`.

## Workflow

1. Find the latest Codex session without starting Euphony:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs latest
```

2. For normal user requests, open the latest session directly in the default browser:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs open
```

This is the default path for requests like "open Euphony", "show my latest Codex session", or "view this session in Euphony".
It ensures Euphony is installed and running, stages the latest session, prints the load URL, and opens it in the system browser.

3. If the user only wants a URL, or GUI opening is unavailable, print a browser URL instead:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs url
```

This ensures Euphony is installed and running, stages the latest session, and prints a URL like:

```text
http://127.0.0.1:3000/?path=http://127.0.0.1:3000/local-codex/latest.jsonl&no-cache=true
```

4. If Euphony is already running and you only need to refresh the staged JSONL, use the lightweight path:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs stage
```

This avoids restarting Euphony and normally avoids escalation.

5. Check whether Euphony is already running:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs status
```

6. Use staging without starting or opening Euphony only when Euphony is already running:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs stage
```

This stages the latest session at `$EUPHONY_DIR/public/local-codex/latest.jsonl`.
By default, staging uses a symlink to the live rollout file on macOS/Linux so browser refreshes can read newly appended turns.
On Windows, staging defaults to copying because symlink creation often requires extra privileges.
Set `EUPHONY_STAGE_MODE=copy` to force snapshot copying.
The skill starts Euphony with `VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES=100000` by default because Codex rollout JSONL files often exceed Euphony's older frontend-only 100-line default.
Staging is intended for a local Euphony server bound to `127.0.0.1`.
Codex session files can contain private prompts, file paths, tool outputs, and secrets.

The staged local-codex path is needed for URL loading because browser pages cannot fetch arbitrary local files.
To avoid the copy, use Euphony's `Load local file` button manually.

7. Start Euphony when it is not running:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs up
```

Use foreground startup only when explicitly useful for debugging:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs start
```

8. Verify with:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs status
```

Report the printed load URL to the user after `HTTP/1.1 200 OK`, or after the script reports that Euphony is listening.

9. Stop Euphony when the user is done:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs stop
```

The stop command kills the Euphony process tracked by this script's pid file.

## Sandbox And Escalation

Do not run heavy commands once in the sandbox just to discover that they need escalation.

- `open` is the default user-facing command. It may need escalation in Codex sandbox because it can clone from GitHub, install dependencies, bind a local TCP port, and open a GUI browser.
- `list`, `latest`, `status`, and `stage` are lightweight local commands and normally do not need escalation.
- `url`, `up`, `start`, `restart`, and first-time `ensure` may need escalation in Codex sandbox because they can clone from GitHub, install dependencies, or bind a local TCP port.
- If GUI opening is blocked or not desired, use `url` and report the printed link.

If startup fails with `listen EPERM`, rerun the same startup command with escalated permissions because this environment may block local TCP listeners inside the sandbox.

## Manual Loading

If staging is not desired, tell the user to open `http://127.0.0.1:3000/`, click `Load local file`, and choose the JSONL path from `latest`.
On macOS, `Cmd+Shift+G` in the file picker allows pasting the path directly.

Do not tell the user to paste a local absolute path into Euphony's top URL box. Browser pages cannot fetch arbitrary `file://` or `/Users/...` paths directly.

## Script Commands

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs list
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs latest
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs status
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs ensure
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs stage [session-jsonl]
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs url [session-jsonl]
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs open [session-jsonl]
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs up
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs start
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs stop
node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs restart
```

Use environment overrides only when needed:

```bash
EUPHONY_DIR=/path/to/euphony CODEX_SESSIONS_DIR=/path/to/sessions node ${CODEX_HOME:-$HOME/.codex}/skills/codex-euphony/scripts/codex-euphony.mjs latest
```
