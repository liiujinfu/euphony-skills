#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const codebuddyHome = process.env.CODEBUDDY_HOME || path.join(home, '.codebuddy');
const projectsDir = process.env.CODEBUDDY_PROJECTS_DIR || path.join(codebuddyHome, 'projects');
const includeSubagents = process.env.CODEBUDDY_INCLUDE_SUBAGENTS === '1';
const euphonyDir = process.env.EUPHONY_DIR || path.join(codebuddyHome, 'cache', 'euphony');
const euphonyRepo = process.env.EUPHONY_REPO || 'https://github.com/openai/euphony.git';
const host = process.env.EUPHONY_HOST || '127.0.0.1';
const port = Number(process.env.EUPHONY_PORT || '3000');
const maxLines = process.env.EUPHONY_FRONTEND_ONLY_MAX_LINES || '100000';
const tmuxSession = process.env.EUPHONY_TMUX_SESSION || `codebuddy-euphony-${port}`;
const baseUrl = `http://${host}:${port}/`;
const runDir = process.env.EUPHONY_RUN_DIR || path.join(euphonyDir, '.codebuddy-euphony');
const pidFile = path.join(runDir, 'vite.pid');
const logFile = path.join(runDir, 'vite.log');
const stagedDir = path.join(euphonyDir, 'public', 'local-codebuddy');
const stagedJsonl = path.join(stagedDir, 'latest.jsonl');
const stagedSource = path.join(stagedDir, 'latest-source.txt');

