// Minimal Dockerfile parser for static checks (no Docker daemon needed).

export interface Instruction {
  keyword: string;
  args: string;
}

export interface Stage {
  name: string | null;
  base: string;
  instructions: Instruction[];
}

export interface ParsedDockerfile {
  args: Instruction[];
  stages: Stage[];
}

export function parseDockerfile(text: string): ParsedDockerfile {
  const logical: string[] = [];
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    // Comment lines (also inside a continued instruction) are ignored.
    if (line.startsWith('#') || (current === '' && line === '')) continue;
    if (line.endsWith('\\')) {
      current += `${line.slice(0, -1)} `;
      continue;
    }
    logical.push(`${current}${line}`.trim());
    current = '';
  }
  if (current.trim()) logical.push(current.trim());

  const parsed: ParsedDockerfile = { args: [], stages: [] };
  for (const line of logical) {
    const match = /^(\S+)\s*(.*)$/.exec(line);
    if (!match) continue;
    const instruction = { keyword: match[1].toUpperCase(), args: match[2] };
    if (instruction.keyword === 'FROM') {
      const from = /^(\S+)(?:\s+AS\s+(\S+))?/i.exec(instruction.args);
      parsed.stages.push({
        base: from?.[1] ?? '',
        name: from?.[2] ?? null,
        instructions: [],
      });
    } else if (parsed.stages.length === 0) {
      parsed.args.push(instruction);
    } else {
      parsed.stages[parsed.stages.length - 1].instructions.push(instruction);
    }
  }
  return parsed;
}

/** `COPY [--from=x] [--chown=y] src... dest` → { from, sources, dest }. */
export function parseCopy(args: string): {
  from: string | null;
  sources: string[];
  dest: string;
} {
  const parts = args.split(/\s+/).filter(Boolean);
  let from: string | null = null;
  while (parts[0]?.startsWith('--')) {
    const flag = parts.shift()!;
    if (flag.startsWith('--from=')) from = flag.slice('--from='.length);
  }
  const dest = parts.pop() ?? '';
  return { from, sources: parts, dest };
}
