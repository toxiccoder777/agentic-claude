#!/usr/bin/env node
/**
 * Generates a throwaway git repo containing one conflict of each type the skill
 * has to handle. The repo is never committed to this project — it is created on
 * demand in a temp directory, because a nested git repo can't live inside this
 * one and a conflict state can't be checked in.
 *
 * Identity is passed per-command so this never reads or writes the developer's
 * git config.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const IDENT = [
  '-c', 'user.name=fixture',
  '-c', 'user.email=fixture@example.invalid',
  '-c', 'commit.gpgsign=false',
];

function run(args, cwd, { allowFail = false } = {}) {
  const r = spawnSync('git', [...IDENT, ...args], { cwd, encoding: 'utf8' });
  if (!allowFail && r.status !== 0) {
    throw new Error(`git ${args.join(' ')} -> ${r.status}\n${r.stderr}`);
  }
  return r;
}

const target = process.argv[2] || join(tmpdir(), `mcr-fixture-${Date.now()}`);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

run(['init', '-q', '-b', 'main'], target);
// Pin line-ending handling off so the EOL check is actually exercised here
// rather than being skipped as git-managed, which is what would happen on a
// Windows checkout with core.autocrlf=true.
run(['config', '--local', 'core.autocrlf', 'false'], target);

const write = (name, content) => writeFileSync(join(target, name), content);

// --- base commit -------------------------------------------------------------
write('both-modified.txt', ['line one', 'line two', 'SHARED-UNTOUCHED', 'line four'].join('\n') + '\n');
// Both sides rewrite this block, but agree on the middle line. Because the
// surrounding lines differ, git cannot lift the agreed line out as context — it
// ends up *inside* the conflict region, present in both alternatives. That is
// the only shape where "both sides agreed on this line" is a distinct check
// from "don't edit outside the hunk".
write('agreed-inside-region.txt', ['one', 'two', 'three'].join('\n') + '\n');
write('deleted-by-us.txt', 'original content\n');
write('whitespace.txt', 'function greet() {\n    return "hi";\n}\n');
writeFileSync(join(target, 'image.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x10]));
write('.gitattributes', 'image.bin binary\n');
run(['add', '-A'], target);
run(['commit', '-qm', 'base'], target);
run(['branch', 'feature'], target);

// --- ours (main) -------------------------------------------------------------
write('both-modified.txt', ['line one', 'OURS-CHANGE', 'SHARED-UNTOUCHED', 'BOTH-ADDED-THIS', 'line four'].join('\n') + '\n');
write('agreed-inside-region.txt', ['ONE-OURS', 'AGREED-LINE', 'THREE-OURS'].join('\n') + '\n');
write('added-by-both.txt', 'ours version of a new file\n');
run(['rm', '-q', 'deleted-by-us.txt'], target);
write('whitespace.txt', 'function greet() {\n\treturn "hi";\n}\n');
writeFileSync(join(target, 'image.bin'), Buffer.from([0x00, 0xaa, 0xbb, 0xff, 0x00, 0x11]));
run(['add', '-A'], target);
run(['commit', '-qm', 'ours: change several files'], target);

// --- theirs (feature) --------------------------------------------------------
run(['checkout', '-q', 'feature'], target);
write('both-modified.txt', ['line one', 'THEIRS-CHANGE', 'SHARED-UNTOUCHED', 'BOTH-ADDED-THIS', 'line four'].join('\n') + '\n');
write('agreed-inside-region.txt', ['ONE-THEIRS', 'AGREED-LINE', 'THREE-THEIRS'].join('\n') + '\n');
write('added-by-both.txt', 'theirs version of a new file\n');
write('deleted-by-us.txt', 'they modified it instead of deleting\n');
write('whitespace.txt', 'function greet() {\n        return "hi";\n}\n');
writeFileSync(join(target, 'image.bin'), Buffer.from([0x00, 0xcc, 0xdd, 0xff, 0x00, 0x22]));
run(['add', '-A'], target);
run(['commit', '-qm', 'theirs: change the same files'], target);

// --- provoke the conflict ----------------------------------------------------
run(['checkout', '-q', 'main'], target);
const merge = run(['merge', 'feature'], target, { allowFail: true });
if (merge.status === 0) {
  console.error('fixture is broken: the merge succeeded, so there is nothing to resolve');
  process.exit(1);
}

console.log(target);
