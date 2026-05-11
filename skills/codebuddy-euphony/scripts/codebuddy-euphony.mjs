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
const stagedDir = path.join(euphonyDir, 'public', 'local-codebuddy');
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
    'CodeBuddy converted sessions can exceed 100 lines, so keep the default',
    'high while allowing local deployments to lower it.'
  ]
});
const { baseUrl } = runtime;
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
  latest-desktop   Print the newest CodeBuddy desktop session path.
  convert [in] [out]
                   Convert a CodeBuddy session to Euphony-compatible JSONL.
  stage [file]     Convert into Euphony public/local-codebuddy/latest.jsonl and print a load URL.
  stage-desktop    Stage the newest CodeBuddy desktop session.
  open [file]      Stage a session, ensure Euphony is running, and open it in the browser.
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

function convertCommand(input = sessions.latestSession(), output) {
  const session = sessions.normalizeSessionInput(input);
  const outFile = output ? path.resolve(output) : stableJsonlOutputPath(session.source, session.type);
  const converted = convertCodeBuddySessionToCodex(session);
  writeJsonl(converted, outFile);
  console.log(`Converted: ${session.source}`);
  console.log(`Output: ${outFile}`);
  return outFile;
}

function stageCommand(input = sessions.latestSession()) {
  runtime.ensureEuphonyDir();
  const session = sessions.normalizeSessionInput(input);
  const converted = convertCodeBuddySessionToCodex(session);
  writeJsonl(converted, stagedJsonl);
  fs.writeFileSync(stagedSource, `${session.source}\n`);
  console.log(`Staged: ${session.source}`);
  console.log(`Converted: ${stagedJsonl}`);
  console.log(`Open: ${baseUrl}?path=${baseUrl}local-codebuddy/latest.jsonl&no-cache=true`);
}

async function verifyStagedJsonlIsServed() {
  const url = `${baseUrl}local-codebuddy/latest.jsonl`;
  let result = { ok: false, text: '' };
  for (let i = 0; i < 20; i += 1) {
    result = await runtime.requestTextPrefix(url);
    const prefix = result.text.trimStart();
    if (result.ok && prefix.startsWith('{')) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const prefix = result.text.trimStart();
  fail(`Euphony is responding at ${baseUrl}, but ${url} is not serving the staged JSONL.
Received: ${prefix.slice(0, 80) || '[empty response]'}
Stop the other server or set EUPHONY_PORT to another value.`);
}

async function openCommand(input) {
  await runtime.up();
  stageCommand(input || sessions.latestSession());
  await verifyStagedJsonlIsServed();
  const url = `${baseUrl}?path=${baseUrl}local-codebuddy/latest.jsonl&no-cache=true`;
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
    case 'latest-desktop':
      console.log(sessions.latestSessionByType('desktop'));
      break;
    case 'convert':
      convertCommand(arg1 || sessions.latestSession(), arg2);
      break;
    case 'stage':
      stageCommand(arg1 || sessions.latestSession());
      break;
    case 'stage-desktop':
      stageCommand(sessions.latestSessionByType('desktop'));
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
