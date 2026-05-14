import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const isWindows = process.platform === 'win32';

function fail(message) {
  throw new Error(message);
}

function commandExists(command) {
  try {
    if (isWindows) {
      execFileSync('where', [command], { stdio: 'ignore', shell: true });
    } else {
      execFileSync('which', [command], { stdio: 'ignore' });
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

function packageRunner() {
  if (commandExists('pnpm')) {
    return { command: 'pnpm', argsPrefix: [], env: process.env, shell: isWindows };
  }
  requireCommand('corepack');
  return {
    command: 'corepack',
    argsPrefix: ['pnpm'],
    env: {
      ...process.env,
      COREPACK_INTEGRITY_KEYS: process.env.COREPACK_INTEGRITY_KEYS || '0'
    },
    shell: isWindows
  };
}

function runPnpm(args, options = {}) {
  const runner = packageRunner();
  if (runner.command === 'corepack' && !process.env.COREPACK_INTEGRITY_KEYS) {
    console.log('Using Corepack with COREPACK_INTEGRITY_KEYS=0 to avoid known pnpm signature bootstrap failures.');
  }
  return execFileSync(runner.command, [...runner.argsPrefix, ...args], {
    ...options,
    env: runner.env,
    shell: runner.shell,
    stdio: options.stdio || 'inherit'
  });
}

function spawnPnpm(args, options = {}) {
  const runner = packageRunner();
  return spawn(runner.command, [...runner.argsPrefix, ...args], {
    ...options,
    env: {
      ...runner.env,
      ...(options.env || {})
    },
    shell: runner.shell
  });
}

function patchEuphonyFrontendLimit(euphonyDir, commentLines) {
  const apiManager = path.join(euphonyDir, 'src', 'utils', 'api-manager.ts');
  if (!fs.existsSync(apiManager)) return;
  const oldText = fs.readFileSync(apiManager, 'utf8');
  if (oldText.includes('VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES')) return;
  const needle =
    '// The maximum number of lines in a JSONL file to read in frontend-only mode\nconst FRONTEND_ONLY_MODE_MAX_LINES = 100;';
  if (!oldText.includes(needle)) return;
  const comments = commentLines.map(line => `// ${line}\n`).join('');
  const replacement =
    '// The maximum number of lines in a JSONL file to read in frontend-only mode.\n' +
    comments +
    'const FRONTEND_ONLY_MODE_MAX_LINES = Number.parseInt(\n' +
    "  (import.meta.env.VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES as string) || '100000',\n" +
    '  10\n' +
    ');';
  fs.writeFileSync(apiManager, oldText.replace(needle, replacement));
}

function patchEuphonyCodexSessionDisplay(euphonyDir) {
  const codexSession = path.join(euphonyDir, 'src', 'utils', 'codex-session.ts');
  if (!fs.existsSync(codexSession)) return;
  let text = fs.readFileSync(codexSession, 'utf8');
  const originalText = text;

  const summaryNeedle = "  const summaryLines: string[] = ['Codex session'];";
  if (text.includes(summaryNeedle)) {
    text = text.replace(
      summaryNeedle,
      "  const sessionLabel =\n" +
        '    getDisplayString(sessionMetaPayload.session_label) ??\n' +
        '    getDisplayString(sessionMetaPayload.sessionLabel) ??\n' +
        "    'Codex session';\n" +
        '  const summaryLines: string[] = [sessionLabel];'
    );
  }

  const originatorNeedle =
    '  const sessionOriginator = getDisplayString(sessionMetaPayload.originator);\n' +
    '  if (sessionOriginator) {\n' +
    '    summaryLines.push(`originator: ${sessionOriginator}`);\n' +
    '  }';
  if (
    text.includes(originatorNeedle) &&
    !text.includes('const sessionSourceName = sessionOriginator ??')
  ) {
    text = text.replace(
      originatorNeedle,
      originatorNeedle + "\n  const sessionSourceName = sessionOriginator ?? 'codex';"
    );
  }

  if (text.includes("name: 'codex'")) {
    text = text.replaceAll("name: 'codex'", 'name: sessionSourceName');
  }

  const customInputNeedle =
    "        if (typeof payload.input === 'string' && payload.input.includes('\\n')) {";
  if (text.includes(customInputNeedle)) {
    text = text.replace(
      customInputNeedle,
      '        const displayInput =\n' +
        "          typeof payload.input === 'string'\n" +
        '            ? formatMaybeJSON(payload.input)\n' +
        '            : payload.input !== undefined\n' +
        '              ? formatJSON(payload.input)\n' +
        "              : '';\n\n" +
        "        if (displayInput.includes('\\n')) {"
    );
    text = text.replace(
      '              code: `tool: ${toolName}\\ncall_id: ${callId}\\n\\n${payload.input}`,',
      '              code: `tool: ${toolName}\\ncall_id: ${callId}\\n\\n${displayInput}`,'
    );
    text = text.replace(
      '          displayPayload.input = payload.input;',
      '          displayPayload.input =\n' +
        "            typeof payload.input === 'string'\n" +
        '              ? safeParseJSON(payload.input) ?? payload.input\n' +
        '              : payload.input;'
    );
  }

  if (text !== originalText) fs.writeFileSync(codexSession, text);
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

function requestTextPrefix(url, timeoutMs = 2000, maxBytes = 256) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = http.request(url, { method: 'GET', timeout: timeoutMs }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
        if (text.length >= maxBytes) {
          finish({ ok: response.statusCode >= 200 && response.statusCode < 300, text });
          request.destroy();
        }
      });
      response.on('end', () => {
        finish({ ok: response.statusCode >= 200 && response.statusCode < 300, text });
      });
    });
    request.on('timeout', () => {
      request.destroy();
      finish({ ok: false, text: '' });
    });
    request.on('error', () => finish({ ok: false, text: '' }));
    request.end();
  });
}

