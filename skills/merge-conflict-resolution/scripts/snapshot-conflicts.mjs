#!/usr/bin/env node
/**
 * Records the conflict state before anyone touches it. Everything downstream
 * compares against this: which paths were unmerged, which stage blobs each had,
 * and which operation produced them.
 *
 * The snapshot lives inside .git/ (located via `git rev-parse --git-path`, since
 * .git is a *file* in worktrees) so that a `git add -A` during the merge cannot
 * commit it into the very merge it is describing.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  isRepo, gitPath, readUnmerged, detectOperation, readStage, isBinary, git,
} from './lib/git.mjs';

const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2 };

function args() {
  const argv = process.argv.slice(2);
  const out = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd') out.cwd = argv[++i];
    else if (argv[i] === '--print') out.print = true;
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

// A conflict where the two sides differ only in whitespace is a formatting
// collision, not a semantic one — worth flagging before anyone hand-edits it,
// because hand-resolving these is where EOL and indentation damage enters.
//
// Done by direct comparison rather than a re-merge: `git merge-file` has no
// whitespace-ignoring option (verified against git 2.37), so there is nothing
// to shell out to.
function normalizeWhitespace(buf) {
  return buf
    .toString('utf8')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n+$/, '');
}

function whitespaceOnly(entry, cwd) {
  if (!entry.ours || !entry.theirs) return false;
  const ours = readStage(entry.path, 2, cwd);
  const theirs = readStage(entry.path, 3, cwd);
  if (!ours || !theirs) return false;
  if (isBinary(ours) || isBinary(theirs)) return false;
  return normalizeWhitespace(ours) === normalizeWhitespace(theirs);
}

function main() {
  const opts = args();
  if (opts.help) {
    console.log(`snapshot-conflicts — record conflict state before resolving

  --cwd <dir>   repository to inspect (default: cwd)
  --print       also print the snapshot to stdout

Writes <git-dir>/conflict-state/snapshot.json.
Exit 0 conflicts recorded, 2 nothing to resolve or not a repo.
`);
    return EXIT.PASS;
  }

  const cwd = resolve(opts.cwd);
  if (!isRepo(cwd)) {
    console.error('BLOCKED: not a git repository');
    return EXIT.BLOCKED;
  }

  const entries = readUnmerged(cwd);
  if (entries.length === 0) {
    console.error('BLOCKED: no unmerged paths — there is no conflict to resolve here');
    return EXIT.BLOCKED;
  }

  const operation = detectOperation(cwd, existsSync);

  const files = entries.map((entry) => {
    const oursBuf = entry.ours ? readStage(entry.path, 2, cwd) : null;
    const theirsBuf = entry.theirs ? readStage(entry.path, 3, cwd) : null;
    const binary = isBinary(oursBuf) || isBinary(theirsBuf);
    const submodule = entry.submodule || entry.worktreeMode === '160000';
    const symlink = entry.worktreeMode === '120000';

    return {
      path: entry.path,
      code: entry.code,
      stages: { base: entry.base, ours: entry.ours, theirs: entry.theirs },
      binary,
      submodule,
      symlink,
      // These three never carry conflict markers, so a marker scan says nothing
      // about them. They require an explicit human decision instead.
      needsHumanDecision: binary || submodule || symlink || !entry.ours || !entry.theirs,
      whitespaceOnly: !binary && !submodule ? whitespaceOnly(entry, cwd) : false,
    };
  });

  const snapshot = {
    capturedAt: new Date().toISOString(),
    operation,
    head: (git(['rev-parse', 'HEAD'], cwd).stdout || '').trim(),
    files,
  };

  const dir = gitPath('conflict-state', cwd);
  const outFile = resolve(cwd, dir, 'snapshot.json');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(snapshot, null, 2) + '\n');

  const humanCount = files.filter((f) => f.needsHumanDecision).length;
  const wsCount = files.filter((f) => f.whitespaceOnly).length;

  console.log(`snapshot written: ${outFile}`);
  console.log(`operation=${operation} conflicts=${files.length} needs-human-decision=${humanCount} whitespace-only=${wsCount}`);
  if (operation === 'rebase') {
    console.log('NOTE rebase in progress — "ours" (:2:) is the branch you are rebasing ONTO, "theirs" (:3:) is your replayed work. The sides are inverted from what they read like.');
  }
  for (const f of files.filter((x) => x.needsHumanDecision)) {
    const why = f.submodule ? 'submodule' : f.symlink ? 'symlink' : f.binary ? 'binary' : `missing stage (${f.code})`;
    console.log(`  needs-decision  ${f.path} — ${why}, no conflict markers exist to resolve`);
  }
  if (opts.print) console.log(JSON.stringify(snapshot, null, 2));

  return EXIT.PASS;
}

process.exit(main());
