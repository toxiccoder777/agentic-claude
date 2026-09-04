/**
 * Principle 4: coverage-aware partitioning.
 *
 * A gate that hard-fails on ground it has no baseline for gets switched off in
 * week two, and then it is protecting nothing. Split findings into "the
 * baseline covers this, so a difference is a regression" and "no baseline data
 * here, so report it and say so honestly" — and never quietly merge the two.
 */
export function partitionByCoverage(findings, isCovered) {
  const blocking = [];
  const nonBlocking = [];
  for (const finding of findings) {
    if (isCovered(finding)) {
      blocking.push(finding);
    } else {
      nonBlocking.push({ ...finding, reason: 'no baseline coverage for this key' });
    }
  }
  return { blocking, nonBlocking };
}

/**
 * Root-cause classification: a finding whose cause has been confirmed and
 * recorded stops blocking. The rule must carry a reason, so the reader can see
 * why something was excused rather than finding a silent allowlist.
 */
export function compileRules(rules = []) {
  return rules.map((rule, i) => {
    if (!rule.reason) {
      throw new Error(`classification rule ${rule.id ?? i} has no "reason" — unexplained exclusions are not allowed`);
    }
    const matchers = Object.entries(rule.when ?? {}).map(([field, pattern]) => [
      field,
      new RegExp(pattern),
    ]);
    if (matchers.length === 0) {
      throw new Error(`classification rule ${rule.id ?? i} has an empty "when" — it would excuse every finding`);
    }
    return { id: rule.id ?? `rule-${i}`, reason: rule.reason, matchers };
  });
}

export function classify(finding, compiledRules) {
  for (const rule of compiledRules) {
    const hit = rule.matchers.every(([field, re]) => {
      const value = finding[field];
      return typeof value === 'string' && re.test(value);
    });
    if (hit) return rule;
  }
  return null;
}

export function applyClassification(blocking, compiledRules) {
  const stillBlocking = [];
  const explained = [];
  for (const finding of blocking) {
    const rule = classify(finding, compiledRules);
    if (rule) {
      explained.push({ ...finding, reason: `${rule.reason} (${rule.id})` });
    } else {
      stillBlocking.push(finding);
    }
  }
  return { stillBlocking, explained };
}
