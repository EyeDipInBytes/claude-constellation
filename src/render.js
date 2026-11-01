import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.join(here, 'viewer');

// Builds one self-contained HTML page. The page makes no network requests:
// a Content-Security-Policy with default-src 'none' enforces that.
export function renderHtml(graph) {
  const template = fs.readFileSync(path.join(viewerDir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(viewerDir, 'viewer.css'), 'utf8');
  const js = fs.readFileSync(path.join(viewerDir, 'viewer.js'), 'utf8');
  const data = safeJson(graph);
  // Function replacers: a "$&" inside the data must stay literal.
  // The data goes in last, so text inside it can never match a placeholder.
  return template
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js.replace(/<\/script/gi, '<\\/script'))
    .replace('__DATA__', () => data);
}

export function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
