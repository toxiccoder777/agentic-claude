#!/usr/bin/env node
/**
 * Asserts the verifiers' exit codes against generated fixtures.
 *
 * This exists because every scenario in this skill was originally verified by
 * hand, once — and a review then found three silent passes that no fixture
 * would have caught. A tool arguing that manual verification does not hold has
 * no business being manually verified.
 *
 * Each case builds its own throwaway repo, so nothing leaks between them.
 * Exit 0 all cases behaved as asserted, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', '..', 'skills', 'merge-conflict-resolution', 'scripts');
const IDENT = [
  '-c', 'user.name=fixture',
  '-c', 'user.email=fixture@example.invalid',
  '-c', 'commit.gpgsign=false',
];

const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2 };
const NAME = { 0: 'PASS', 1: 'FAIL', 2: 'BLOCKED' };

function git(args, cwd, allowFail = false) {
  const r = spawnSync('git', [...IDENT, ...args], { cwd, encoding: 'utf8' });
  if (!allowFail && r.status !== 0) throw new Error(`git ${args.join(' ')}\n${r.stderr}`);
  return r;
}

function node(script, args, cwd) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), '--cwd', cwd, ...args], {
    encoding: 'utf8',
  });
}

/** A repo with one two-sided conflict in `f.txt`, plus whatever `setup` adds. */
function makeRepo(setup) {
  const dir = mkdtempSync(join(tmpdir(), 'mcr-case-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', '--local', 'core.autocrlf', 'false'], dir);
  setup(dir);
  return dir;
}

function twoSided(dir, { base, ours, theirs, file = 'f.txt', extra }) {
  writeFileSync(join(dir, file), base);
  if (extra) extra(dir, 'base');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'base'], dir);
  git(['branch', 'feature'], dir);

  writeFileSync(join(dir, file), ours);
  if (extra) extra(dir, 'ours');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'ours'], dir);

  git(['checkout', '-q', 'feature'], dir);
  writeFileSync(join(dir, file), theirs);
  if (extra) extra(dir, 'theirs');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'theirs'], dir);

  git(['checkout', '-q', 'main'], dir);
  git(['merge', 'feature'], dir, true);
}

const cases = [];
const def = (name, fn) => cases.push({ name, fn });

// --- regression: a leftover bare separator must not pass -------------------
def('leftover bare ======= is caught (no start/end markers present)', (dir) => {
  twoSided(dir, {
    base: 'a\nb\nc\n',
    ours: 'a\nOURS\nc\n',
    theirs: 'a\nTHEIRS\nc\n',
  });
  node('snapshot-conflicts.mjs', [], dir);
  writeFileSync(join(dir, 'f.txt'), 'a\nOURS\n=======\nTHEIRS\nc\n');
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.FAIL, out: r.stdout + r.stderr, expect: /markers/ };
});

// --- regression: merge-file erroring must not read as an empty merge -------
def('merge-file refusing a binary base is BLOCKED, not a silent pass', (dir) => {
  // Text on both sides, binary ancestor: isBinary() sees only the two text
  // stages, but merge-file inspects all three and refuses.
  twoSided(dir, {
    base: '\u0000\u0001binary\u0000\n',
    ours: 'SHARED\nOURS\n',
    theirs: 'SHARED\nTHEIRS\n',
  });
  node('snapshot-conflicts.mjs', [], dir);
  writeFileSync(join(dir, 'f.txt'), 'OURS\nTHEIRS\n'); // drops the agreed SHARED line
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.BLOCKED, out: r.stdout + r.stderr };
});

// --- regression: an unterminated region must not swallow the tail ----------
def('stale committed marker (unterminated region) is BLOCKED', (dir) => {
  twoSided(dir, {
    base: '<<<<<<< HEAD\nstale\nkeep-me\nlast\n',
    ours: '<<<<<<< HEAD\nstale\nkeep-me\nOURS\n',
    theirs: '<<<<<<< HEAD\nstale\nkeep-me\nTHEIRS\n',
  });
  node('snapshot-conflicts.mjs', [], dir);
  // tidies the stale marker AND quietly deletes keep-me
  writeFileSync(join(dir, 'f.txt'), 'stale\nOURS\nTHEIRS\n');
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.BLOCKED, out: r.stdout + r.stderr };
});

// --- regression: an unknown strategy must not relax the checks -------------
def('unknown strategy is rejected, not treated as relaxing', (dir) => {
  twoSided(dir, { base: 'a\nb\nc\n', ours: 'a\nOURS\nc\n', theirs: 'a\nTHEIRS\nc\n' });
  node('snapshot-conflicts.mjs', [], dir);
  git(['show', ':2:f.txt'], dir); // resolve to ours exactly
  writeFileSync(join(dir, 'f.txt'), 'a\nOURS\nc\n');
  writeFileSync(
    join(dir, 'm.json'),
    JSON.stringify({ resolutions: [{ path: 'f.txt', strategy: 'constructor', rationale: 'x' }] })
  );
  const r = node('verify-resolution.mjs', ['--manifest', 'm.json'], dir);
  return { got: r.status, want: EXIT.FAIL, out: r.stdout + r.stderr, expect: /unknown-strategy/ };
});

