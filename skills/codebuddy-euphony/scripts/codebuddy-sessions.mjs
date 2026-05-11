import fs from 'node:fs';
import path from 'node:path';

function defaultFail(message) {
  throw new Error(message);
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

export function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

export function isDesktopSessionDir(dir) {
  const stat = safeStat(dir);
  return Boolean(
    stat?.isDirectory() &&
      fs.existsSync(path.join(dir, 'index.json')) &&
      safeStat(path.join(dir, 'messages'))?.isDirectory()
  );
}

function walkDesktopSessionDirs(dir, out = [], depth = 0) {
  if (depth > 10) return out;
  const stat = safeStat(dir);
  if (!stat?.isDirectory()) return out;
  if (isDesktopSessionDir(dir)) {
    out.push(dir);
    return out;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'messages' || entry.name === 'check-point' || entry.name === 'file-tree') continue;
    walkDesktopSessionDirs(path.join(dir, entry.name), out, depth + 1);
  }
  return out;
}

export function desktopSessionMtime(sessionDir) {
  let mtimeMs = safeStat(path.join(sessionDir, 'index.json'))?.mtimeMs || safeStat(sessionDir)?.mtimeMs || 0;
  const messagesDir = path.join(sessionDir, 'messages');
  try {
    for (const entry of fs.readdirSync(messagesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('.')) continue;
      mtimeMs = Math.max(mtimeMs, safeStat(path.join(messagesDir, entry.name))?.mtimeMs || 0);
    }
  } catch {
    // Keep the index mtime fallback.
  }
  return mtimeMs;
}

export function createCodeBuddySessionStore({
  projectsDir,
  desktopDataDir,
  includeSubagents = false,
  fail = defaultFail
}) {
  function recentSessions() {
    const cliSessions = safeStat(projectsDir)?.isDirectory()
      ? walkJsonlFiles(projectsDir)
          .filter(file => includeSubagents || !file.split(path.sep).includes('subagents'))
          .map(file => ({ type: 'cli', file, mtimeMs: fs.statSync(file).mtimeMs }))
      : [];
    const desktopSessions = safeStat(desktopDataDir)?.isDirectory()
      ? walkDesktopSessionDirs(desktopDataDir).map(file => ({
          type: 'desktop',
          file,
          mtimeMs: desktopSessionMtime(file)
        }))
      : [];
    const sessions = [...cliSessions, ...desktopSessions].sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (!sessions.length) {
      fail(`No CodeBuddy sessions found.
Checked CLI sessions: ${projectsDir}
Checked desktop sessions: ${desktopDataDir}`);
    }
    return sessions;
  }

  function latestSession() {
    const [latest] = recentSessions();
    return latest.file;
  }

  function latestSessionByType(type) {
    const latest = recentSessions().find(item => item.type === type);
    if (!latest) fail(`No CodeBuddy ${type} sessions found.`);
    return latest.file;
  }

  function normalizeSessionInput(input) {
    const source = path.resolve(input);
    const stat = safeStat(source);
    if (!stat) fail(`Session path not found: ${source}`);
    if (stat.isFile() && source.endsWith('.jsonl')) return { type: 'cli', source };
    if (stat.isDirectory() && isDesktopSessionDir(source)) return { type: 'desktop', source };
    if (stat.isFile() && path.basename(source) === 'index.json' && isDesktopSessionDir(path.dirname(source))) {
      return { type: 'desktop', source: path.dirname(source) };
    }
    if (stat.isFile() && path.basename(path.dirname(source)) === 'messages') {
      const sessionDir = path.dirname(path.dirname(source));
      if (isDesktopSessionDir(sessionDir)) return { type: 'desktop', source: sessionDir };
    }
    fail(`Unsupported CodeBuddy session path: ${source}
Expected a CLI .jsonl file or a desktop conversation directory containing index.json and messages/.`);
  }

  return {
    latestSession,
    latestSessionByType,
    normalizeSessionInput,
    recentSessions
  };
}

