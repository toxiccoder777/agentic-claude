import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const NULL_OID = '0'.repeat(40);

export function git(args, cwd, { encoding = 'utf8' } = {}) {
  return spawnSync('git', args, { cwd, encoding, maxBuffer: 256 * 1024 * 1024 });
}

export function gitOk(args, cwd) {
  const run = git(args, cwd);
  if (run.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(run.stderr || '').trim().split('\n')[0]}`);
  }
  return run.stdout;
}

export function isRepo(cwd) {
  return git(['rev-parse', '--git-dir'], cwd).status === 0;
}

/**
 * `.git` is a *file*, not a directory, inside worktrees and submodules — so
 * state files must be located through git rather than by joining onto `.git/`.
 */
export function gitPath(name, cwd) {
  const out = git(['rev-parse', '--git-path', name], cwd).stdout;
  return out ? out.trim() : null;
}

function stage(mode, oid) {
  return mode === '000000' || oid === NULL_OID ? null : { mode, oid };
}

/**
 * Porcelain v2 `u` lines carry the stage modes and blob OIDs directly, which is
 * both the conflict listing and the index fingerprint in one read:
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 * NUL-terminated because v1 C-quotes paths with odd characters.
 */
export function readUnmerged(cwd) {
  const out = gitOk(['status', '--porcelain=v2', '-z'], cwd);
  const entries = [];

  for (const record of out.split('\0')) {
    if (!record.startsWith('u ')) continue;
    const parts = record.split(' ');
    const [, xy, sub, m1, m2, m3, mW, h1, h2, h3] = parts;
    const path = parts.slice(10).join(' ');
    entries.push({
      path,
      code: xy,
      submodule: sub !== 'N...',
      worktreeMode: mW,
      base: stage(m1, h1),
      ours: stage(m2, h2),
      theirs: stage(m3, h3),
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

const OPERATION_PROBES = [
  // Rebase is checked first: an interactive rebase sets CHERRY_PICK_HEAD while
  // replaying a pick, so probing cherry-pick first would misreport it.
  { name: 'rebase', probe: 'rebase-merge', dir: true },
  { name: 'rebase', probe: 'rebase-apply', dir: true },
  { name: 'merge', probe: 'MERGE_HEAD' },
  { name: 'cherry-pick', probe: 'CHERRY_PICK_HEAD' },
  { name: 'revert', probe: 'REVERT_HEAD' },
];

export function detectOperation(cwd, existsFn) {
  for (const { name, probe } of OPERATION_PROBES) {
    const path = gitPath(probe, cwd);
    // --git-path answers relative to the repo, so it must be resolved against
    // the repo rather than against this process's working directory.
    if (path && existsFn(resolve(cwd, path))) return name;
  }
  // Conflicts can exist with no state file at all — `stash pop`, `apply -3`,
  // `checkout -m`. That is a real conflict state, not an error.
  return 'unknown';
}

export function readStage(path, stageNumber, cwd) {
  const run = git(['show', `:${stageNumber}:${path}`], cwd, { encoding: 'buffer' });
  if (run.status !== 0) return null;
  return run.stdout;
}

export function hashObject(path, cwd) {
  const run = git(['hash-object', '--', path], cwd);
  if (run.status !== 0) return null;
  return run.stdout.trim();
}

export function conflictMarkerSize(path, cwd) {
  const run = git(['check-attr', 'conflict-marker-size', '--', path], cwd);
  if (run.status !== 0) return 7;
  const match = /conflict-marker-size:\s*(\d+)\s*$/.exec(run.stdout.trim());
  return match ? Number(match[1]) : 7;
}

export function isBinary(buffer) {
  if (!buffer) return false;
  const window = buffer.subarray(0, 8000);
  return window.includes(0);
}
