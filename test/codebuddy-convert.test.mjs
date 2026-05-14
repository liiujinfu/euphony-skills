#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(rootDir, 'skills', 'codebuddy-euphony', 'scripts', 'codebuddy-euphony.mjs');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euphony-skills-test-'));
const cliFixture = path.join(rootDir, 'test', 'fixtures', 'codebuddy-cli', 'session.jsonl');
const desktopRoot = path.join(rootDir, 'test', 'fixtures', 'codebuddy-desktop');
const desktopFixture = path.join(desktopRoot, 'conversation-1');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function convert(input, outputName) {
  const output = path.join(tempDir, outputName);
  execFileSync(process.execPath, [script, 'convert', input, output], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return readJsonl(output);
}

const cliRows = convert(
  cliFixture,
  'cli.jsonl'
);
assert(cliRows.some(row => row.payload?.type === 'message' && row.payload.content?.[0]?.text === 'hello cli'), 'CLI message was not converted.');
assert(cliRows.some(row => row.type === 'session_meta' && row.payload?.session_label === 'CodeBuddy session'), 'CLI session label was not set.');
assert(cliRows.some(row => row.payload?.type === 'function_call' && row.payload.name === 'exec_command'), 'CLI execute_command was not normalized.');
assert(cliRows.some(row => row.payload?.type === 'function_call_output' && row.payload.output === 'cli'), 'CLI command output was not simplified.');
assert(
  cliRows.some(
    row =>
      row.type === 'turn_context' &&
      row.payload?.model === 'ep-test123' &&
      !('codebuddy_model_id' in row.payload)
  ),
  'CLI model should be displayed exactly as recorded in providerData.model.'
);

const idOnlyFixture = path.join(tempDir, 'id-only.jsonl');
fs.writeFileSync(
  idOnlyFixture,
  `${JSON.stringify({
    timestamp: '2026-05-09T08:00:00.000Z',
    type: 'message',
    id: 'id-only-user-1',
    role: 'user',
    sessionId: 'id-only-session',
    cwd: '/tmp/codebuddy-cli',
    content: [{ type: 'text', text: 'hello id only' }],
    providerData: { model: 'ep-only123' }
  })}\n`
);
const idOnlyRows = convert(idOnlyFixture, 'id-only-output.jsonl');
assert(
  idOnlyRows.some(
    row =>
      row.type === 'turn_context' &&
      row.payload?.model === 'ep-only123' &&
      !('codebuddy_model_id' in row.payload)
  ),
  'CLI model id should be displayed when no specific display-name field exists.'
);

assert(
  cliRows.some(
    row =>
      row.payload?.type === 'custom_tool_call' &&
      row.payload.name === 'Skill' &&
      row.payload.input.includes('"skill": "gitnexus-exploring"') &&
      !row.payload.input.includes('\\"skill\\"')
  ),
  'CLI custom tool JSON string arguments were not normalized.'
);

const desktopRows = convert(
  desktopFixture,
  'desktop.jsonl'
);
const desktopText = desktopRows.map(row => row.payload?.content?.[0]?.text || row.payload?.output || '').join('\n');
assert(desktopText.includes('/codebuddy-euphony\n 打开桌面端，'), 'Desktop resource_link did not render as display text.');
assert(!desktopText.includes('[resource_link]'), 'Desktop resource_link placeholder leaked into output.');
assert(!desktopText.includes('Injected context should not be shown'), 'Desktop sourceContentBlocks did not override injected content.');
assert(desktopRows.some(row => row.payload?.type === 'function_call' && row.payload.name === 'exec_command'), 'Desktop tool call was not converted.');
assert(desktopRows.some(row => row.payload?.type === 'function_call_output' && row.payload.output === '/tmp/codebuddy-desktop'), 'Desktop tool result was not converted.');

const currentCli = execFileSync(process.execPath, [script, 'current'], {
  cwd: rootDir,
  env: {
    ...process.env,
    CODEBUDDY_PROJECTS_DIR: path.dirname(cliFixture),
    CODEBUDDY_DESKTOP_DATA_DIR: desktopRoot,
    CODEBUDDY_EUPHONY_SESSION_ID: 'cli-session'
  },
  encoding: 'utf8'
}).trim();
assert(currentCli === cliFixture, 'CodeBuddy current command did not select session id match.');

const currentDesktop = execFileSync(process.execPath, [script, 'current'], {
  cwd: rootDir,
  env: {
    ...process.env,
    CODEBUDDY_PROJECTS_DIR: path.dirname(cliFixture),
    CODEBUDDY_DESKTOP_DATA_DIR: desktopRoot,
    CODEBUDDY_EUPHONY_SESSION_ID: '',
    CODEBUDDY_WORKSPACE_DIR: '/tmp/injected'
  },
  encoding: 'utf8'
}).trim();
assert(currentDesktop === desktopFixture, 'CodeBuddy current command did not select workspace match.');

const fakeEuphonyDir = path.join(tempDir, 'fake-euphony');
fs.mkdirSync(path.join(fakeEuphonyDir, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(fakeEuphonyDir, 'package.json'), '{"scripts":{}}\n');

const stageOutput = execFileSync(process.execPath, [script, 'stage', cliFixture], {
  cwd: rootDir,
  env: {
    ...process.env,
    EUPHONY_DIR: fakeEuphonyDir,
    EUPHONY_PORT: '37123'
  },
  encoding: 'utf8'
});
assert(
  stageOutput.includes(
    'Open: http://127.0.0.1:37123/?path=http://127.0.0.1:37123/local-codebuddy/latest.jsonl&no-cache=true'
  ),
  'CodeBuddy stage command should use the same port for page and JSONL URLs.'
);
assert(
  fs.existsSync(path.join(fakeEuphonyDir, 'public', 'local-codebuddy', 'latest.jsonl')),
  'CodeBuddy stage command did not write the staged JSONL.'
);

console.log('CodeBuddy conversion fixtures passed.');
