// Minimal YAML-frontmatter reader. Covers what Claude Code files use:
// scalars, quoted strings, nested maps, block lists, inline lists, | and > blocks.

export function parseFrontmatter(input) {
  const text = String(input).replace(/\r\n/g, '\n').replace(/^﻿/, '');
  if (!text.startsWith('---\n')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(4, end);
  let body = text.slice(end + 4);
  body = body.replace(/^[^\n]*\n?/, '');
  let data = {};
  try {
    data = parseYamlSubset(raw);
  } catch {
    data = {};
  }
  return { data, body };
}

export function parseYamlSubset(raw) {
  const root = {};
  const lines = raw.split('\n');
  const stack = [{ indent: -1, obj: root }];
  let pending = null; // { parent, key, indent } for a key with an empty value

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (trimmed.startsWith('- ') || trimmed === '-') {
      if (pending) {
        const cur = pending.parent[pending.key];
        if (!Array.isArray(cur)) pending.parent[pending.key] = [];
        pending.parent[pending.key].push(scalar(trimmed.slice(1).trim()));
      }
      continue;
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const m = trimmed.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/);
    if (!m) continue;
    const key = m[1].replace(/^["']|["']$/g, '').trim();
    const val = (m[2] ?? '').trim();

    if (val === '') {
      parent[key] = {};
      pending = { parent, key, indent };
      stack.push({ indent, obj: parent[key] });
      continue;
    }
    pending = null;

    if (/^[|>][+-]?$/.test(val)) {
      const folded = val.startsWith('>');
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '') { block.push(''); continue; }
        const ind = l.length - l.trimStart().length;
        if (ind <= indent) break;
        block.push(l.trim());
      }
      i = j - 1;
      while (block.length && block[block.length - 1] === '') block.pop();
      parent[key] = folded ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n');
      continue;
    }
    parent[key] = scalar(val);
  }
  return root;
}

function scalar(v) {
  if (v === '') return '';
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => scalar(s.trim()));
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  return v;
}