function usage() {
  console.log(`Usage: ${path.basename(process.argv[1])} <command> [session-jsonl] [output-jsonl]

Commands:
  list             List recent CodeBuddy session JSONL files.
  latest           Print the newest CodeBuddy session JSONL path.
  convert [in] [out]
                   Convert a CodeBuddy session to Euphony-compatible JSONL.
  stage [file]     Convert into Euphony public/local-codebuddy/latest.jsonl and print a load URL.
  open [file]      Stage a session, ensure Euphony is running, and open it in the browser.
  up               Start Euphony in the background if it is not already running.
  start            Start Euphony Vite dev server in the foreground.
  status           Check whether Euphony responds.
  stop             Stop the Euphony Vite server for this checkout.
  restart          Stop then start Euphony in the background.

Environment:
  CODEBUDDY_HOME          Default: ~/.codebuddy
  CODEBUDDY_PROJECTS_DIR  Default: $CODEBUDDY_HOME/projects
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

function commandExists(command) {
  try {
    execFileSync('/bin/sh', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function requireCommand(command) {
  if (!commandExists(command)) fail(`${command} is required for this command.`);
}

function requireProjectsDir() {
  if (!fs.existsSync(projectsDir) || !fs.statSync(projectsDir).isDirectory()) {
    fail(`CodeBuddy projects directory not found: ${projectsDir}`);
  }
}

function patchEuphonyFrontendLimit() {
  const apiManager = path.join(euphonyDir, 'src', 'utils', 'api-manager.ts');
  if (!fs.existsSync(apiManager)) return;
  const oldText = fs.readFileSync(apiManager, 'utf8');
  if (oldText.includes('VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES')) return;
  const needle =
    '// The maximum number of lines in a JSONL file to read in frontend-only mode\nconst FRONTEND_ONLY_MODE_MAX_LINES = 100;';
  if (!oldText.includes(needle)) return;
  const replacement =
    "// The maximum number of lines in a JSONL file to read in frontend-only mode.\n" +
    '// CodeBuddy converted sessions can exceed 100 lines, so keep the default\n' +
    '// high while allowing local deployments to lower it.\n' +
    'const FRONTEND_ONLY_MODE_MAX_LINES = Number.parseInt(\n' +
    "  (import.meta.env.VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES as string) || '100000',\n" +
    '  10\n' +
    ');';
  fs.writeFileSync(apiManager, oldText.replace(needle, replacement));
}

function ensureEuphonyDir() {
  const packageJson = path.join(euphonyDir, 'package.json');
  if (fs.existsSync(packageJson)) {
    patchEuphonyFrontendLimit();
    if (!fs.existsSync(path.join(euphonyDir, 'node_modules'))) {
      requireCommand('corepack');
      execFileSync('corepack', ['pnpm', 'install'], { cwd: euphonyDir, stdio: 'inherit' });
    }
    return;
  }

  if (fs.existsSync(euphonyDir)) {
    fail(`EUPHONY_DIR exists but is not an Euphony checkout: ${euphonyDir}
Remove it or set EUPHONY_DIR to another path.`);
  }

  requireCommand('git');
  requireCommand('corepack');
  fs.mkdirSync(path.dirname(euphonyDir), { recursive: true });
  console.log(`Cloning Euphony into ${euphonyDir}...`);
  execFileSync('git', ['clone', euphonyRepo, euphonyDir], { stdio: 'inherit' });
  patchEuphonyFrontendLimit();
  console.log(`Installing Euphony dependencies in ${euphonyDir}...`);
  execFileSync('corepack', ['pnpm', 'install'], { cwd: euphonyDir, stdio: 'inherit' });
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
  requireProjectsDir();
  return walkJsonlFiles(projectsDir)
    .filter(file => includeSubagents || !file.split(path.sep).includes('subagents'))
    .map(file => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function latestSession() {
  const [latest] = recentSessions();
  if (!latest) fail(`No CodeBuddy session JSONL files found under: ${projectsDir}`);
  return latest.file;
}

function toIsoTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toIsoTimestamp(numeric);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function safeJsonParse(line, lineNumber, source) {
  try {
    return JSON.parse(line);
  } catch (error) {
    return {
      type: 'codebuddy-parse-error',
      timestamp: new Date().toISOString(),
      message: `Could not parse ${source}:${lineNumber}: ${error.message}`,
      rawLine: line
    };
  }
}

function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => safeJsonParse(line, index + 1, file));
}

function textFromContent(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    for (const key of ['text', 'message', 'content', 'value']) {
      if (key in value) {
        const text = textFromContent(value[key]);
        if (text) return text;
      }
    }
    if (typeof value.type === 'string') return `[${value.type}]`;
  }
  return '';
}

function extractReasoning(event) {
  const parts = [];
  if (Array.isArray(event.rawContent)) {
    for (const part of event.rawContent) {
      const text = textFromContent(part);
      if (text) parts.push(text);
    }
  }
  if (Array.isArray(event.content)) {
    for (const part of event.content) {
      const text = textFromContent(part);
      if (text) parts.push(text);
    }
  }
  if (typeof event.providerData?.reasoning === 'string') parts.push(event.providerData.reasoning);
  return [...new Set(parts)].join('\n\n').trim();
}

function stringifyToolOutput(output) {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const text = textFromContent(output);
    if (text && text !== '[text]') return text;
  }
  return JSON.stringify(output ?? null, null, 2);
}

function codexEvent(event, payload, type = 'response_item') {
  return { timestamp: toIsoTimestamp(event.timestamp), type, payload };
}

function convertEvent(event, index, sessionId) {
  const id = event.id || `${sessionId}-codebuddy-${index}`;
  if (event.type === 'message') {
    const role = typeof event.role === 'string' ? event.role : 'assistant';
    const text = textFromContent(event.content) || '[empty message]';
    return codexEvent(event, {
      type: 'message',
      id,
      role,
      content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }]
    });
  }
  if (event.type === 'reasoning') {
    const text = extractReasoning(event);
    if (!text) return null;
    return codexEvent(event, { type: 'reasoning', id, summary: [{ type: 'summary_text', text }] });
  }
  if (event.type === 'function_call') {
    const args =
      typeof event.arguments === 'string'
        ? event.arguments
        : JSON.stringify(event.arguments ?? {}, null, 2);
    return codexEvent(event, {
      type: 'function_call',
      id,
      name: event.name || event.providerData?.name || 'tool',
      call_id: event.callId || event.call_id || id,
      arguments: args,
      status: event.status || 'completed'
    });
  }
  if (event.type === 'function_call_result') {
    return codexEvent(event, {
      type: 'function_call_output',
      id,
      name: event.name || event.providerData?.name || 'tool',
      call_id: event.callId || event.call_id || id,
      output: stringifyToolOutput(event.output ?? event.providerData?.toolResult ?? event)
    });
  }
  if (event.type === 'topic' && typeof event.topic === 'string') {
    return codexEvent(event, {
      type: 'message',
      id,
      role: 'system',
      content: [{ type: 'input_text', text: `Topic: ${event.topic}` }]
    });
  }
  if (event.type === 'codebuddy-parse-error') {
    return codexEvent(event, {
      type: 'message',
      id,
      role: 'system',
      content: [{ type: 'input_text', text: event.message }]
    });
  }
  return null;
}

function convertCodeBuddyToCodex(events, sourcePath) {
  const first = events[0] || {};
  const sessionId =
    first.sessionId ||
    events.find(event => typeof event.sessionId === 'string')?.sessionId ||
    path.basename(sourcePath, '.jsonl');
  const cwd =
    first.cwd || events.find(event => typeof event.cwd === 'string')?.cwd || path.dirname(sourcePath);
  const model = events.find(event => typeof event.providerData?.model === 'string')?.providerData.model || null;
  const startedAt = toIsoTimestamp(first.timestamp);
  const converted = [
    {
      timestamp: startedAt,
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: startedAt,
        cwd,
        originator: 'codebuddy',
        source_path: sourcePath,
        cli_version: 'codebuddy',
        codebuddy_event_count: events.length
      }
    }
  ];

  if (model) converted.push({ timestamp: startedAt, type: 'turn_context', payload: { cwd, model, source: 'codebuddy' } });

  for (let index = 0; index < events.length; index += 1) {
    const mapped = convertEvent(events[index], index, sessionId);
    if (mapped) converted.push(mapped);
  }
  return converted;
}

function writeJsonl(events, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${events.map(event => JSON.stringify(event)).join('\n')}\n`);
}

