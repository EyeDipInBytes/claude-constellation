#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scan } from '../src/scan.js';
import { renderHtml } from '../src/render.js';

const HELP = `
  claude-constellation: your Claude Code context as a star map

  Usage
    npx github:EyeDipInBytes/claude-constellation [options]

  Options
    --out <file>      Where to write the page (default: ./constellation.html)
    --open            Open the page in your browser when done
    --home <dir>      Read <dir>/.claude and <dir>/.claude.json (default: your home)
    --json <file>     Also write the raw graph as JSON
    --redact          Leave out previews, descriptions and settings (names stay)
    --anonymize       Also replace names and paths with numbers (implies --redact)
    --all-projects    Include projects that live in temp folders
    --no-docs         Do not add markdown files that your notes link to
    -h, --help        Show this help

  Privacy
    The page holds text from your notes and skills. It makes no network
    requests. Share it only after --redact or --anonymize.
`;

function parseArgs(argv) {
  const opts = { out: 'constellation.html', docDepth: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null || v.startsWith('--')) fail(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--out':
      case '-o':
        opts.out = next();
        break;
      case '--home':
        opts.home = next();
        break;
      case '--json':
        opts.json = next();
        break;
      case '--open':
        opts.open = true;
        break;
      case '--redact':
        opts.redact = true;
        break;
      case '--anonymize':
      case '--anonymise':
        opts.anonymize = true;
        break;
      case '--all-projects':
        opts.allProjects = true;
        break;
      case '--no-docs':
        opts.docDepth = 0;
        break;
      case '--quiet':
      case '-q':
        opts.quiet = true;
        break;
      default:
        fail(`Unknown option: ${a}\nRun with --help to see the options.`);
    }
  }
  return opts;
}

function fail(msg) {
  process.stderr.write(`claude-constellation: ${msg}\n`);
  process.exit(1);
}

function openFile(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the path is printed anyway */
  }
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const t0 = Date.now();
let graph;
try {
  graph = scan(opts);
} catch (err) {
  if (err.code === 'NO_CLAUDE_DIR') fail(`${err.message}. Use --home to point at another folder.`);
  throw err;
}

const out = path.resolve(opts.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, renderHtml(graph));
if (opts.json) {
  const jsonOut = path.resolve(opts.json);
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify(graph, null, 2));
}

if (!opts.quiet) {
  const c = graph.meta.counts;
  const parts = [
    ['memory', c.memory],
    ['skills', c.skill],
    ['agents', c.agent],
    ['commands', c.command],
    ['hooks', c.hook],
    ['MCP servers', c.mcp],
    ['plugins', c.plugin],
    ['projects', c.project],
  ].filter(([, n]) => n);
  const line = parts.map(([k, n]) => `${n} ${k}`).join(' · ');
  const mode = opts.anonymize ? ' (anonymized)' : opts.redact ? ' (redacted)' : '';
  process.stdout.write(
    `\n  ✦ ${graph.meta.nodes.toLocaleString()} stars, ${graph.meta.links.toLocaleString()} links${mode}\n` +
      (line ? `    ${line}\n` : '') +
      `    → ${path.relative(process.cwd(), out) || out}  (${Date.now() - t0} ms)\n\n`,
  );
}
if (opts.open) openFile(out);
