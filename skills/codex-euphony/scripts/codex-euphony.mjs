#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEuphonyRuntime } from '../../_shared/euphony-runtime.mjs';

const isWindows = process.platform === 'win32';
const home = os.homedir();
const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
const sessionsDir = process.env.CODEX_SESSIONS_DIR || path.join(codexHome, 'sessions');
const euphonyDir = process.env.EUPHONY_DIR || path.join(codexHome, 'cache', 'euphony');
const euphonyRepo = process.env.EUPHONY_REPO || 'https://github.com/openai/euphony.git';
const host = process.env.EUPHONY_HOST || '127.0.0.1';
const port = Number(process.env.EUPHONY_PORT || '3000');
const runDir = process.env.EUPHONY_RUN_DIR || path.join(euphonyDir, '.codex-euphony');
const maxLines = process.env.EUPHONY_FRONTEND_ONLY_MAX_LINES || '100000';
const stageMode = process.env.EUPHONY_STAGE_MODE || (isWindows ? 'copy' : 'symlink');
const eventLimit = Number.parseInt(process.env.CODEX_EUPHONY_EVENT_LIMIT || '500', 10);
const currentSessionId = process.env.CODEX_EUPHONY_SESSION_ID || process.env.CODEX_SESSION_ID || process.env.CODEX_THREAD_ID || '';
const stagedDir = path.join(euphonyDir, 'public', 'local-codex');
const stagedJsonl = path.join(stagedDir, 'latest.jsonl');
const stagedSource = path.join(stagedDir, 'latest-source.txt');

const runtime = createEuphonyRuntime({
  euphonyDir,
  euphonyRepo,
  host,
  port,
  runDir,
  maxLines,
  frontendLimitComment: [
    'Codex rollout files are event streams and routinely exceed 100 lines, so keep',
    'the default high while allowing local deployments to lower it.'
  ]
});

