---
name: codebuddy-euphony
description: Preview local CodeBuddy conversation files in OpenAI Euphony. Use when the user asks to inspect, visualize, open, browse, debug, or share CodeBuddy CLI or CodeBuddy CN desktop conversation/session history with Euphony, including finding the latest ~/.codebuddy/projects JSONL session or CodeBuddyExtension/Data desktop history session, converting it to Euphony-compatible JSONL, starting the local Euphony dev server, staging a browser-loadable copy, or opening the preview URL.
---

# CodeBuddy Euphony

Use this skill to preview local CodeBuddy session logs in Euphony.

CodeBuddy CLI stores project session logs under `${CODEBUDDY_HOME:-$HOME/.codebuddy}/projects/<project-key>/<session-id>.jsonl`.
CodeBuddy CN desktop stores chat history under the OS application data directory, usually `~/Library/Application Support/CodeBuddyExtension/Data/.../history/<workspace-id>/<conversation-id>/` on macOS.
Euphony can read Codex-session JSONL, so this skill converts either CodeBuddy source format to that compatible shape before staging the file.

The skill manages Euphony as a disposable runtime checkout under `${CODEBUDDY_HOME:-$HOME/.codebuddy}/cache/euphony` by default.
If that cache is deleted, it is recreated on the next command that needs Euphony.
The script is a Node.js 18+ executable and works on macOS, Linux, and Windows.
The script prefers a directly installed `pnpm`; if only Corepack is available, it runs `corepack pnpm` with `COREPACK_INTEGRITY_KEYS=0` for that subprocess to avoid known Corepack pnpm signature bootstrap failures during first startup.

## Workflow

1. Find the latest CodeBuddy session:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs latest
```

Find the current CodeBuddy session:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs current
```

The script first tries CodeBuddy session/conversation/thread environment variables, then matches the current workspace path against CLI `cwd` or desktop `Workspace Folder` metadata. If neither can be resolved, commands without an explicit session path fall back to `latest`.

For CodeBuddy CN desktop specifically, use:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs latest-desktop
```

2. For normal user requests, stage and open the current session:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open
```

This converts the current CodeBuddy session when it can be identified, writes it to `$EUPHONY_DIR/public/local-codebuddy/latest.jsonl`, ensures Euphony is running, and opens a browser URL that loads that staged file.
When the user explicitly wants the newest desktop app history, use `open-desktop` instead of `open`.
When `EUPHONY_PORT` is not set and the default port is already used by another checkout, the script automatically chooses the next available local port from `3001` through `3003`. The page URL and staged JSONL URL always use the same selected port.

3. Use staging without opening the browser when only the URL is needed:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stage
```

The staged file is needed because the browser cannot fetch arbitrary files from `~/.codebuddy`.
Session files can contain private prompts, paths, tool outputs, and secrets; only serve them through a local Euphony server bound to `127.0.0.1`.

4. Start or stop Euphony explicitly when needed:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs up
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stop
```

5. Verify with:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs status
```

Report the printed Euphony URL after the server responds.
The stop command kills the Euphony process tracked by this script's pid file.

## Script Commands

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs list
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs latest
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs current
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs latest-desktop
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs convert [session-path|session-id|current|latest] [output-jsonl]
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stage [session-path|session-id|current|latest]
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stage-desktop
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open [session-path|session-id|current|latest]
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open-desktop
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs up
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs start
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs status
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stop
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs restart
```

Use environment overrides only when needed:

```bash
EUPHONY_DIR=/path/to/euphony CODEBUDDY_HOME=/path/to/.codebuddy EUPHONY_PORT=3001 ${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stage
CODEBUDDY_INCLUDE_SUBAGENTS=1 ${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs list
CODEBUDDY_DESKTOP_DATA_DIR=/path/to/CodeBuddyExtension/Data ${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs list
CODEBUDDY_EUPHONY_SESSION_ID=<session-id> ${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs current
CODEBUDDY_WORKSPACE_DIR=/path/to/workspace ${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs current
```

If you need a fixed port, set `EUPHONY_PORT`. Otherwise the script will avoid another local Euphony checkout automatically.
