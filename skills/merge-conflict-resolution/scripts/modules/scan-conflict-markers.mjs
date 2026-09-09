#!/usr/bin/env node
/**
 * Standalone marker scan, invocable without a snapshot — for a quick check
 * before committing, or on a tree whose conflict came from something that
 * leaves no state file (`stash pop`, `apply -3`).
 *
 * On its own this proves very little: delete/modify, binary and submodule
 * conflicts carry no markers at all, so a clean scan is not a clean merge. Use
 * verify-resolution.mjs for the real thing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isRepo, git, conflictMarkerSize, isBinary } from '../lib/git.mjs';
import { leftoverMarkers } from '../lib/conflict-regions.mjs';

const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2 };

function args() {
  const argv = process.argv.slice(2);
  const out = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd') out.cwd = argv[++i];
    else if (argv[i] === '--files') out.files = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

function main() {
  const opts = args();
  if (opts.help) {
    console.log(`scan-conflict-markers — find leftover conflict markers

  --cwd <dir>       repository (default: cwd)
  --files a,b,c     limit to these paths (default: all tracked files)

Exit 0 none found, 1 markers found, 2 cannot scan.
`);
    return EXIT.PASS;
  }

  const cwd = resolve(opts.cwd);
  if (!isRepo(cwd)) {
    console.error('BLOCKED: not a git repository');
    return EXIT.BLOCKED;
  }

  const files = opts.files
    ? opts.files.split(',').map((f) => f.trim()).filter(Boolean)
    : (git(['ls-files', '-z'], cwd).stdout || '').split('\0').filter(Boolean);

  if (files.length === 0) {
    console.error('BLOCKED: no files to scan — an empty scan is not a clean scan');
    return EXIT.BLOCKED;
  }

  let scanned = 0;
  let hits = 0;

  for (const rel of files) {
    let buf;
    try {
      buf = readFileSync(resolve(cwd, rel));
    } catch {
      continue;
    }
    if (isBinary(buf)) continue;
    scanned++;

    for (const m of leftoverMarkers(buf.toString('utf8'), conflictMarkerSize(rel, cwd))) {
      console.error(`FAIL  ${rel}:${m.line}: leftover conflict marker (${m.kind})`);
      hits++;
    }
  }

  console.log(`${hits > 0 ? 'FAIL' : 'PASS'} (scanned=${scanned} markers=${hits})`);
  return hits > 0 ? EXIT.FAIL : EXIT.PASS;
}

process.exit(main());
