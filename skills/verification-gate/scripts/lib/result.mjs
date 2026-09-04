import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// FAIL means "fix your code". BLOCKED means "fix your fixture" — the gate could
// not form an opinion, which is never the same thing as approval.
export const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2 };

export const VERDICT = { PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED' };

export function createResult(gateId) {
  return {
    gate: gateId,
    verdict: null,
    blockedReason: null,
    blocking: [],
    nonBlocking: [],
    stats: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
  };
}

export function blocked(result, reason) {
  result.verdict = VERDICT.BLOCKED;
  result.blockedReason = reason;
  return result;
}

export function addBlocking(result, finding) {
  result.blocking.push(finding);
  return result;
}

export function addNonBlocking(result, finding) {
  result.nonBlocking.push(finding);
  return result;
}

export function finalize(result) {
  if (result.verdict !== VERDICT.BLOCKED) {
    result.verdict = result.blocking.length === 0 ? VERDICT.PASS : VERDICT.FAIL;
  }
  result.finishedAt = new Date().toISOString();
  result.durationMs = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
  return result;
}

export function exitCodeFor(result) {
  if (result.verdict === VERDICT.BLOCKED) return EXIT.BLOCKED;
  if (result.verdict === VERDICT.FAIL) return EXIT.FAIL;
  return EXIT.PASS;
}

export function writeResult(result, statePath) {
  mkdirSync(statePath, { recursive: true });
  const file = join(statePath, `gate-${result.gate}-result.json`);
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  return file;
}

function describe(finding) {
  const where = finding.where ? ` [${finding.where}]` : '';
  const why = finding.reason ? ` — ${finding.reason}` : '';
  return `${finding.what}${where}${why}`;
}

export function report(result) {
  const label = `[${result.gate}] ${result.verdict}`;
  if (result.verdict === VERDICT.BLOCKED) {
    console.error(`${label}: ${result.blockedReason}`);
    console.error('  This gate could not judge the change. That is not a pass.');
    return;
  }

  const stats = Object.entries(result.stats)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`${label}${stats ? ` (${stats})` : ''}`);

  for (const finding of result.blocking) {
    console.error(`  BLOCKING  ${describe(finding)}`);
  }
  for (const finding of result.nonBlocking) {
    console.log(`  reported  ${describe(finding)}`);
  }
}

// Every gate ends here so the exit-code contract lives in exactly one place.
export function emit(result, statePath) {
  finalize(result);
  writeResult(result, statePath);
  report(result);
  return exitCodeFor(result);
}

export async function runGate(gateId, statePath, fn) {
  const result = createResult(gateId);
  try {
    await fn(result);
  } catch (err) {
    blocked(result, `gate threw: ${err.message}`);
  }
  process.exit(emit(result, statePath));
}