// --- the checks that already worked, kept as regressions -------------------
def('clean resolution passes', (dir) => {
  twoSided(dir, { base: 'a\nb\nc\n', ours: 'a\nOURS\nc\n', theirs: 'a\nTHEIRS\nc\n' });
  node('snapshot-conflicts.mjs', [], dir);
  writeFileSync(join(dir, 'f.txt'), 'a\nOURS\nTHEIRS\nc\n');
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.PASS, out: r.stdout + r.stderr };
});

def('staging a still-conflicted file is caught', (dir) => {
  twoSided(dir, { base: 'a\nb\nc\n', ours: 'a\nOURS\nc\n', theirs: 'a\nTHEIRS\nc\n' });
  node('snapshot-conflicts.mjs', [], dir);
  git(['add', 'f.txt'], dir);
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.FAIL, out: r.stdout + r.stderr, expect: /index-untouched/ };
});

def('resolving to the merge base is caught', (dir) => {
  twoSided(dir, { base: 'a\nb\nc\n', ours: 'a\nOURS\nc\n', theirs: 'a\nTHEIRS\nc\n' });
  node('snapshot-conflicts.mjs', [], dir);
  writeFileSync(join(dir, 'f.txt'), 'a\nb\nc\n');
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.FAIL, out: r.stdout + r.stderr, expect: /degenerate-base/ };
});

def('undeclared wholesale side-drop is caught', (dir) => {
  twoSided(dir, { base: 'a\nb\nc\n', ours: 'a\nOURS\nc\n', theirs: 'a\nTHEIRS\nc\n' });
  node('snapshot-conflicts.mjs', [], dir);
  writeFileSync(join(dir, 'f.txt'), 'a\nOURS\nc\n');
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.FAIL, out: r.stdout + r.stderr, expect: /undeclared-side-drop/ };
});

def('deleting a line git already merged is caught', (dir) => {
  twoSided(dir, { base: 'keep\na\nb\nc\n', ours: 'keep\na\nOURS\nc\n', theirs: 'keep\na\nTHEIRS\nc\n' });
  node('snapshot-conflicts.mjs', [], dir);
  writeFileSync(join(dir, 'f.txt'), 'a\nOURS\nTHEIRS\nc\n'); // 'keep' deleted
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.FAIL, out: r.stdout + r.stderr, expect: /out-of-hunk-edit/ };
});

def('a Markdown ======= underline is not a false positive', (dir) => {
  twoSided(dir, { base: 'a\nb\nc\n', ours: 'a\nOURS\nc\n', theirs: 'a\nTHEIRS\nc\n' });
  node('snapshot-conflicts.mjs', [], dir);
  // resolved cleanly, but the content legitimately contains 7 and 8 equals
  writeFileSync(join(dir, 'f.txt'), 'a\nOURS\nTHEIRS\nc\nHeading\n========\n');
  const r = node('verify-resolution.mjs', [], dir);
  return { got: r.status, want: EXIT.PASS, out: r.stdout + r.stderr };
});

def('no conflicts at all is BLOCKED, not PASS', (dir) => {
  writeFileSync(join(dir, 'f.txt'), 'a\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'only'], dir);
  const r = node('snapshot-conflicts.mjs', [], dir);
  return { got: r.status, want: EXIT.BLOCKED, out: r.stdout + r.stderr };
});

def('a bad config is BLOCKED, not FAIL', (dir) => {
  writeFileSync(join(dir, 'f.txt'), 'a\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'only'], dir);
  const r = node('verify-resolution.mjs', ['--snapshot', 'nope.json'], dir);
  return { got: r.status, want: EXIT.BLOCKED, out: r.stdout + r.stderr };
});

let failed = 0;
for (const { name, fn } of cases) {
  let dir;
  try {
    dir = makeRepo(() => {});
    const res = fn(dir);
    const okCode = res.got === res.want;
    const okText = !res.expect || res.expect.test(res.out);
    if (okCode && okText) {
      console.log(`ok    ${name}  [${NAME[res.got]}]`);
    } else {
      failed++;
      console.error(`FAIL  ${name}`);
      if (!okCode) console.error(`        expected ${NAME[res.want]}(${res.want}), got ${NAME[res.got]}(${res.got})`);
      if (!okText) console.error(`        expected output to match ${res.expect}`);
      console.error(res.out.split('\n').map((l) => `        | ${l}`).join('\n'));
    }
  } catch (err) {
    failed++;
    console.error(`ERROR ${name}: ${err.message}`);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} (${cases.length - failed}/${cases.length} cases)`);
process.exit(failed === 0 ? 0 : 1);
