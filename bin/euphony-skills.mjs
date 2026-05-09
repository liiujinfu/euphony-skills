#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const isWindows = process.platform === 'win32';

const targets = {
  codex: {
    label: 'Codex',
    homeEnv: 'CODEX_HOME',
    defaultHome: path.join(home, '.codex'),
    skillName: 'codex-euphony',
    executables: ['scripts/codex-euphony.mjs', 'scripts/codex-euphony.sh']
  },
  codebuddy: {
    label: 'CodeBuddy',
    homeEnv: 'CODEBUDDY_HOME',
    defaultHome: path.join(home, '.codebuddy'),
    skillName: 'codebuddy-euphony',
    executables: ['scripts/codebuddy-euphony.mjs']
  }
};

function usage() {
  console.log(`Usage: euphony-skills <command> [target] [options]

Commands:
  install codex|codebuddy|all      Install skill(s).
  uninstall codex|codebuddy|all    Remove installed skill(s).
  doctor                           Check local install prerequisites and state.
  help                             Show this help.

Options:
  --force    Replace an existing install.
  --link     Symlink from this checkout instead of copying.

Environment:
  CODEX_HOME      Override Codex home. Default: ~/.codex
  CODEBUDDY_HOME  Override CodeBuddy home. Default: ~/.codebuddy`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function commandExists(command) {
  try {
    if (isWindows) {
      execFileSync('where', [command], { stdio: 'ignore', shell: true });
    } else {
      execFileSync('/bin/sh', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
        stdio: 'ignore'
      });
    }
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function parseArgs(argv) {
  const args = [...argv];
  const flags = new Set(args.filter(arg => arg.startsWith('--')));
  const positional = args.filter(arg => !arg.startsWith('--'));
  return {
    command: positional[0] || 'help',
    target: positional[1],
    force: flags.has('--force'),
    link: flags.has('--link')
  };
}

function expandTargets(target) {
  if (target === 'all') return Object.keys(targets);
  if (target && targets[target]) return [target];
  fail(`Unknown target: ${target || '(missing)'}

Expected one of: codex, codebuddy, all`);
}

function sourceDirFor(targetKey) {
  return path.join(rootDir, 'skills', targets[targetKey].skillName);
}

function homeDirFor(targetKey) {
  const target = targets[targetKey];
  return process.env[target.homeEnv] || target.defaultHome;
}

function installDirFor(targetKey) {
  return path.join(homeDirFor(targetKey), 'skills', targets[targetKey].skillName);
}

function removeExisting(dest) {
  if (!pathExists(dest)) return;
  fs.rmSync(dest, { recursive: true, force: true });
}

function pathExists(file) {
  return fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
}

function copyRecursive(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: false,
    filter: source => !source.split(path.sep).includes('.git')
  });
}

function chmodExecutables(targetKey) {
  if (isWindows) return;
  const target = targets[targetKey];
  const dest = installDirFor(targetKey);
  for (const relative of target.executables) {
    const file = path.join(dest, relative);
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
  }
}

function installOne(targetKey, options) {
  const source = sourceDirFor(targetKey);
  const dest = installDirFor(targetKey);
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
    fail(`Missing skill source: ${source}`);
  }
  if (pathExists(dest)) {
    if (!options.force) {
      fail(`${targets[targetKey].label} skill already exists: ${dest}
Use --force to replace it.`);
    }
    removeExisting(dest);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (options.link) {
    fs.symlinkSync(source, dest, 'dir');
  } else {
    copyRecursive(source, dest);
  }
  if (!options.link) chmodExecutables(targetKey);
  console.log(`Installed ${targets[targetKey].label}: ${dest}${options.link ? ` -> ${source}` : ''}`);
}

function uninstallOne(targetKey) {
  const dest = installDirFor(targetKey);
  if (!pathExists(dest)) {
    console.log(`${targets[targetKey].label} skill is not installed: ${dest}`);
    return;
  }
  removeExisting(dest);
  console.log(`Removed ${targets[targetKey].label}: ${dest}`);
}

function statInstall(targetKey) {
  const target = targets[targetKey];
  const source = sourceDirFor(targetKey);
  const dest = installDirFor(targetKey);
  const installed = pathExists(dest);
  const linkTarget = installed && fs.lstatSync(dest).isSymbolicLink() ? fs.readlinkSync(dest) : null;
  const executableStatus = target.executables.map(relative => {
    const file = path.join(dest, relative);
    if (!fs.existsSync(file)) return `${relative}: missing`;
    const mode = fs.statSync(file).mode;
    return `${relative}: ${(mode & 0o111) !== 0 ? 'executable' : 'not executable'}`;
  });
  return {
    target,
    source,
    dest,
    installed,
    linkTarget,
    executableStatus
  };
}

function doctor() {
  console.log(`Node: ${process.version}`);
  for (const command of ['git', 'corepack']) {
    console.log(`${command}: ${commandExists(command) ? 'found' : 'missing'}`);
  }
  for (const key of Object.keys(targets)) {
    const status = statInstall(key);
    console.log(`\n${status.target.label}`);
    console.log(`  source: ${status.source}`);
    console.log(`  install: ${status.dest}`);
    console.log(`  installed: ${status.installed ? 'yes' : 'no'}`);
    if (status.linkTarget) console.log(`  link: ${status.linkTarget}`);
    for (const line of status.executableStatus) console.log(`  ${line}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'install':
      for (const targetKey of expandTargets(args.target)) installOne(targetKey, args);
      console.log('Restart Codex or CodeBuddy to pick up newly installed skills.');
      break;
    case 'uninstall':
      for (const targetKey of expandTargets(args.target)) uninstallOne(targetKey);
      break;
    case 'doctor':
      doctor();
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

main();
