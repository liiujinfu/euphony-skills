#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEuphonyRuntime } from '../../_shared/euphony-runtime.mjs';
import {
  convertCodeBuddySessionToCodex,
  stableJsonlOutputPath
} from './codebuddy-converter.mjs';
import { createCodeBuddySessionStore } from './codebuddy-sessions.mjs';

const home = os.homedir();
const codebuddyHome = process.env.CODEBUDDY_HOME || path.join(home, '.codebuddy');
const projectsDir = process.env.CODEBUDDY_PROJECTS_DIR || path.join(codebuddyHome, 'projects');
const desktopDataDir =
  process.env.CODEBUDDY_DESKTOP_DATA_DIR ||
  (process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'CodeBuddyExtension', 'Data')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'CodeBuddyExtension', 'Data')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'CodeBuddyExtension', 'Data'));
const includeSubagents = process.env.CODEBUDDY_INCLUDE_SUBAGENTS === '1';
const euphonyDir = process.env.EUPHONY_DIR || path.join(codebuddyHome, 'cache', 'euphony');
const euphonyRepo = process.env.EUPHONY_REPO || 'https://github.com/openai/euphony.git';
const host = process.env.EUPHONY_HOST || '127.0.0.1';
const port = Number(process.env.EUPHONY_PORT || '3000');
const maxLines = process.env.EUPHONY_FRONTEND_ONLY_MAX_LINES || '100000';
const runDir = process.env.EUPHONY_RUN_DIR || path.join(euphonyDir, '.codebuddy-euphony');
const currentSessionId =
  process.env.CODEBUDDY_EUPHONY_SESSION_ID ||
  process.env.CODEBUDDY_SESSION_ID ||
  process.env.CODEBUDDY_CONVERSATION_ID ||
  process.env.CODEBUDDY_THREAD_ID ||
  '';
const currentWorkspace =
  process.env.CODEBUDDY_WORKSPACE_DIR ||
  process.env.CODEBUDDY_CWD ||
  process.env.WORKSPACE_FOLDER ||
  process.env.PROJECT_DIR ||
  process.env.INIT_CWD ||
  process.cwd();
const stagedDir = path.join(euphonyDir, 'public', 'local-codebuddy');
const stagedJsonl = path.join(stagedDir, 'latest.jsonl');
const stagedSource = path.join(stagedDir, 'latest-source.txt');

const runtime = createEuphonyRuntime({
  euphonyDir,
  euphonyRepo,
  host,
  port,
  portCandidates: process.env.EUPHONY_PORT ? [] : [3001, 3002, 3003],
  runDir,
  maxLines,
  frontendLimitComment: [
    'CodeBuddy converted sessions can exceed 100 lines, so keep the default',
    'high while allowing local deployments to lower it.'
  ]
});
const sessions = createCodeBuddySessionStore({
  projectsDir,
  desktopDataDir,
  includeSubagents,
  fail
});

