#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(rootDir, 'skills', 'codex-euphony', 'scripts', 'codex-euphony.mjs');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euphony-skills-codex-test-'));
const sessionsDir = path.join(tempDir, 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });

function writeSession(fileName, sessionId, timestamp) {
  const file = path.join(sessionsDir, fileName);
  fs.writeFileSync(
    file,
    [
      JSON.stringify({
        timestamp,
        type: 'session_meta',
        payload: {
          id: sessionId,
          timestamp,
          cwd: tempDir,
          originator: 'codex-tui'
        }
      }),
      JSON.stringify({
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: sessionId }]
        }
      })
    ].join('\n') + '\n'
  );
  return file;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const currentFile = writeSession('rollout-2026-05-10T10-00-00-current.jsonl', 'current-session-id', '2026-05-10T10:00:00.000Z');
const latestFile = writeSession('rollout-2026-05-11T10-00-00-latest.jsonl', 'latest-session-id', '2026-05-11T10:00:00.000Z');
fs.utimesSync(currentFile, new Date('2026-05-10T10:00:00.000Z'), new Date('2026-05-10T10:00:00.000Z'));
fs.utimesSync(latestFile, new Date('2026-05-11T10:00:00.000Z'), new Date('2026-05-11T10:00:00.000Z'));

const env = {
  ...process.env,
  CODEX_SESSIONS_DIR: sessionsDir,
  CODEX_THREAD_ID: 'current-session-id'
};

const current = execFileSync(process.execPath, [script, 'current'], {
  cwd: rootDir,
  env,
  encoding: 'utf8'
}).trim();
assert(current === currentFile, 'current command did not select CODEX_THREAD_ID session.');

const latest = execFileSync(process.execPath, [script, 'latest'], {
  cwd: rootDir,
  env,
  encoding: 'utf8'
}).trim();
assert(latest === latestFile, 'latest command did not preserve mtime-based selection.');

console.log('Codex current-session selection passed.');
