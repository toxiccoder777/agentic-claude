#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, gateConfig } from '../lib/config.mjs';
import { selectFiles, matchAny, isFile } from '../lib/files.mjs';
import { runGate, addBlocking, addNonBlocking, blocked } from '../lib/result.mjs';

const SECRET_PATTERNS = [
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/, what: 'AWS access key id' },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, what: 'private key block' },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, what: 'JWT literal' },
  { id: 'slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/, what: 'Slack token' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, what: 'GitHub token' },
  {
    id: 'assigned-secret',
    re: /\b(?:api[_-]?key|secret|passwd|password|token|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    what: 'hardcoded credential assignment',
  },
  { id: 'connection-string', re: /\b[a-z+]{2,12}:\/\/[^\s:@/]+:[^\s:@/]+@/i, what: 'connection string with inline credentials' },
];

const DEBUG_PATTERNS = [
  { id: 'debugger', re: /^\s*debugger\s*;?\s*$/m, what: 'debugger statement' },
  { id: 'console-log', re: /\bconsole\.(?:log|debug|dir)\s*\(/, what: 'stray console statement' },
];

const ALLOW_MARKER = /verification-gate:allow-secret/;

function args() {
  const argv = process.argv.slice(2);
  const out = { project: process.cwd(), id: 'secrets' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--id') out.id = argv[++i];
  }
  return out;
}

function changedFiles(projectRoot, baseRef) {
  const run = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', baseRef], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (run.status !== 0) return null;
  return run.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

const { project, id } = args();
const config = loadConfig(project);
const gate = gateConfig(config, id);

await runGate(id, config.statePath, async (result) => {
  let files;
  if (gate.scope === 'changed') {
    files = changedFiles(config.projectRoot, gate.baseRef ?? 'HEAD');
    if (files === null) {
      return blocked(result, `could not read changed files from git (baseRef "${gate.baseRef ?? 'HEAD'}") — scope "changed" needs a working git history`);
    }
    if (gate.include) files = files.filter((f) => matchAny(f, gate.include));
    files = files.filter((f) => isFile(join(config.projectRoot, f)));
  } else {
    files = selectFiles(config.projectRoot, gate.include);
  }

  const patterns = [
    ...SECRET_PATTERNS,
    ...(gate.patterns ?? []).map((p) => ({ id: p.id, re: new RegExp(p.pattern), what: p.what ?? p.id })),
  ];
  const allowlist = gate.allowlist ?? [];

  let scanned = 0;

  for (const relPath of files) {
    let text;
    try {
      text = readFileSync(join(config.projectRoot, relPath), 'utf8');
    } catch {
      continue;
    }
    scanned++;

    const lines = text.split('\n');
    const checkDebug = gate.debugGlobs ? matchAny(relPath, gate.debugGlobs) : false;
    const active = checkDebug ? [...patterns, ...DEBUG_PATTERNS] : patterns;

    lines.forEach((line, index) => {
      if (ALLOW_MARKER.test(line)) return;
      for (const pattern of active) {
        if (!pattern.re.test(line)) continue;
        const finding = { what: pattern.what, where: `${relPath}:${index + 1}`, rule: pattern.id };
        if (allowlist.includes(pattern.id)) {
          addNonBlocking(result, { ...finding, reason: 'rule is allowlisted in config' });
        } else {
          addBlocking(result, finding);
        }
      }
    });
  }

  // Scanning nothing and reporting clean is the same silence failure the unit
  // gate guards against, one layer up.
  if (scanned === 0) {
    return blocked(result, 'matched zero files to scan — check the "include" globs, an empty scan is not a clean scan');
  }

  result.stats = { scanned, findings: result.blocking.length + result.nonBlocking.length };
});
