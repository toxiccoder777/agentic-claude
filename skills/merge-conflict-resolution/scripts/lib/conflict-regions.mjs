/**
 * Parses git's own conflicted output into the two things that matter for
 * enforcement:
 *
 *   context — lines git merged by itself, outside every conflict region. The
 *             resolution has no business changing these.
 *   regions — the ours/theirs alternatives git could not decide between.
 */
export function markerRegex(size) {
  // git's rule: a run of EXACTLY `size` marker characters, then whitespace or
  // end of line. Eight equals signs is not a marker; seven is.
  const n = `{${size}}`;
  return {
    start: new RegExp(`^<${n}(?![<])(\\s|$)`),
    base: new RegExp(`^\\|${n}(?![|])(\\s|$)`),
    sep: new RegExp(`^=${n}(?![=])(\\s|$)`),
    end: new RegExp(`^>${n}(?![>])(\\s|$)`),
  };
}

/**
 * Returns `context`, `regions`, and `unterminated`.
 *
 * `unterminated` is load-bearing: a file whose last region never closes means
 * every line after it was never classified, so scope cannot be judged. Callers
 * must treat it as BLOCKED rather than ignoring it — silently dropping the tail
 * is how a deleted line in that tail becomes invisible.
 */
export function parseConflicted(text, size = 7) {
  const re = markerRegex(size);
  const lines = text.split('\n');

  const context = [];
  const regions = [];

  let state = 'context';
  let current = null;
  let currentRaw = [];
  let unterminated = false;

  const abandon = () => {
    // A nested or repeated start marker means the previous region never closed.
    // Its lines are unclassified, so they go back to context rather than being
    // dropped on the floor, and the file is flagged unjudgeable.
    unterminated = true;
    context.push(...currentRaw);
    current = null;
    currentRaw = [];
  };

  for (const line of lines) {
    if (re.start.test(line)) {
      if (current) abandon();
      state = 'ours';
      current = { ours: [], base: [], theirs: [] };
      currentRaw = [];
      continue;
    }
    if (current && re.base.test(line)) {
      state = 'base';
      continue;
    }
    if (current && re.sep.test(line)) {
      state = 'theirs';
      continue;
    }
    if (current && re.end.test(line)) {
      regions.push(current);
      current = null;
      currentRaw = [];
      state = 'context';
      continue;
    }

    if (state === 'context') {
      context.push(line);
    } else if (current) {
      current[state].push(line);
      currentRaw.push(line);
    }
  }

  if (current) abandon();

  return { context, regions, unterminated };
}

/** Every marker-looking line in a file, using git's exactly-N rule. */
export function findMarkers(text, size = 7) {
  const re = markerRegex(size);
  const found = [];
  text.split('\n').forEach((line, i) => {
    let kind = null;
    if (re.start.test(line)) kind = 'start';
    else if (re.base.test(line)) kind = 'base';
    else if (re.sep.test(line)) kind = 'separator';
    else if (re.end.test(line)) kind = 'end';
    if (kind) found.push({ line: i + 1, kind, text: line });
  });
  return found;
}

/**
 * A bare `=======` is also a Markdown setext heading underline, so on an
 * arbitrary file a lone separator is ambiguous. It is reported with
 * `suspect: true` rather than dropped — an unexplained maybe-marker is still
 * worth a human glance, and silently discarding it is how a real leftover
 * separator sails through.
 *
 * On a file known to have been conflicted there is no ambiguity to extend
 * credit to: pass `strict` and every marker blocks.
 */
export function leftoverMarkers(text, size = 7, { strict = false } = {}) {
  const all = findMarkers(text, size);
  if (strict) return all.map((m) => ({ ...m, suspect: false }));

  const bracketed = all.some((m) => m.kind === 'start') && all.some((m) => m.kind === 'end');
  return all.map((m) => ({
    ...m,
    suspect: (m.kind === 'separator' || m.kind === 'base') && !bracketed,
  }));
}

/** Is `needle` an in-order subsequence of `haystack`? Returns the first miss. */
export function firstMissingInOrder(needle, haystack) {
  let h = 0;
  for (let n = 0; n < needle.length; n++) {
    let found = false;
    while (h < haystack.length) {
      if (haystack[h] === needle[n]) {
        h++;
        found = true;
        break;
      }
      h++;
    }
    if (!found) return { index: n, line: needle[n] };
  }
  return null;
}

/**
 * Subsequence matching alone has a known hole: the greedy cursor can satisfy a
 * context line with a line the resolver wrote *inside* a hunk, so deleting the
 * first context line after a region is invisible whenever the hunk body happens
 * to contain the same string. `}`, `)` and blank lines are both the commonest
 * lines in code and the commonest thing at a region boundary, so this is not
 * exotic.
 *
 * Counting closes most of it: a context line must appear at least as often in
 * the resolution as it did in the context. It is not airtight — a hunk body that
 * contributes extra copies can still mask a deletion — and
 * `references/why-markers-are-not-enough.md` says so rather than pretending
 * otherwise.
 */
export function missingByCount(context, resolvedLines) {
  const need = new Map();
  for (const line of context) {
    if (line.trim() === '') continue;
    need.set(line, (need.get(line) ?? 0) + 1);
  }

  const have = new Map();
  for (const line of resolvedLines) {
    have.set(line, (have.get(line) ?? 0) + 1);
  }

  for (const [line, count] of need) {
    if ((have.get(line) ?? 0) < count) {
      return { line, expected: count, found: have.get(line) ?? 0 };
    }
  }
  return null;
}