function usage() {
  console.log(`Usage: ${path.basename(process.argv[1])} <command> [session-jsonl]

Commands:
  list             List recent Codex session JSONL files.
  latest           Print the newest Codex session JSONL path.
  current          Print the current Codex session JSONL path when CODEX_THREAD_ID is available.
  status           Check whether Euphony responds.
  ensure           Ensure the Euphony runtime checkout and dependencies exist.
  stage [file|id]  Stage a session JSONL into Euphony public/local-codex/latest.jsonl and print a load URL.
  url [file|id]    Ensure Euphony is running, stage a session, and print the load URL.
  open [file|id]   Ensure Euphony is running, stage a session, and open the load URL in the browser.
  up               Start Euphony in the background if it is not already running.
  start            Start Euphony Vite dev server in the foreground.
  stop             Stop the Euphony Vite server started by this script.
  restart          Stop then start Euphony in the background.

Environment:
  CODEX_HOME           Default: ~/.codex
  CODEX_SESSIONS_DIR   Default: $CODEX_HOME/sessions
  EUPHONY_DIR          Default: $CODEX_HOME/cache/euphony
  EUPHONY_HOST         Default: 127.0.0.1
  EUPHONY_PORT         Default: 3000
  EUPHONY_RUN_DIR      Default: $EUPHONY_DIR/.codex-euphony
  EUPHONY_REPO         Default: https://github.com/openai/euphony.git
  EUPHONY_STAGE_MODE   Default: ${isWindows ? 'copy on Windows, symlink elsewhere' : 'symlink'}
  EUPHONY_FRONTEND_ONLY_MAX_LINES
                       Default: 100000
  CODEX_EUPHONY_SESSION_ID
                       Optional session id override. Defaults to CODEX_SESSION_ID or CODEX_THREAD_ID.
  CODEX_EUPHONY_EVENT_LIMIT
                       Default: 500. Use 0 to stage the full JSONL.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireSessionsDir() {
  if (!fs.existsSync(sessionsDir) || !fs.statSync(sessionsDir).isDirectory()) {
    fail(`Codex sessions directory not found: ${sessionsDir}`);
  }
}

function walkJsonlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonlFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(fullPath);
    }
  }
  return out;
}

function recentSessions() {
  requireSessionsDir();
  return walkJsonlFiles(sessionsDir)
    .map(file => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function latestSession() {
  const [latest] = recentSessions();
  if (!latest) fail(`No Codex session JSONL files found under: ${sessionsDir}`);
  return latest.file;
}

function sessionMetaId(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/, 1)[0];
      if (!firstLine.trim()) return '';
      const event = JSON.parse(firstLine);
      return typeof event?.payload?.id === 'string' ? event.payload.id : '';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function findSessionById(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const matches = recentSessions().filter(({ file }) => {
    const basename = path.basename(file, '.jsonl');
    return basename.includes(id) || sessionMetaId(file) === id;
  });
  return matches[0]?.file || null;
}

function currentSession() {
  if (!currentSessionId) return null;
  return findSessionById(currentSessionId);
}

function defaultSession() {
  return currentSession() || latestSession();
}

function resolveSessionInput(input) {
  if (!input) return defaultSession();
  if (input === 'current') {
    const current = currentSession();
    if (!current) fail(`Current Codex session was not found for id: ${currentSessionId || '[missing CODEX_THREAD_ID]'}`);
    return current;
  }
  if (input === 'latest') return latestSession();
  const resolved = path.resolve(input);
  if (fs.existsSync(resolved)) return resolved;
  const matched = findSessionById(input);
  if (matched) return matched;
  fail(`Session file or id not found: ${input}`);
}

function readStagedLines(source) {
  const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!Number.isFinite(eventLimit) || eventLimit <= 0 || lines.length <= eventLimit) {
    return lines;
  }

  const metadataLines = [];
  const metadataIndexes = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    try {
      const event = JSON.parse(lines[index]);
      if (event?.type === 'session_meta' || event?.type === 'turn_context') {
        metadataLines.push(lines[index]);
        metadataIndexes.add(index);
      }
    } catch {
      // Leave malformed rows eligible for tailing; Euphony skips bad JSONL rows.
    }
  }

  const tailLines = [];
  for (let index = Math.max(0, lines.length - eventLimit); index < lines.length; index += 1) {
    if (!metadataIndexes.has(index)) tailLines.push(lines[index]);
  }
  return [...metadataLines, ...tailLines];
}

function writeStagedCopy(source) {
  fs.writeFileSync(stagedJsonl, `${readStagedLines(source).join('\n')}\n`);
}

function stageSession(input) {
  runtime.ensureEuphonyDir();
  const source = resolveSessionInput(input);
  if (!fs.existsSync(source)) fail(`Session file not found: ${source}`);
  fs.mkdirSync(stagedDir, { recursive: true });
  if (eventLimit > 0) {
    writeStagedCopy(source);
  } else if (stageMode === 'symlink') {
    try {
      fs.rmSync(stagedJsonl, { force: true });
      fs.symlinkSync(source, stagedJsonl, 'file');
    } catch {
      writeStagedCopy(source);
    }
  } else {
    writeStagedCopy(source);
  }
  fs.writeFileSync(stagedSource, `${source}\n`);
  const url = `${runtime.baseUrl}?path=${runtime.baseUrl}local-codex/latest.jsonl&no-cache=true`;
  console.log(`Staged: ${source}`);
  if (eventLimit > 0) console.log(`Event limit: latest ${eventLimit} events plus session metadata`);
  console.log(`Open: ${url}`);
  return url;
}

async function openCommand(input) {
  await runtime.up();
  const url = stageSession(input);
  runtime.openBrowser(url);
  console.log(`Opened: ${url}`);
}

async function main() {
  const command = process.argv[2] || 'help';
  const arg1 = process.argv[3];
  switch (command) {
    case 'list':
      for (const item of recentSessions().slice(0, 20)) {
        console.log(`${new Date(item.mtimeMs).toISOString()}  ${item.file}`);
      }
      break;
    case 'latest':
      console.log(latestSession());
      break;
    case 'current': {
      const current = currentSession();
      if (!current) fail(`Current Codex session was not found for id: ${currentSessionId || '[missing CODEX_THREAD_ID]'}`);
      console.log(current);
      break;
    }
    case 'status':
      await runtime.status();
      break;
    case 'ensure':
      runtime.ensureEuphonyDir();
      console.log(`Euphony is ready at ${euphonyDir}`);
      break;
    case 'stage':
      stageSession(arg1);
      break;
    case 'url':
      await runtime.up();
      stageSession(arg1);
      break;
    case 'open':
      await openCommand(arg1);
      break;
    case 'up':
      await runtime.up();
      break;
    case 'start':
      await runtime.startForeground();
      break;
    case 'stop':
      runtime.stop();
      break;
    case 'restart':
      runtime.stop();
      await runtime.up();
      break;
    case 'help':
    case '--help':
    case '-h':
      usage();
      break;
    default:
      usage();
      process.exitCode = 1;
  }
}

main().catch(error => fail(error.stack || error.message));
