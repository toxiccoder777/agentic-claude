#!/usr/bin/env node
/**
 * Proves what can be proven about a conflict resolution.
 *
 * It cannot prove the merge is semantically correct — nothing can, short of
 * understanding the program. What it can prove, because git hands over all
 * three parents, is that the resolution stayed in scope and kept its
 * provenance: it didn't wander outside the conflict hunks, didn't quietly
 * discard a side, didn't revert to the merge base, and didn't touch the index.
 *
 * A marker scan alone would be vacuously green on delete/modify, binary and
 * submodule conflicts, which carry no markers at all. Those are reported as
 * BLOCKED rather than passed.
 */
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  isRepo, gitPath, readUnmerged, readStage, hashObject, conflictMarkerSize, git, isBinary,
} from './lib/git.mjs';
import { parseConflicted, leftoverMarkers, firstMissingInOrder } from './lib/conflict-regions.mjs';

const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2 };

const WHOLESALE = { 'ours-wholesale': 'ours', 'theirs-wholesale': 'theirs' };

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

function usage() {
  console.log(`verify-resolution — prove a conflict resolution stayed in scope

  --cwd <dir>        repository (default: cwd)
  --snapshot <path>  default: <git-dir>/conflict-state/snapshot.json
  --manifest <path>  resolution manifest, enables declared-strategy overrides

Exit 0 clean, 1 the resolution is wrong, 2 cannot judge (fix the inputs).
`);
}

function eolStyle(buf) {
  const text = buf.toString('utf8');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  if (crlf && !lf) return 'crlf';
  if (lf && !crlf) return 'lf';
  if (!crlf && !lf) return 'none';
  return 'mixed';
}

function endsWithNewline(buf) {
  return buf.length > 0 && (buf[buf.length - 1] === 0x0a);
}

/**
 * When core.autocrlf or a `text`/`eol` attribute is in play, the working tree's
 * line endings are git's doing, not the resolver's — the blob is stored LF and
 * checked out CRLF. Comparing the two would flag every file on Windows. In that
 * situation the committed content is already covered by the blob-hash checks, so
 * the honest move is to skip this check and say we skipped it.
 */
function eolIsGitManaged(path, cwd) {
  const autocrlf = (git(['config', '--get', 'core.autocrlf'], cwd).stdout || '').trim();
  if (autocrlf === 'true' || autocrlf === 'input') return true;
  const attrs = (git(['check-attr', 'text', 'eol', '--', path], cwd).stdout || '');
  return /:\s*text:\s*(set|auto)\s*$/m.test(attrs) || /:\s*eol:\s*(lf|crlf)\s*$/m.test(attrs);
}