function usage() {
  console.log(`Usage: ${path.basename(process.argv[1])} <command> [session-path] [output-jsonl]

Commands:
  list             List recent CodeBuddy CLI JSONL and desktop sessions.
  latest           Print the newest CodeBuddy session path.
  current          Print the current CodeBuddy session path when it can be identified.
  latest-desktop   Print the newest CodeBuddy desktop session path.
  convert [in] [out]
                   Convert a CodeBuddy session to Euphony-compatible JSONL.
  stage [file|id]  Convert into Euphony public/local-codebuddy/latest.jsonl and print a load URL.
  stage-desktop    Stage the newest CodeBuddy desktop session.
  open [file|id]   Stage a session, ensure Euphony is running, and open it in the browser.
  open-desktop     Open the newest CodeBuddy desktop session.
  up               Start Euphony in the background if it is not already running.
  start            Start Euphony Vite dev server in the foreground.
  status           Check whether Euphony responds.
  stop             Stop the Euphony Vite server for this checkout.
  restart          Stop then start Euphony in the background.

Environment:
  CODEBUDDY_HOME          Default: ~/.codebuddy
  CODEBUDDY_PROJECTS_DIR  Default: $CODEBUDDY_HOME/projects
  CODEBUDDY_DESKTOP_DATA_DIR
                          Default: CodeBuddyExtension/Data under the OS app data directory
  CODEBUDDY_INCLUDE_SUBAGENTS=1 to include subagent JSONL files
  CODEBUDDY_EUPHONY_SESSION_ID
                          Optional session id override. Defaults to CodeBuddy session/conversation/thread env vars.
  CODEBUDDY_WORKSPACE_DIR Optional workspace path override used when no session id is available.
  EUPHONY_DIR             Default: $CODEBUDDY_HOME/cache/euphony
  EUPHONY_HOST            Default: 127.0.0.1
  EUPHONY_PORT            Default: 3000
  EUPHONY_RUN_DIR         Default: $EUPHONY_DIR/.codebuddy-euphony
  EUPHONY_FRONTEND_ONLY_MAX_LINES
                          Default: 100000`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function writeJsonl(events, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${events.map(event => JSON.stringify(event)).join('\n')}\n`);
}

function currentSession(type) {
  return sessions.currentSession({ sessionId: currentSessionId, cwd: currentWorkspace, type });
}

function defaultSession() {
  return currentSession() || sessions.latestSession();
}

function resolveSessionInput(input) {
  if (!input) return defaultSession();
  if (input === 'current') {
    const current = currentSession();
    if (!current) {
      fail(`Current CodeBuddy session was not found.
Session id: ${currentSessionId || '[not provided]'}
Workspace: ${currentWorkspace || '[not provided]'}`);
    }
    return current;
  }
  if (input === 'latest') return sessions.latestSession();
  if (input === 'latest-desktop') return sessions.latestSessionByType('desktop');
  const resolved = path.resolve(input);
  if (fs.existsSync(resolved)) return resolved;
  const matched = sessions.findSessionById(input);
  if (matched) return matched;
  fail(`Session path or id not found: ${input}`);
}

function convertCommand(input, output) {
  const session = sessions.normalizeSessionInput(resolveSessionInput(input));
  const outFile = output ? path.resolve(output) : stableJsonlOutputPath(session.source, session.type);
  const converted = convertCodeBuddySessionToCodex(session);
  writeJsonl(converted, outFile);
  console.log(`Converted: ${session.source}`);
  console.log(`Output: ${outFile}`);
  return outFile;
}

async function stageCommand(input) {
  await runtime.selectUsablePort();
  runtime.ensureEuphonyDir();
  const session = sessions.normalizeSessionInput(resolveSessionInput(input));
  const converted = convertCodeBuddySessionToCodex(session);
  writeJsonl(converted, stagedJsonl);
  fs.writeFileSync(stagedSource, `${session.source}\n`);
  console.log(`Staged: ${session.source}`);
  console.log(`Converted: ${stagedJsonl}`);
  console.log(`Open: ${loadUrl()}`);
}

async function verifyStagedJsonlIsServed() {
  const url = stagedJsonlUrl();
  let result = { ok: false, text: '' };
  for (let i = 0; i < 20; i += 1) {
    result = await runtime.requestTextPrefix(url);
    const prefix = result.text.trimStart();
    if (result.ok && prefix.startsWith('{')) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const prefix = result.text.trimStart();
  fail(`Euphony is responding at ${runtime.baseUrl}, but ${url} is not serving the staged JSONL.
Received: ${prefix.slice(0, 80) || '[empty response]'}
Stop the other server or set EUPHONY_PORT to another value.`);
}

function stagedJsonlUrl() {
  return `${runtime.baseUrl}local-codebuddy/latest.jsonl`;
}

function loadUrl() {
  return `${runtime.baseUrl}?path=${stagedJsonlUrl()}&no-cache=true`;
}

async function openCommand(input) {
  await runtime.up();
  await stageCommand(input);
  await verifyStagedJsonlIsServed();
  const url = loadUrl();
  runtime.openBrowser(url);
  console.log(`Opened: ${url}`);
}

async function main() {
  const command = process.argv[2] || 'help';
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];
  switch (command) {
    case 'list':
      for (const item of sessions.recentSessions().slice(0, 20)) {
        console.log(`${new Date(item.mtimeMs).toISOString()}  [${item.type}]  ${item.file}`);
      }
      break;
    case 'latest':
      console.log(sessions.latestSession());
      break;
    case 'current': {
      const current = currentSession();
      if (!current) {
        fail(`Current CodeBuddy session was not found.
Session id: ${currentSessionId || '[not provided]'}
Workspace: ${currentWorkspace || '[not provided]'}`);
      }
      console.log(current);
      break;
    }
    case 'latest-desktop':
      console.log(sessions.latestSessionByType('desktop'));
      break;
    case 'convert':
      convertCommand(arg1, arg2);
      break;
    case 'stage':
      await stageCommand(arg1);
      break;
    case 'stage-desktop':
      await stageCommand(sessions.latestSessionByType('desktop'));
      break;
    case 'open':
      await openCommand(arg1);
      break;
    case 'open-desktop':
      await openCommand(sessions.latestSessionByType('desktop'));
      break;
    case 'up':
      await runtime.up();
      break;
    case 'start':
      await runtime.startForeground();
      break;
    case 'status':
      await runtime.status();
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
