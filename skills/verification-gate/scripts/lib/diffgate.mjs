import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readBaselineNdjson, parseNdjson } from './baseline.mjs';
import { checkSilence } from './silence.mjs';
import { compileRules, applyClassification } from './partition.mjs';
import { blocked, addBlocking, addNonBlocking } from './result.mjs';

/**
 * Gates that compare a fresh capture against a frozen one — HTTP parity, DOM
 * fingerprints, anything keyed and field-wise — differ only in what they
 * capture. Capture is inherently project-specific, so the project owns that
 * command and this owns the part worth getting right: keying, field diffing,
 * coverage partitioning, root-cause classification and silence detection.
 */
export function keyOf(record, keyFields) {
  return keyFields.map((f) => String(record[f] ?? '')).join(' | ');
}

function valueOf(record, field) {
  const value = record[field];
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
}

export async function runDiffGate(result, { config, gate }) {
  if (!gate.captureCommand) return blocked(result, 'no "captureCommand" configured for this gate');
  if (!gate.captureOutput) return blocked(result, 'no "captureOutput" configured for this gate');

  const keyFields = gate.key ?? ['route'];
  const compareFields = gate.compare ?? [];
  if (compareFields.length === 0) {
    return blocked(result, 'no "compare" fields configured — this gate would compare nothing and pass trivially');
  }

  const capture = spawnSync(gate.captureCommand, {
    shell: true,
    cwd: config.projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const outFile = resolve(config.projectRoot, gate.captureOutput);
  if (!existsSync(outFile)) {
    return blocked(
      result,
      `capture command produced no ${gate.captureOutput}${
        capture.stderr ? ` (${capture.stderr.trim().split('\n')[0]})` : ''
      }`
    );
  }

  let current;
  try {
    current = parseNdjson(readFileSync(outFile, 'utf8'));
  } catch (err) {
    return blocked(result, `capture output is unreadable: ${err.message}`);
  }

  const baseline = readBaselineNdjson(config, gate.baseline);
  if (baseline === null) {
    return blocked(result, `no frozen baseline at ${gate.baseline} — capture and freeze one before gating against it`);
  }

  const silence = checkSilence(current.length, {
    minObserved: gate.minObserved ?? 1,
    expected: baseline.length,
    shrinkTolerance: gate.shrinkTolerance ?? 0.1,
  });
  if (!silence.ok) return blocked(result, silence.reason);

  const baselineByKey = new Map(baseline.map((r) => [keyOf(r, keyFields), r]));

  let rules;
  try {
    rules = compileRules(gate.classify ?? []);
  } catch (err) {
    return blocked(result, err.message);
  }

  const covered = [];
  const uncovered = [];

  for (const record of current) {
    const key = keyOf(record, keyFields);
    const before = baselineByKey.get(key);

    if (!before) {
      // Principle 4: no baseline for this key means the gate cannot judge it.
      // Say so; never let it masquerade as either a pass or a regression.
      uncovered.push({ what: `${key} has no baseline entry`, where: key });
      continue;
    }

    for (const field of compareFields) {
      const then = valueOf(before, field);
      const now = valueOf(record, field);
      if (then !== now) {
        covered.push({
          what: `${field} changed`,
          where: key,
          field,
          from: then,
          to: now,
          detail: `${then} -> ${now}`,
        });
      }
    }
  }

  for (const [key] of baselineByKey) {
    if (!current.some((r) => keyOf(r, keyFields) === key)) {
      covered.push({ what: `${key} disappeared`, where: key, field: '(missing)', detail: 'present in baseline, absent now' });
    }
  }

  const { stillBlocking, explained } = applyClassification(covered, rules);

  for (const finding of stillBlocking) addBlocking(result, finding);
  for (const finding of explained) addNonBlocking(result, finding);
  for (const finding of uncovered) {
    addNonBlocking(result, { ...finding, reason: 'no baseline coverage for this key' });
  }

  result.stats = {
    observed: current.length,
    baseline: baseline.length,
    blocking: stillBlocking.length,
    explained: explained.length,
    uncovered: uncovered.length,
  };
}