function regenerateConflict(path, cwd, size) {
  const scratch = mkdtempSync(join(tmpdir(), 'mcr-'));
  try {
    const files = {};
    for (const [name, stageNumber] of [['ours', 2], ['base', 1], ['theirs', 3]]) {
      const buf = readStage(path, stageNumber, cwd);
      // Added-by-both (AA) legitimately has no stage 1. An empty ancestor is the
      // correct input for that case, not a reason to give up.
      if (buf === null && name !== 'base') return null;
      files[name] = join(scratch, name);
      writeFileSync(files[name], buf ?? Buffer.alloc(0));
    }
    const run = git(
      ['merge-file', '-p', '-q', '--marker-size', String(size), files.ours, files.base, files.theirs],
      cwd,
      { encoding: 'buffer' }
    );
    // merge-file exits with the conflict count; only a negative/!=0-with-no-output
    // case is a real failure.
    if (!run.stdout) return null;
    return run.stdout.toString('utf8');
  } catch {
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const opts = args();
  if (opts.help) {
    usage();
    return EXIT.PASS;
  }

  const cwd = resolve(opts.cwd);
  if (!isRepo(cwd)) {
    console.error('BLOCKED: not a git repository');
    return EXIT.BLOCKED;
  }

  const snapPath = opts.snapshot
    ? resolve(cwd, opts.snapshot)
    : resolve(cwd, gitPath('conflict-state', cwd), 'snapshot.json');

  if (!existsSync(snapPath)) {
    console.error(`BLOCKED: no snapshot at ${snapPath} — run snapshot-conflicts.mjs before resolving, not after`);
    return EXIT.BLOCKED;
  }

  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
  } catch (err) {
    console.error(`BLOCKED: snapshot unreadable: ${err.message}`);
    return EXIT.BLOCKED;
  }

  let manifest = null;
  if (opts.manifest) {
    const mPath = resolve(cwd, opts.manifest);
    if (!existsSync(mPath)) {
      console.error(`BLOCKED: manifest not found at ${mPath}`);
      return EXIT.BLOCKED;
    }
    try {
      manifest = JSON.parse(readFileSync(mPath, 'utf8'));
    } catch (err) {
      console.error(`BLOCKED: manifest unreadable: ${err.message}`);
      return EXIT.BLOCKED;
    }
  }
  const declared = new Map(
    (manifest?.resolutions ?? []).map((r) => [r.path, r])
  );

  const blocking = [];
  const blockedReasons = [];
  const notes = [];
  let eolSkipped = 0;

  // --- Check 1: the index must be exactly as it was --------------------------
  // Staging is forbidden during resolution, so every snapshot path must STILL be
  // unmerged. `git add` clears unmerged status even when the file still contains
  // conflict markers, so a shrinking unmerged set is the marker-baking bug caught
  // at its cause rather than its symptom.
  const currentUnmerged = new Map(readUnmerged(cwd).map((e) => [e.path, e]));
  for (const file of snapshot.files) {
    const now = currentUnmerged.get(file.path);
    if (!now) {
      blocking.push({
        check: 'index-untouched',
        path: file.path,
        detail: 'no longer unmerged — it was staged during resolution. `git add` clears conflict status even with markers still in the file, so this must be unstaged and re-checked.',
      });
      continue;
    }
    for (const side of ['base', 'ours', 'theirs']) {
      const before = file.stages[side]?.oid ?? null;
      const after = now[side]?.oid ?? null;
      if (before !== after) {
        blocking.push({
          check: 'index-untouched',
          path: file.path,
          detail: `stage "${side}" changed underneath the snapshot (${before} -> ${after}) — the snapshot is stale`,
        });
      }
    }
  }

  // --- Per-file checks -------------------------------------------------------
  for (const file of snapshot.files) {
    const claim = declared.get(file.path);
    const strategy = claim?.strategy ?? null;
    const abs = resolve(cwd, file.path);

    if (file.needsHumanDecision) {
      const why = file.submodule ? 'submodule' : file.symlink ? 'symlink' : file.binary ? 'binary' : `missing stage (${file.code})`;
      if (!strategy) {
        blockedReasons.push(`${file.path}: ${why} — carries no conflict markers, so nothing here can judge it. Declare a strategy in the manifest recording the decision.`);
      } else {
        notes.push(`${file.path}: ${why}, resolved by declared "${strategy}" — not mechanically verifiable, taken on the manifest's word`);
      }
      continue;
    }

    if (strategy === 'deleted') {
      if (existsSync(abs)) {
        blocking.push({ check: 'declared-deleted', path: file.path, detail: 'manifest declares "deleted" but the file is still present' });
      }
      continue;
    }

    if (!existsSync(abs)) {
      blocking.push({ check: 'file-present', path: file.path, detail: 'file is gone but no "deleted" strategy was declared' });
      continue;
    }

    const resolvedBuf = readFileSync(abs);
    const size = conflictMarkerSize(file.path, cwd);

    // --- Check 2: no leftover markers ---------------------------------------
    if (!isBinary(resolvedBuf)) {
      const markers = leftoverMarkers(resolvedBuf.toString('utf8'), size);
      for (const m of markers) {
        blocking.push({ check: 'markers', path: file.path, detail: `line ${m.line}: leftover conflict marker (${m.kind}) "${m.text.slice(0, 40)}"` });
      }
    }

    // --- Check 3: not degenerate to a single parent -------------------------
    const resolvedOid = hashObject(abs, cwd);
    const baseOid = file.stages.base?.oid ?? null;
    const oursOid = file.stages.ours?.oid ?? null;
    const theirsOid = file.stages.theirs?.oid ?? null;

    if (resolvedOid && resolvedOid === baseOid) {
      blocking.push({
        check: 'degenerate-base',
        path: file.path,
        detail: 'resolved file is byte-identical to the merge base — this discards BOTH sides\' changes, which is never a correct resolution',
      });
    } else if (resolvedOid && (resolvedOid === oursOid || resolvedOid === theirsOid)) {
      const side = resolvedOid === oursOid ? 'ours' : 'theirs';
      const allowed = WHOLESALE[strategy] === side;
      if (!allowed) {
        blocking.push({
          check: 'undeclared-side-drop',
          path: file.path,
          detail: `resolved file is byte-identical to "${side}" — the other side was dropped wholesale. Legal, but it must be declared as "${side}-wholesale" in the manifest.`,
        });
      } else {
        notes.push(`${file.path}: ${side} taken wholesale, as declared`);
      }
    }

    // --- Checks 4 & 5: scope and both-sides-agreed content ------------------
    const regenerated = regenerateConflict(file.path, cwd, size);
    if (regenerated === null) {
      blockedReasons.push(`${file.path}: could not regenerate git's conflicted output, so scope cannot be checked`);
    } else {
      const parsed = parseConflicted(regenerated, size);
      // Scope is about content, not line endings — the worktree copy may be CRLF
      // while the stage blobs are LF. Check 6 owns EOL; comparing it here would
      // just make every file on Windows look out-of-scope.
      const stripCr = (l) => (l.endsWith('\r') ? l.slice(0, -1) : l);
      const resolvedLines = resolvedBuf.toString('utf8').split('\n').map(stripCr);
      parsed.context = parsed.context.map(stripCr);
      for (const region of parsed.regions) {
        region.ours = region.ours.map(stripCr);
        region.theirs = region.theirs.map(stripCr);
      }

      if (strategy !== 'rewritten' && !WHOLESALE[strategy]) {
        const miss = firstMissingInOrder(parsed.context, resolvedLines);
        if (miss) {
          blocking.push({
            check: 'out-of-hunk-edit',
            path: file.path,
            detail: `a line git had already merged outside any conflict region is missing or reordered: "${miss.line.slice(0, 60)}". Resolution must stay inside the conflict hunks; declare "rewritten" if the edit was deliberate.`,
          });
        }

        for (const region of parsed.regions) {
          const agreed = region.ours.filter(
            (l) => l.trim() !== '' && region.theirs.includes(l)
          );
          for (const line of new Set(agreed)) {
            if (!resolvedLines.includes(line)) {
              blocking.push({
                check: 'dropped-agreed-line',
                path: file.path,
                detail: `both sides contained "${line.slice(0, 60)}" but the resolution dropped it`,
              });
            }
          }
        }
      }
    }

    // --- Check 6: line endings and final newline ----------------------------
    const oursBuf = file.stages.ours ? readStage(file.path, 2, cwd) : null;
    const eolManaged = eolIsGitManaged(file.path, cwd);
    if (eolManaged) eolSkipped++;
    if (oursBuf && !isBinary(oursBuf) && strategy !== 'rewritten' && !eolManaged) {
      const before = eolStyle(oursBuf);
      const after = eolStyle(resolvedBuf);
      if (before !== after && before !== 'none' && after !== 'none') {
        blocking.push({
          check: 'eol-changed',
          path: file.path,
          detail: `line endings changed ${before} -> ${after} during resolution — this rewrites every line in the diff and hides the real change`,
        });
      }
    }
    if (oursBuf && !isBinary(oursBuf) && strategy !== 'rewritten') {
      if (endsWithNewline(oursBuf) !== endsWithNewline(resolvedBuf)) {
        blocking.push({
          check: 'final-newline-changed',
          path: file.path,
          detail: `final newline ${endsWithNewline(oursBuf) ? 'removed' : 'added'} during resolution`,
        });
      }
    }
  }

  // --- Report ----------------------------------------------------------------
  for (const b of blocking) console.error(`FAIL  [${b.check}] ${b.path}: ${b.detail}`);
  for (const r of blockedReasons) console.error(`BLOCKED  ${r}`);
  for (const n of notes) console.log(`note  ${n}`);

  if (eolSkipped > 0) {
    console.log(`note  eol check skipped on ${eolSkipped} path(s) — git manages line endings here (core.autocrlf or a text/eol attribute), so worktree EOL is not the resolver's choice`);
  }

  const stats = `files=${snapshot.files.length} operation=${snapshot.operation} failures=${blocking.length} blocked=${blockedReasons.length}`;

  if (blocking.length > 0) {
    console.error(`FAIL (${stats})`);
    return EXIT.FAIL;
  }
  if (blockedReasons.length > 0) {
    console.error(`BLOCKED (${stats})`);
    console.error('  Some paths could not be judged. That is not the same as passing.');
    return EXIT.BLOCKED;
  }
  console.log(`PASS (${stats})`);
  return EXIT.PASS;
}

process.exit(main());
