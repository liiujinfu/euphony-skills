---
name: codebuddy-euphony
description: Preview local CodeBuddy conversation JSONL files in OpenAI Euphony. Use when the user asks to inspect, visualize, open, browse, debug, or share CodeBuddy CLI conversation/session history with Euphony, including finding the latest ~/.codebuddy/projects session, converting it to Euphony-compatible JSONL, starting the local Euphony dev server, staging a browser-loadable copy, or opening the preview URL.
---

# CodeBuddy Euphony

Use this skill to preview local CodeBuddy session logs in Euphony.

CodeBuddy stores project session logs under `${CODEBUDDY_HOME:-$HOME/.codebuddy}/projects/<project-key>/<session-id>.jsonl`.
Euphony can read Codex-session JSONL, so this skill converts CodeBuddy events to that compatible shape before staging the file.

The skill manages Euphony as a disposable runtime checkout under `${CODEBUDDY_HOME:-$HOME/.codebuddy}/cache/euphony` by default.
If that cache is deleted, it is recreated on the next command that needs Euphony.

## Workflow

1. Find the latest CodeBuddy session:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs latest
```

2. For normal user requests, stage and open the latest session:

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open
```

This converts the newest CodeBuddy session, writes it to `$EUPHONY_DIR/public/local-codebuddy/latest.jsonl`, ensures Euphony is running, and opens a browser URL that loads that staged file.

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

## Script Commands

```bash
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs list
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs latest
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs convert [session-jsonl] [output-jsonl]
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stage [session-jsonl]
${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open [session-jsonl]
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
```

If the default port responds but is not serving this checkout, use `EUPHONY_PORT=3001` or stop the other local Euphony server before running `open`.
