# Euphony Skills

[English](README.md) | [简体中文](README_CN.md)

Install local Euphony viewer skills for Codex and CodeBuddy.

This repository contains two independent skills with one npm-based installer:

- `skills/codex-euphony`: opens local Codex session JSONL logs in OpenAI Euphony.
- `skills/codebuddy-euphony`: converts local CodeBuddy CLI JSONL logs and CodeBuddy CN desktop history into an Euphony-compatible shape and opens them in OpenAI Euphony.

The npm CLI is the recommended install path because it installs the selected skill plus the shared local Euphony runtime helper used by both host applications.

## Requirements

- Node.js 18 or newer.
- `git`, used when a skill needs to clone the Euphony runtime checkout.
- `pnpm` or `corepack`, used to install and run Euphony.
- macOS, Linux, or Windows with a local browser opener.

The installer itself does not install Euphony dependencies. The selected skill does that lazily the first time it starts Euphony.
At runtime the skill prefers an installed `pnpm`; when only Corepack is available, it uses `corepack pnpm` and sets `COREPACK_INTEGRITY_KEYS=0` for that subprocess to avoid known Corepack pnpm signature bootstrap failures.

## Quick Install

Install from npm after the package is published:

```bash
npx @jefferylau/euphony-skills install codex
npx @jefferylau/euphony-skills install codebuddy
npx @jefferylau/euphony-skills install all
```

Replace an existing install:

```bash
npx @jefferylau/euphony-skills install all --force
```

Remove installed skills:

```bash
npx @jefferylau/euphony-skills uninstall all
```

Check local state:

```bash
npx @jefferylau/euphony-skills doctor
```

Restart Codex or CodeBuddy after installing so the host application reloads skills.

## Local Checkout Install

From a cloned repository:

```bash
git clone https://github.com/liiujinfu/euphony-skills.git
cd euphony-skills
node bin/euphony-skills.mjs install all --force
```

For local development, install with symlinks so edits in this repository are picked up immediately:

```bash
node bin/euphony-skills.mjs install all --force --link
```

For normal end users, prefer copy install without `--link`.

## Install Targets

Codex installs to:

```text
${CODEX_HOME:-~/.codex}/skills/codex-euphony
```

CodeBuddy installs to:

```text
${CODEBUDDY_HOME:-~/.codebuddy}/skills/codebuddy-euphony
```

Override host homes when needed:

```bash
CODEX_HOME=/custom/.codex npx @jefferylau/euphony-skills install codex
CODEBUDDY_HOME=/custom/.codebuddy npx @jefferylau/euphony-skills install codebuddy
```

## CLI Reference

```bash
euphony-skills install codex [--force] [--link]
euphony-skills install codebuddy [--force] [--link]
euphony-skills install all [--force] [--link]
euphony-skills uninstall codex
euphony-skills uninstall codebuddy
euphony-skills uninstall all
euphony-skills doctor
```

Options:

- `--force`: replace an existing install.
- `--link`: create a symlink from the host skill directory to this checkout. Use this for development only.

## Using The Skills

After installing and restarting the host app, ask the assistant to open the latest session with Euphony.

Codex examples:

```text
Use codex-euphony to open the latest Codex session.
Open this Codex conversation in Euphony.
```

CodeBuddy examples:

```text
Use codebuddy-euphony to open the latest CodeBuddy session.
Open this CodeBuddy conversation in Euphony.
```

You can also run the scripts directly.

Codex:

```bash
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs current
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs open
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs status
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs stop
```

`open`, `url`, and `stage` prefer the current Codex session when `CODEX_THREAD_ID` is available. They fall back to the newest session file if the current id cannot be resolved. You can also pass a session file path, full session id, `current`, or `latest`.

CodeBuddy:

```bash
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs list
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs current
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open-desktop
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs status
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stop
```

`open` prefers the current CodeBuddy session when a session/conversation/thread id or workspace path can be matched, then falls back to the newest CodeBuddy session across CLI and desktop sources. `open-desktop` forces the newest CodeBuddy CN desktop conversation.

## Runtime Behavior

The installer only copies or links skill source folders and their shared runtime helper. It does not copy session logs, generated JSONL files, local caches, or Euphony checkouts.

At runtime:

- Codex uses `${CODEX_HOME:-~/.codex}/cache/euphony`.
- CodeBuddy uses `${CODEBUDDY_HOME:-~/.codebuddy}/cache/euphony`.
- CodeBuddy CLI sessions are read from `${CODEBUDDY_HOME:-~/.codebuddy}/projects`.
- CodeBuddy CN desktop sessions are read from `CodeBuddyExtension/Data` under the OS application data directory. Set `CODEBUDDY_DESKTOP_DATA_DIR` if the desktop app stores data elsewhere.
- If the cache is deleted, the skill recreates it on the next command that needs Euphony.
- The local Euphony server binds to `127.0.0.1`.
- The default port is `3000`.
- When `EUPHONY_PORT` is not set, the CodeBuddy skill automatically tries `3001` through `3003` if the default port is already used by another checkout, and keeps the page URL and staged JSONL URL on the same selected port.
- Codex staging uses a symlink on macOS/Linux and a copy on Windows by default. Set `EUPHONY_STAGE_MODE=copy` to force snapshot staging everywhere.
- Background servers are tracked with a pid file under the Euphony cache, so `stop` only controls servers started by the same skill script.

If port `3000` is already occupied, use another port:

```bash
EUPHONY_PORT=3001 node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs open
EUPHONY_PORT=3001 ~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open
```

Windows PowerShell example:

```powershell
$env:EUPHONY_PORT = "3001"
node "$env:USERPROFILE\.codex\skills\codex-euphony\scripts\codex-euphony.mjs" open
```

## Privacy

Session files can contain prompts, paths, tool output, and secrets that appeared in conversations. The skills serve staged session data only from a local `127.0.0.1` Euphony instance.

Do not commit generated session files, staged JSONL output, `.env` files, or Euphony cache directories. This repository's package contents are limited to the CLI, README files, LICENSE, skill source files, and shared runtime helper.

## Troubleshooting

If a host app does not see the skill, restart Codex or CodeBuddy after installation.

If installation says the skill already exists, rerun with `--force`:

```bash
npx @jefferylau/euphony-skills install codebuddy --force
```

If Euphony fails to start, check prerequisites:

```bash
npx @jefferylau/euphony-skills doctor
```

If CodeBuddy desktop sessions do not appear in `list`, point the script at the desktop data directory:

```bash
CODEBUDDY_DESKTOP_DATA_DIR="/path/to/CodeBuddyExtension/Data" ~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs list
```

If CodeBuddy does not expose a session id to the skill process, pin current-session detection to the workspace:

```bash
CODEBUDDY_WORKSPACE_DIR="/path/to/workspace" ~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs current
```

If `npm` reports cache permission errors, use a temporary cache or repair the npm cache ownership:

```bash
npm_config_cache=/tmp/euphony-skills-npm-cache npx @jefferylau/euphony-skills doctor
```

If multiple Euphony servers are running, stop the relevant one or choose a different port:

```bash
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs stop
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stop
```

## Development

Run checks:

```bash
npm run check
```

Test install behavior without touching real homes:

```bash
CODEX_HOME=/tmp/euphony-test-codex \
CODEBUDDY_HOME=/tmp/euphony-test-codebuddy \
node bin/euphony-skills.mjs install all --force
```

Test symlink install behavior:

```bash
CODEX_HOME=/tmp/euphony-test-codex \
CODEBUDDY_HOME=/tmp/euphony-test-codebuddy \
node bin/euphony-skills.mjs install all --force --link
```