export function createEuphonyRuntime({
  euphonyDir,
  euphonyRepo,
  host,
  port,
  portCandidates = [],
  runDir,
  maxLines,
  frontendLimitComment
}) {
  const initialPort = Number(port);
  let activePort = initialPort;
  const candidatePorts = [...new Set([initialPort, ...portCandidates].map(Number))]
    .filter(candidate => Number.isInteger(candidate) && candidate > 0);
  const baseUrl = () => `http://${host}:${activePort}/`;
  const pidFile = path.join(runDir, 'vite.pid');
  const portFile = path.join(runDir, 'vite.port');
  const logFile = path.join(runDir, 'vite.log');
  const commentLines = Array.isArray(frontendLimitComment)
    ? frontendLimitComment
    : [frontendLimitComment].filter(Boolean);

  function ensureEuphonyDir() {
    const packageJson = path.join(euphonyDir, 'package.json');
    if (fs.existsSync(packageJson)) {
      patchEuphonyFrontendLimit(euphonyDir, commentLines);
      patchEuphonyCodexSessionDisplay(euphonyDir);
      if (!fs.existsSync(path.join(euphonyDir, 'node_modules'))) {
        console.log(`Installing Euphony dependencies in ${euphonyDir}...`);
        runPnpm(['install'], { cwd: euphonyDir });
      }
      return;
    }

    if (fs.existsSync(euphonyDir)) {
      fail(`EUPHONY_DIR exists but is not an Euphony checkout: ${euphonyDir}
Remove it or set EUPHONY_DIR to another path.`);
    }

    requireCommand('git');
    fs.mkdirSync(path.dirname(euphonyDir), { recursive: true });
    console.log(`Cloning Euphony into ${euphonyDir}...`);
    run('git', ['clone', euphonyRepo, euphonyDir]);
    patchEuphonyFrontendLimit(euphonyDir, commentLines);
    patchEuphonyCodexSessionDisplay(euphonyDir);
    console.log(`Installing Euphony dependencies in ${euphonyDir}...`);
    runPnpm(['install'], { cwd: euphonyDir });
  }

  function readTrackedPid() {
    if (!fs.existsSync(pidFile)) return null;
    const text = fs.readFileSync(pidFile, 'utf8').trim();
    if (!/^\d+$/.test(text)) return null;
    return Number(text);
  }

  function readTrackedPort() {
    if (!fs.existsSync(portFile)) return null;
    const text = fs.readFileSync(portFile, 'utf8').trim();
    if (!/^\d+$/.test(text)) return null;
    const trackedPort = Number(text);
    return trackedPort > 0 ? trackedPort : null;
  }

  function writeTrackedProcess(pid, trackedPort = activePort) {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(pidFile, `${pid}\n`);
    fs.writeFileSync(portFile, `${trackedPort}\n`);
  }

  function clearTrackedProcess() {
    fs.rmSync(pidFile, { force: true });
    fs.rmSync(portFile, { force: true });
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

  function listeningPids(candidatePort = activePort) {
    if (isWindows || !commandExists('lsof')) return [];
    try {
      const output = execFileSync('lsof', ['-nP', `-tiTCP:${candidatePort}`, '-sTCP:LISTEN'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return output.split(/\r?\n/).filter(Boolean).map(Number);
    } catch {
      return [];
    }
  }

  function pidListensOnPort(pid, candidatePort = activePort) {
    if (!pid) return false;
    if (isWindows || !commandExists('lsof')) {
      return readTrackedPort() === candidatePort;
    }
    return listeningPids(candidatePort).includes(pid);
  }

  function trackedPid(candidatePort = activePort) {
    const pid = readTrackedPid();
    return pidExists(pid) && pidListensOnPort(pid, candidatePort) ? pid : null;
  }

  function legacyCheckoutPids(candidatePort = activePort) {
    if (isWindows || !commandExists('lsof')) return [];
    try {
      return listeningPids(candidatePort)
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
        });
    } catch {
      return [];
    }
  }

  function verifiedPidForStop() {
    const pid = readTrackedPid();
    if (!pidExists(pid)) return null;
    if (isWindows || !commandExists('lsof')) return null;
    return legacyCheckoutPids(activePort).includes(pid) ? pid : null;
  }

  function trackedOrAdoptedPid() {
    const pid = trackedPid();
    if (pid) return pid;
    const [legacyPid] = legacyCheckoutPids();
    if (!legacyPid) return null;
    writeTrackedProcess(legacyPid);
    return legacyPid;
  }

  async function selectUsablePort() {
    for (const candidatePort of candidatePorts) {
      activePort = candidatePort;
      if (trackedOrAdoptedPid()) return;
      if (!(await requestHead(baseUrl()))) return;
    }
    activePort = initialPort;
  }

  function startViteBackground() {
    fs.mkdirSync(runDir, { recursive: true });
    const logFd = fs.openSync(logFile, 'a');
    const child = spawnPnpm(['exec', 'vite', '--host', host, '--port', String(activePort), '--strictPort'], {
      cwd: euphonyDir,
      detached: true,
      env: {
        VITE_EUPHONY_FRONTEND_ONLY: 'true',
        VITE_EUPHONY_FRONTEND_ONLY_MAX_LINES: maxLines
      },
      stdio: ['ignore', logFd, logFd]
    });
    child.unref();
    writeTrackedProcess(child.pid);
  }

  async function up() {
    await selectUsablePort();
    const existingPid = trackedOrAdoptedPid();
    if (await requestHead(baseUrl())) {
      if (existingPid) {
        ensureEuphonyDir();
        console.log(`Euphony responds at ${baseUrl()}`);
        console.log(`PID: ${existingPid}`);
        return;
      }
      fail(`Port ${activePort} responds at ${baseUrl()}, but this script has no live pid file for it.
Stop the other server or set EUPHONY_PORT to another value.`);
    }
    ensureEuphonyDir();
    if (!existingPid) startViteBackground();
    console.log(`Starting Euphony at ${baseUrl()}`);
    console.log(`Log: ${logFile}`);
    for (let i = 0; i < 300; i += 1) {
      if (await requestHead(baseUrl())) {
        console.log(`Euphony is ready at ${baseUrl()}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    fail(`Euphony did not respond at ${baseUrl()}. Check ${logFile}`);
  }

  async function startForeground() {
    await selectUsablePort();
    ensureEuphonyDir();
    const child = spawnPnpm(['exec', 'vite', '--host', host, '--port', String(activePort), '--strictPort'], {
      cwd: euphonyDir,
      env: {
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
    const trackedPort = readTrackedPort();
    if (trackedPort) activePort = trackedPort;
    const pid = verifiedPidForStop() || legacyCheckoutPids()[0] || null;
    if (!pid) {
      clearTrackedProcess();
      console.log('No tracked Euphony process found.');
      return;
    }
    try {
      killProcessTree(pid);
      console.log(`Stopped PID ${pid}`);
    } catch (error) {
      console.log(`Could not stop PID ${pid}: ${error.message}`);
    }
    clearTrackedProcess();
  }

  async function status() {
    await selectUsablePort();
    const pid = trackedOrAdoptedPid();
    if (await requestHead(baseUrl())) {
      if (pid) {
        console.log(`Euphony responds at ${baseUrl()}`);
        console.log(`PID: ${pid}`);
        return;
      }
      console.log(`Port ${activePort} responds at ${baseUrl()}, but this script has no live pid file for it.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Euphony is not responding at ${baseUrl()}`);
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

  return {
    get baseUrl() {
      return baseUrl();
    },
    ensureEuphonyDir,
    openBrowser,
    requestHead,
    requestTextPrefix,
    selectUsablePort,
    startForeground,
    status,
    stop,
    up
  };
}
