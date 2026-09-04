import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const IGNORED = new Set(['.git', 'node_modules', '.gate-state', '.verification-baseline']);

function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          out += '(?:[^/]+/)*';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if (char === '{') {
      const close = pattern.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
      } else {
        const options = pattern.slice(i + 1, close).split(',');
        out += `(?:${options.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
        i = close;
      }
    } else {
      out += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchAny(path, patterns) {
  const normalized = path.split(sep).join('/');
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function walk(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) found.push(relative(root, full));
    }
  }
  return found;
}

export function selectFiles(root, patterns) {
  if (!patterns || patterns.length === 0) return walk(root);
  return walk(root).filter((path) => matchAny(path, patterns));
}

export function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
