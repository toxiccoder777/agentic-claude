/**
 * Principle 3: silence is not success.
 *
 * A test runner that crashed on startup, a browser that never launched, an
 * empty results file — all of them satisfy "no failures found". It is the most
 * dangerous false pass there is, because it looks exactly like a clean run.
 * Every gate that counts things must declare how many it expected to see.
 */
export function checkSilence(observed, { minObserved = 1, expected = null, shrinkTolerance = 0.1 } = {}) {
  if (!Number.isFinite(observed)) {
    return { ok: false, reason: 'could not determine how many results were produced' };
  }

  if (observed === 0) {
    return {
      ok: false,
      reason: 'run produced zero results — the runner almost certainly failed to start, and "no failures" from an empty run is not a pass',
    };
  }

  if (observed < minObserved) {
    return {
      ok: false,
      reason: `run produced ${observed} results, fewer than the configured minimum of ${minObserved}`,
    };
  }

  if (expected !== null && expected > 0) {
    const floor = Math.floor(expected * (1 - shrinkTolerance));
    if (observed < floor) {
      return {
        ok: false,
        reason: `run produced ${observed} results but the baseline holds ${expected} (floor ${floor}) — results collapsed, treat as a broken run rather than a smaller suite`,
      };
    }
  }

  return { ok: true };
}
