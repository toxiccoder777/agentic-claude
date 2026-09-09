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

export function parseConflicted(text, size = 7) {
  const re = markerRegex(size);
  const lines = text.split('\n');

  const context = [];
  const regions = [];

  let state = 'context';
  let current = null;

  for (const line of lines) {
    if (re.start.test(line)) {
      state = 'ours';
      current = { ours: [], base: [], theirs: [] };
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
      state = 'context';
      continue;
    }

    if (state === 'context') context.push(line);
    else if (current) current[state].push(line);
  }

  return { context, regions, unterminated: current !== null };
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
 * A bare `=======` is also a Markdown setext heading underline, so a separator
 * only counts as a leftover conflict marker when it sits between a start and an
 * end marker. Start/end markers are unambiguous on their own.
 */
export function leftoverMarkers(text, size = 7) {
  const all = findMarkers(text, size);
  const hasBracket = all.some((m) => m.kind === 'start') && all.some((m) => m.kind === 'end');
  return all.filter((m) => {
    if (m.kind === 'start' || m.kind === 'end') return true;
    return hasBracket;
  });
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