function convertCommand(input = latestSession(), output) {
  const source = path.resolve(input);
  if (!fs.existsSync(source)) fail(`Session file not found: ${source}`);
  const outFile = output ? path.resolve(output) : source.replace(/\.jsonl$/, '.euphony.jsonl');
  const converted = convertCodeBuddyToCodex(readJsonl(source), source);
  writeJsonl(converted, outFile);
  console.log(`Converted: ${source}`);
  console.log(`Output: ${outFile}`);
  return outFile;
}

function stageCommand(input = latestSession()) {
  ensureEuphonyDir();
  const source = path.resolve(input);
  if (!fs.existsSync(source)) fail(`Session file not found: ${source}`);
  const converted = convertCodeBuddyToCodex(readJsonl(source), source);
  writeJsonl(converted, stagedJsonl);
  fs.writeFileSync(stagedSource, `${source}\n`);
  console.log(`Staged: ${source}`);
  console.log(`Converted: ${stagedJsonl}`);
  console.log(`Open: ${baseUrl}?path=${baseUrl}local-codebuddy/latest.jsonl&no-cache=true`);
}

function requestHead(url, timeoutMs = 2000) {
  try {
    execFileSync('curl', ['-fsSI', '--max-time', String(Math.ceil(timeoutMs / 1000)), url], {
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return Promise.resolve(true);
  } catch {}
  return new Promise(resolve => {
    const request = http.request(url, { method: 'HEAD', timeout: timeoutMs }, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
    request.end();
  });
}

function lsofPids() {
  try {
    const output = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function pidCwd(pid) {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output
      .split(/\r?\n/)
      .find(line => line.startsWith('n'))
      ?.slice(1);
  } catch {
    return null;
  }
}

function euphonyPids() {
  return lsofPids().filter(pid => pidCwd(pid) === euphonyDir);
}

async function isRunning() {
  return euphonyPids().length > 0 && (await requestHead(baseUrl));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function startViteBackground() {
  fs.mkdirSync(runDir, { recursive: true });
  const runner = path.join(runDir, 'start-vite.sh');
  fs.writeFileSync(
    runner,
    `#!/usr/bin/env bash
set -euo pipefail
cd ${shellQuote(euphonyDir)}
exec env VITE_EUPHONY_FRONTEND_ONLY=true VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES=${shellQuote(maxLines)} corepack pnpm exec vite --host ${shellQuote(host)} --port ${shellQuote(String(port))}
`
  );
  fs.chmodSync(runner, 0o755);

  if (commandExists('tmux')) {
    try {
      execFileSync('tmux', ['has-session', '-t', tmuxSession], { stdio: 'ignore' });
      execFileSync('tmux', ['kill-session', '-t', tmuxSession], { stdio: 'ignore' });
    } catch {}
    execFileSync('tmux', ['new-session', '-d', '-s', tmuxSession, `${runner} > ${shellQuote(logFile)} 2>&1`], {
      stdio: 'ignore'
    });
    fs.writeFileSync(pidFile, `tmux:${tmuxSession}\n`);
    return;
  }

  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(runner, { cwd: euphonyDir, detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}\n`);
}

async function up() {
  if (await requestHead(baseUrl)) {
    const pids = euphonyPids();
    if (pids.length > 0) {
      ensureEuphonyDir();
      console.log(`Euphony responds at ${baseUrl}`);
      return;
    }
    fail(`Port ${port} responds at ${baseUrl}, but not from this Euphony checkout: ${euphonyDir}
Stop the other server or set EUPHONY_PORT to another value.`);
  }
  ensureEuphonyDir();
  if (euphonyPids().length === 0) {
    startViteBackground();
  }
  console.log(`Starting Euphony at ${baseUrl}`);
  console.log(`Log: ${logFile}`);
  for (let i = 0; i < 300; i += 1) {
    if (await requestHead(baseUrl)) {
      console.log(`Euphony is ready at ${baseUrl}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  fail(`Euphony did not respond at ${baseUrl}. Check ${logFile}`);
}

async function startForeground() {
  ensureEuphonyDir();
  const child = spawn(
    'corepack',
    ['pnpm', 'exec', 'vite', '--host', host, '--port', String(port)],
    {
      cwd: euphonyDir,
      env: {
        ...process.env,
        VITE_EUPHONY_FRONTEND_ONLY: 'true',
        VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES: maxLines
      },
      stdio: 'inherit'
    }
  );
  child.on('exit', code => process.exit(code ?? 0));
}

function stop() {
  const pids = new Set(euphonyPids());
  let stopped = false;
  if (commandExists('tmux')) {
    try {
      execFileSync('tmux', ['has-session', '-t', tmuxSession], { stdio: 'ignore' });
      execFileSync('tmux', ['kill-session', '-t', tmuxSession], { stdio: 'ignore' });
      console.log(`Stopped Euphony tmux session ${tmuxSession}`);
      stopped = true;
    } catch {}
  }
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
      console.log(`Stopped PID ${pid}`);
      stopped = true;
    } catch (error) {
      console.log(`Could not stop PID ${pid}: ${error.message}`);
    }
  }
  if (!stopped) {
    console.log('No Euphony listener for this checkout found.');
    return;
  }
  if (fs.existsSync(pidFile)) fs.rmSync(pidFile);
}

async function status() {
  const pids = euphonyPids();
  if (await requestHead(baseUrl)) {
    if (pids.length > 0) {
      console.log(`Euphony responds at ${baseUrl}`);
      console.log(`PID(s): ${pids.join(', ')}`);
      return;
    }
    console.log(`Port ${port} responds at ${baseUrl}, but not from this Euphony checkout: ${euphonyDir}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Euphony is not responding at ${baseUrl}`);
  process.exitCode = 1;
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

async function openCommand(input) {
  await up();
  stageCommand(input || latestSession());
  const url = `${baseUrl}?path=${baseUrl}local-codebuddy/latest.jsonl&no-cache=true`;
  openBrowser(url);
  console.log(`Opened: ${url}`);
}

async function main() {
  const command = process.argv[2] || 'help';
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];
  switch (command) {
    case 'list':
      for (const item of recentSessions().slice(0, 20)) {
        console.log(`${new Date(item.mtimeMs).toISOString()}  ${item.file}`);
      }
      break;
    case 'latest':
      console.log(latestSession());
      break;
    case 'convert':
      convertCommand(arg1 || latestSession(), arg2);
      break;
    case 'stage':
      stageCommand(arg1 || latestSession());
      break;
    case 'open':
      await openCommand(arg1);
      break;
    case 'up':
      await up();
      break;
    case 'start':
      await startForeground();
      break;
    case 'status':
      await status();
      break;
    case 'stop':
      stop();
      break;
    case 'restart':
      stop();
      await up();
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
