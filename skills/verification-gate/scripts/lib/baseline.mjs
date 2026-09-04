import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function baselineFile(config, name) {
  return join(config.baselinePath, name);
}

export function readBaselineJson(config, name) {
  const file = baselineFile(config, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readBaselineNdjson(config, name) {
  const file = baselineFile(config, name);
  if (!existsSync(file)) return null;
  return parseNdjson(readFileSync(file, 'utf8'));
}

export function parseNdjson(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`NDJSON line ${i + 1} is not valid JSON: ${err.message}`);
      }
    });
}

/**
 * Principle 5: the baseline is a thing that can itself be broken — captured
 * against the wrong port, unauthenticated, or weeks stale. A gate that trusts
 * an unvouched-for fixture is measuring nothing.
 */
export function checkFreshness(config) {
  const { validityReport, maxAgeHours, required } = config.freshness;

  const file = baselineFile(config, validityReport);
  if (!existsSync(file)) {
    if (!required) return { ok: true, skipped: true };
    return {
      ok: false,
      reason: `baseline validity report missing (${file}) — capture a baseline and record its validity before gating against it`,
    };
  }

  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `baseline validity report is not valid JSON: ${err.message}` };
  }

  if (report.verdict !== 'VALID') {
    return {
      ok: false,
      reason: `baseline validity verdict is "${report.verdict}"${
        report.reason ? ` (${report.reason})` : ''
      }`,
    };
  }

  if (!report.capturedAt) {
    return { ok: false, reason: 'baseline validity report has no capturedAt timestamp' };
  }

  const capturedAt = Date.parse(report.capturedAt);
  if (Number.isNaN(capturedAt)) {
    return { ok: false, reason: `baseline capturedAt is not a parseable date: ${report.capturedAt}` };
  }

  const ageHours = (Date.now() - capturedAt) / 3_600_000;
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      reason: `baseline is ${ageHours.toFixed(1)}h old, limit is ${maxAgeHours}h — recapture it`,
    };
  }

  return { ok: true, ageHours, report };
}
