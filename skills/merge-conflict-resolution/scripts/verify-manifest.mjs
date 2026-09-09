#!/usr/bin/env node
/**
 * Checks the resolution manifest against what actually happened on disk.
 *
 * The enforced thing here is deliberately NOT the prose. A rationale policed for
 * length or "non-triviality" is an arms race that the writer wins on the first
 * try, and it gates nothing. What is enforced is the structured `strategy`
 * claim, because a claim can be contradicted by the blobs: a file byte-identical
 * to "ours" while the manifest says the sides were combined is a detectable lie.
 *
 * Prose stays required, for the human reading the merge later. It just isn't
 * what the exit code depends on.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isRepo, gitPath, hashObject } from './lib/git.mjs';

const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2 };

const STRATEGIES = new Set([
  'ours-wholesale',
  'theirs-wholesale',
  'union',
  'interleaved',
  'rewritten',
  'deleted',
]);

// During a rebase "ours" is the branch being rebased ONTO and "theirs" is your
// own replayed work — the opposite of how nearly everyone reads it. A rationale
// written in those terms is ambiguous at best and wrong at worst.
const BARE_SIDE_WORDS = /\b(ours|theirs|our side|their side|our version|their version)\b/i;

function args() {
  const argv = process.argv.slice(2);
  const out = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd') out.cwd = argv[++i];
    else if (argv[i] === '--snapshot') out.snapshot = argv[++i];
    else if (argv[i] === '--manifest') out.manifest = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

function main() {
  const opts = args();
  if (opts.help) {
    console.log(`verify-manifest — check declared strategies against the blobs

  --cwd <dir>        repository (default: cwd)
  --snapshot <path>  default: <git-dir>/conflict-state/snapshot.json
  --manifest <path>  required

Exit 0 manifest is honest and complete, 1 a claim is contradicted or missing,
2 inputs unusable.
`);
    return EXIT.PASS;
  }

  const cwd = resolve(opts.cwd);
  if (!isRepo(cwd)) {
    console.error('BLOCKED: not a git repository');
    return EXIT.BLOCKED;
  }
  if (!opts.manifest) {
    console.error('BLOCKED: --manifest is required');
    return EXIT.BLOCKED;
  }

  const snapPath = opts.snapshot
    ? resolve(cwd, opts.snapshot)
    : resolve(cwd, gitPath('conflict-state', cwd), 'snapshot.json');
  const manPath = resolve(cwd, opts.manifest);

  for (const [label, p] of [['snapshot', snapPath], ['manifest', manPath]]) {
    if (!existsSync(p)) {
      console.error(`BLOCKED: ${label} not found at ${p}`);
      return EXIT.BLOCKED;
    }
  }

  let snapshot;
  let manifest;
  try {
    snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
    manifest = JSON.parse(readFileSync(manPath, 'utf8'));
  } catch (err) {
    console.error(`BLOCKED: could not parse inputs: ${err.message}`);
    return EXIT.BLOCKED;
  }

  const entries = new Map((manifest.resolutions ?? []).map((r) => [r.path, r]));
  const failures = [];

  const snapshotPaths = new Set(snapshot.files.map((f) => f.path));
  for (const extra of entries.keys()) {
    if (!snapshotPaths.has(extra)) {
      failures.push(`${extra}: manifest describes a path that was never in conflict`);
    }
  }

  for (const file of snapshot.files) {
    const entry = entries.get(file.path);

    if (!entry) {
      failures.push(`${file.path}: was in conflict but has no manifest entry — every resolved path needs a recorded decision`);
      continue;
    }

    if (!STRATEGIES.has(entry.strategy)) {
      failures.push(`${file.path}: strategy "${entry.strategy ?? '(missing)'}" is not one of ${[...STRATEGIES].join(', ')}`);
      continue;
    }

    if (typeof entry.rationale !== 'string' || entry.rationale.trim() === '') {
      failures.push(`${file.path}: no rationale recorded`);
    } else if (snapshot.operation === 'rebase' && BARE_SIDE_WORDS.test(entry.rationale)) {
      failures.push(
        `${file.path}: rationale says "ours"/"theirs" during a REBASE, where those are inverted ` +
        `(":2:" is the branch you are rebasing onto, ":3:" is your replayed work). Name the commit or branch instead.`
      );
    }

    // The falsifiable part: does the claim survive contact with the blobs?
    const abs = resolve(cwd, file.path);
    const present = existsSync(abs);

    if (entry.strategy === 'deleted') {
      if (present) failures.push(`${file.path}: declared "deleted" but the file exists`);
      continue;
    }
    if (!present) {
      failures.push(`${file.path}: file is absent but strategy is "${entry.strategy}", not "deleted"`);
      continue;
    }
    if (file.binary || file.submodule || file.symlink) continue;

    const resolvedOid = hashObject(abs, cwd);
    const oursOid = file.stages.ours?.oid ?? null;
    const theirsOid = file.stages.theirs?.oid ?? null;

    const equalsOurs = resolvedOid !== null && resolvedOid === oursOid;
    const equalsTheirs = resolvedOid !== null && resolvedOid === theirsOid;

    if (entry.strategy === 'ours-wholesale' && !equalsOurs) {
      failures.push(`${file.path}: declared "ours-wholesale" but the file is not byte-identical to stage :2: — the claim is contradicted`);
    }
    if (entry.strategy === 'theirs-wholesale' && !equalsTheirs) {
      failures.push(`${file.path}: declared "theirs-wholesale" but the file is not byte-identical to stage :3: — the claim is contradicted`);
    }
    if ((entry.strategy === 'union' || entry.strategy === 'interleaved') && (equalsOurs || equalsTheirs)) {
      const side = equalsOurs ? 'ours (:2:)' : 'theirs (:3:)';
      failures.push(
        `${file.path}: declared "${entry.strategy}" — combining both sides — but the file is byte-identical to ${side}. ` +
        `One side was dropped wholesale; say so with "${equalsOurs ? 'ours' : 'theirs'}-wholesale".`
      );
    }
  }

  for (const f of failures) console.error(`FAIL  ${f}`);

  const stats = `conflicts=${snapshot.files.length} entries=${entries.size} failures=${failures.length}`;
  if (failures.length > 0) {
    console.error(`FAIL (${stats})`);
    return EXIT.FAIL;
  }
  console.log(`PASS (${stats})`);
  return EXIT.PASS;
}

process.exit(main());
