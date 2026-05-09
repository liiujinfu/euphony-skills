# Euphony Skills

[English](README.md) | [简体中文](README_CN.md)

Install local Euphony viewer skills for Codex and CodeBuddy.

This repository contains two independent skills with one npm-based installer:

- `skills/codex-euphony`: opens local Codex session JSONL logs in OpenAI Euphony.
- `skills/codebuddy-euphony`: converts local CodeBuddy session JSONL logs into an Euphony-compatible shape and opens them in OpenAI Euphony.

Each skill directory is self-contained, so it can still be installed by path. The npm CLI is the recommended install path because it handles both host applications consistently.

## Requirements

- Node.js 18 or newer.
- `git`, used when a skill needs to clone the Euphony runtime checkout.
- `corepack`, used to run `pnpm install` for Euphony.
- macOS, Linux, or another environment with a local browser opener.

The installer itself does not install Euphony dependencies. The selected skill does that lazily the first time it starts Euphony.

## Quick Install

Install from npm after the package is published:

```bash
npx euphony-skills install codex
npx euphony-skills install codebuddy
npx euphony-skills install all
```

Replace an existing install:

```bash
npx euphony-skills install all --force
```

Remove installed skills:

```bash
npx euphony-skills uninstall all
```

Check local state:

```bash
npx euphony-skills doctor
```

Restart Codex or CodeBuddy after installing so the host application reloads skills.

## Local Checkout Install

From a cloned repository:

```bash
git clone https://github.com/yourname/euphony-skills.git
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
CODEX_HOME=/custom/.codex npx euphony-skills install codex
CODEBUDDY_HOME=/custom/.codebuddy npx euphony-skills install codebuddy
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
~/.codex/skills/codex-euphony/scripts/codex-euphony.sh open
~/.codex/skills/codex-euphony/scripts/codex-euphony.sh status
~/.codex/skills/codex-euphony/scripts/codex-euphony.sh stop
```

CodeBuddy:

```bash
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs status
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stop
```

## Runtime Behavior

The installer only copies or links skill folders. It does not copy session logs, generated JSONL files, local caches, or Euphony checkouts.

At runtime:

- Codex uses `${CODEX_HOME:-~/.codex}/cache/euphony`.
- CodeBuddy uses `${CODEBUDDY_HOME:-~/.codebuddy}/cache/euphony`.
- If the cache is deleted, the skill recreates it on the next command that needs Euphony.
- The local Euphony server binds to `127.0.0.1`.
- The default port is `3000`.

If port `3000` is already occupied, use another port:

```bash
EUPHONY_PORT=3001 ~/.codex/skills/codex-euphony/scripts/codex-euphony.sh open
EUPHONY_PORT=3001 ~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open
```

## Privacy

Session JSONL files can contain prompts, paths, tool output, and secrets that appeared in conversations. The skills serve staged session data only from a local `127.0.0.1` Euphony instance.

Do not commit generated session files, staged JSONL output, `.env` files, or Euphony cache directories. This repository's package contents are limited to the CLI, README files, LICENSE, and skill source files.

## Troubleshooting

If a host app does not see the skill, restart Codex or CodeBuddy after installation.

If installation says the skill already exists, rerun with `--force`:

```bash
npx euphony-skills install codebuddy --force
```

If Euphony fails to start, check prerequisites:

```bash
npx euphony-skills doctor
```

If `npm` reports cache permission errors, use a temporary cache or repair the npm cache ownership:

```bash
npm_config_cache=/tmp/euphony-skills-npm-cache npx euphony-skills doctor
```

If multiple Euphony servers are running, stop the relevant one or choose a different port:

```bash
~/.codex/skills/codex-euphony/scripts/codex-euphony.sh stop
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
