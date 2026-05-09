#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const home = os.homedir();
const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
const sessionsDir = process.env.CODEX_SESSIONS_DIR || path.join(codexHome, 'sessions');
const euphonyDir = process.env.EUPHONY_DIR || path.join(codexHome, 'cache', 'euphony');
const euphonyRepo = process.env.EUPHONY_REPO || 'https://github.com/openai/euphony.git';
const host = process.env.EUPHONY_HOST || '127.0.0.1';
const port = Number(process.env.EUPHONY_PORT || '3000');
const baseUrl = `http://${host}:${port}/`;
const runDir = process.env.EUPHONY_RUN_DIR || path.join(euphonyDir, '.codex-euphony');
const pidFile = path.join(runDir, 'vite.pid');
const logFile = path.join(runDir, 'vite.log');
const maxLines = process.env.EUPHONY_FRONTEND_ONLY_MAX_LINES || '100000';
const stageMode = process.env.EUPHONY_STAGE_MODE || (isWindows ? 'copy' : 'symlink');
const stagedDir = path.join(euphonyDir, 'public', 'local-codex');
const stagedJsonl = path.join(stagedDir, 'latest.jsonl');
const stagedSource = path.join(stagedDir, 'latest-source.txt');

function usage() {
  console.log(`Usage: ${path.basename(process.argv[1])} <command> [session-jsonl]

Commands:
  list             List recent Codex session JSONL files.
  latest           Print the newest Codex session JSONL path.
  status           Check whether Euphony responds.
  ensure           Ensure the Euphony runtime checkout and dependencies exist.
  stage [file]     Stage a session JSONL into Euphony public/local-codex/latest.jsonl and print a load URL.
  url [file]       Ensure Euphony is running, stage a session, and print the load URL.
  open [file]      Ensure Euphony is running, stage a session, and open the load URL in the browser.
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
                       Default: 100000`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function commandExists(command) {
  try {
    if (isWindows) {
      execFileSync('where', [command], { stdio: 'ignore', shell: true });
    } else {
      execFileSync('/bin/sh', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

function requireCommand(command) {
  if (!commandExists(command)) fail(`${command} is required for this command.`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    ...options,
    shell: isWindows && command === 'corepack',
    stdio: options.stdio || 'inherit'
  });
}

function requireSessionsDir() {
  if (!fs.existsSync(sessionsDir) || !fs.statSync(sessionsDir).isDirectory()) {
    fail(`Codex sessions directory not found: ${sessionsDir}`);
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
    '// Codex rollout files are event streams and routinely exceed 100 lines, so keep\n' +
    '// the default high while allowing local deployments to lower it.\n' +
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
      console.log(`Installing Euphony dependencies in ${euphonyDir}...`);
      run('corepack', ['pnpm', 'install'], { cwd: euphonyDir });
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
  run('git', ['clone', euphonyRepo, euphonyDir]);
  patchEuphonyFrontendLimit();
  console.log(`Installing Euphony dependencies in ${euphonyDir}...`);
  run('corepack', ['pnpm', 'install'], { cwd: euphonyDir });
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

function stageSession(input = latestSession()) {
  ensureEuphonyDir();
  const source = path.resolve(input);
  if (!fs.existsSync(source)) fail(`Session file not found: ${source}`);
  fs.mkdirSync(stagedDir, { recursive: true });
  if (stageMode === 'symlink') {
    try {
      fs.rmSync(stagedJsonl, { force: true });
      fs.symlinkSync(source, stagedJsonl, 'file');
    } catch {
      fs.copyFileSync(source, stagedJsonl);
    }
  } else {
    fs.copyFileSync(source, stagedJsonl);
  }
  fs.writeFileSync(stagedSource, `${source}\n`);
  const url = `${baseUrl}?path=${baseUrl}local-codex/latest.jsonl&no-cache=true`;
  console.log(`Staged: ${source}`);
  console.log(`Open: ${url}`);
  return url;
}

function requestHead(url, timeoutMs = 2000) {
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

function readTrackedPid() {
  if (!fs.existsSync(pidFile)) return null;
  const text = fs.readFileSync(pidFile, 'utf8').trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function pidExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function trackedPid() {
  const pid = readTrackedPid();
  return pidExists(pid) ? pid : null;
}

function legacyCheckoutPids() {
  if (isWindows || !commandExists('lsof')) return [];
  try {
    const output = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .filter(pid => {
        try {
          const cwdOutput = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
          });
          const cwd = cwdOutput
            .split(/\r?\n/)
            .find(line => line.startsWith('n'))
            ?.slice(1);
          return cwd === euphonyDir;
        } catch {
          return false;
        }
      })
      .map(Number);
  } catch {
    return [];
  }
}

function trackedOrAdoptedPid() {
  const pid = trackedPid();
  if (pid) return pid;
  const [legacyPid] = legacyCheckoutPids();
  if (!legacyPid) return null;
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(pidFile, `${legacyPid}\n`);
  return legacyPid;
}

function startViteBackground() {
  fs.mkdirSync(runDir, { recursive: true });
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn('corepack', ['pnpm', 'exec', 'vite', '--host', host, '--port', String(port)], {
    cwd: euphonyDir,
    detached: true,
    shell: isWindows,
    env: {
      ...process.env,
      VITE_EUPHONY_FRONTEND_ONLY: 'true',
      VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES: maxLines
    },
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}\n`);
}

async function up() {
  const existingPid = trackedOrAdoptedPid();
  if (await requestHead(baseUrl)) {
    if (existingPid) {
      ensureEuphonyDir();
      console.log(`Euphony responds at ${baseUrl}`);
      console.log(`PID: ${existingPid}`);
      return;
    }
    fail(`Port ${port} responds at ${baseUrl}, but this script has no live pid file for it.
Stop the other server or set EUPHONY_PORT to another value.`);
  }
  ensureEuphonyDir();
  if (!existingPid) startViteBackground();
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
  const child = spawn('corepack', ['pnpm', 'exec', 'vite', '--host', host, '--port', String(port)], {
    cwd: euphonyDir,
    shell: isWindows,
    env: {
      ...process.env,
      VITE_EUPHONY_FRONTEND_ONLY: 'true',
      VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES: maxLines
    },
    stdio: 'inherit'
  });
  child.on('exit', code => process.exit(code ?? 0));
}

function killProcessTree(pid) {
  if (isWindows) {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  } else {
    process.kill(pid, 'SIGTERM');
  }
}

function stop() {
  const pid = trackedOrAdoptedPid();
  if (!pid) {
    if (fs.existsSync(pidFile)) fs.rmSync(pidFile, { force: true });
    console.log('No tracked Euphony process found.');
    return;
  }
  try {
    killProcessTree(pid);
    console.log(`Stopped PID ${pid}`);
  } catch (error) {
    console.log(`Could not stop PID ${pid}: ${error.message}`);
  }
  fs.rmSync(pidFile, { force: true });
}

async function status() {
  const pid = trackedOrAdoptedPid();
  if (await requestHead(baseUrl)) {
    if (pid) {
      console.log(`Euphony responds at ${baseUrl}`);
      console.log(`PID: ${pid}`);
      return;
    }
    console.log(`Port ${port} responds at ${baseUrl}, but this script has no live pid file for it.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Euphony is not responding at ${baseUrl}`);
  if (pid) console.log(`Tracked PID exists but HTTP is not ready: ${pid}`);
  process.exitCode = 1;
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : isWindows ? 'cmd' : 'xdg-open';
  const args = isWindows ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false });
  child.on('error', () => {
    console.log(`Open this URL in a browser: ${url}`);
  });
  child.unref();
}

async function openCommand(input) {
  await up();
  const url = stageSession(input || latestSession());
  openBrowser(url);
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
    case 'status':
      await status();
      break;
    case 'ensure':
      ensureEuphonyDir();
      console.log(`Euphony is ready at ${euphonyDir}`);
      break;
    case 'stage':
      stageSession(arg1 || latestSession());
      break;
    case 'url':
      await up();
      stageSession(arg1 || latestSession());
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
