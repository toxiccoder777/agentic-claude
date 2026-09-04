#!/usr/bin/env node
/**
 * Structural checks on a produced capture, independent of whether it's
 * actually deterministic (that's idempotency-check.mjs's job). This one
 * answers: is the shape even usable as a baseline?
 */
import { existsSync } from 'node:fs';
import { readRecords, keyOf, valueOf, parseFieldList } from './lib/records.mjs';

const NOISE_PATTERNS = [
  { id: 'iso-timestamp', re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, what: 'looks like an ISO timestamp' },
  { id: 'uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, what: 'looks like a UUID' },
  { id: 'unix-epoch-ms', re: /^\d{13}$/, what: 'looks like a millisecond epoch timestamp' },
  { id: 'port-like', re: /:\d{4,5}\b/, what: 'contains a port number, which can vary between environments' },
  { id: 'pid-or-counter', re: /\bpid[=:]\s*\d+/i, what: 'looks like a process id' },
];

function args() {
  const argv = process.argv.slice(2);
  const out = { format: 'ndjson' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--key') out.key = argv[++i];
    else if (a === '--compare') out.compare = argv[++i];
    else if (a === '--format') out.format = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`capture-lint — structural checks on a capture file

  --file <path>       capture file to check (required)
  --key <fields>       comma-separated key fields, e.g. "route" (required)
  --compare <fields>   comma-separated fields the gate will compare (required)
  --format ndjson|json (default: ndjson)

Exit 0: structurally sound. Exit 1: not fit to freeze as a baseline.
Non-determinism warnings are reported but do not fail this check — that's
idempotency-check.mjs's job, which needs to actually run the capture twice.
`);
}

function main() {
  const opts = args();
  if (opts.help || !opts.file || !opts.key || !opts.compare) {
    usage();
    return opts.help ? 0 : 1;
  }

  if (!existsSync(opts.file)) {
    console.error(`BLOCKED: ${opts.file} does not exist — the capture command did not produce it`);
    return 1;
  }

  const keyFields = parseFieldList(opts.key);
  const compareFields = parseFieldList(opts.compare);

  let records;
  try {
    records = readRecords(opts.file, opts.format);
  } catch (err) {
    console.error(`BLOCKED: ${err.message}`);
    return 1;
  }

  if (records.length === 0) {
    console.error('BLOCKED: capture produced zero records — an empty capture is not a baseline, it is a broken run');
    return 1;
  }

  let failed = false;
  const seenKeys = new Map();

  records.forEach((record, index) => {
    const missingKeyFields = keyFields.filter((f) => record[f] === undefined || record[f] === '');
    if (missingKeyFields.length > 0) {
      console.error(`FAIL  record ${index}: missing key field(s) [${missingKeyFields.join(', ')}] — this record cannot be matched across captures`);
      failed = true;
      return;
    }

    const key = keyOf(record, keyFields);
    if (seenKeys.has(key)) {
      console.error(`FAIL  duplicate key "${key}" at records ${seenKeys.get(key)} and ${index} — a gate's key->record map silently keeps only one, hiding the other`);
      failed = true;
    }
    seenKeys.set(key, index);

    const missingCompareFields = compareFields.filter((f) => record[f] === undefined);
    if (missingCompareFields.length > 0) {
      console.error(`FAIL  record ${index} (${key}): missing compare field(s) [${missingCompareFields.join(', ')}]`);
      failed = true;
    }
  });

  let warnings = 0;
  for (const record of records) {
    const key = keyOf(record, keyFields);
    for (const field of compareFields) {
      const value = valueOf(record, field);
      for (const pattern of NOISE_PATTERNS) {
        if (pattern.re.test(value)) {
          console.log(`warn  ${key}.${field} ${pattern.what} (value: ${value.slice(0, 60)}) — confirm this is meant to vary, or it will read as a permanent regression`);
          warnings++;
        }
      }
    }
  }

  console.log(`${failed ? 'FAIL' : 'PASS'} (records=${records.length} unique-keys=${seenKeys.size} warnings=${warnings})`);
  return failed ? 1 : 0;
}

process.exit(main());
