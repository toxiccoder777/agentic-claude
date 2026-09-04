const LINE = /^(not ok|ok)\b\s*(\d+)?\s*(?:-\s*)?(.*)$/;
const PLAN = /^(\d+)\.\.(\d+)$/;

/**
 * TAP is the one test-output format nearly every runner can emit, which keeps
 * this gate from needing a per-framework adapter zoo. Anything TAP cannot
 * express goes through a project-supplied custom parser instead.
 */
export function parseTap(text) {
  const specs = [];
  let plan = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();

    const planMatch = PLAN.exec(line);
    if (planMatch) {
      plan = Number(planMatch[2]) - Number(planMatch[1]) + 1;
      continue;
    }

    const match = LINE.exec(line);
    if (!match) continue;

    const [, verdict, , rest] = match;
    let name = rest.trim();
    let status = verdict === 'ok' ? 'pass' : 'fail';

    const directive = /#\s*(skip|todo)\b(.*)$/i.exec(name);
    if (directive) {
      name = name.slice(0, directive.index).trim();
      if (directive[1].toLowerCase() === 'skip') status = 'skip';
    }

    if (name) specs.push({ name, status });
  }

  return { specs, plan };
}

export async function parseWith(parserPath, stdout, stderr) {
  const mod = await import(`file://${parserPath}`);
  const parse = mod.parse ?? mod.default;
  if (typeof parse !== 'function') {
    throw new Error(`${parserPath} must export a "parse" function`);
  }
  const specs = await parse(stdout, stderr);
  if (!Array.isArray(specs)) {
    throw new Error(`${parserPath} parse() must return an array of { name, status }`);
  }
  return { specs, plan: null };
}
