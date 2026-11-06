import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDemo } from '../examples/make-demo.js';
import { scan } from '../src/scan.js';
import { renderHtml, safeJson } from '../src/render.js';
import { redactSecrets } from '../src/redact.js';
import { parseFrontmatter } from '../src/frontmatter.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'constellation-'));
const home = makeDemo(path.join(tmp, 'home'));

// Secrets that must never reach the page. Built at run time so no
// credential-shaped string sits in the repo.
const FAKE = {
  env: 'sk-' + 'demo'.repeat(6) + 'A1b2C3d4',
  mcp: 'ghp_' + 'Z9'.repeat(14),
  header: 'Bearer ' + 'abc123XYZ'.repeat(3),
  inNote: 'xoxb-' + '1234567890-abcdefghij',
};
const settingsFile = path.join(home, '.claude', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
settings.env.DEMO_API_KEY = FAKE.env;
settings.apiKeyHelper = '/bin/echo ' + FAKE.env;
fs.writeFileSync(settingsFile, JSON.stringify(settings));
const cfgFile = path.join(home, '.claude.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
cfg.mcpServers.github.env = { GITHUB_TOKEN: FAKE.mcp };
cfg.mcpServers.linear.headers = { Authorization: FAKE.header };
cfg.oauthAccount = { emailAddress: 'ada@example.com', accessToken: FAKE.mcp };
fs.writeFileSync(cfgFile, JSON.stringify(cfg));
const leakyNote = path.join(home, '.claude', 'projects', '-Users-ada-code-orbit', 'memory', 'reference_slack.md');
fs.writeFileSync(leakyNote, `---\nname: reference-slack\ndescription: Slack bot\nmetadata:\n  type: reference\n---\n\nBot token: ${FAKE.inNote}\nSee [[reference-ci]].\n<\/script><script>alert(1)<\/script>\n`);

const graph = scan({ home, now: new Date('2026-11-01T12:00:00Z') });
const byLabel = (label, type) => graph.nodes.find((n) => n.label === label && (!type || n.type === type));
const linked = (a, b, kind) => graph.links.some((l) => l.source === a.id && l.target === b.id && (!kind || l.kind === kind));

test('finds every kind of node', () => {
  const c = graph.meta.counts;
  assert.equal(c.root, 1);
  assert.ok(c.memory >= 30, `memory ${c.memory}`);
  assert.equal(c.index, 2);
  assert.ok(c.skill >= 12, `skills ${c.skill}`);
  assert.ok(c.agent >= 7, `agents ${c.agent}`);
  assert.ok(c.command >= 6, `commands ${c.command}`);
  assert.equal(c.hook, 4);
  assert.equal(c.script, 4);
  assert.ok(c.mcp >= 6, `mcp ${c.mcp}`);
  assert.equal(c.plugin, 1);
  assert.equal(c.project, 3);
  assert.ok(c.instructions >= 4);
  assert.ok(c.doc >= 1);
});

test('resolves [[wikilinks]] between memory notes', () => {
  const a = byLabel('project-orbit-v2', 'memory');
  const b = byLabel('project-widget', 'memory');
  assert.ok(a && b);
  assert.ok(linked(a, b, 'link'));
});

test('turns unresolved [[links]] into unwritten-link nodes', () => {
  const ghost = byLabel('localization-plan', 'ghost');
  assert.ok(ghost, 'ghost node exists');
  assert.ok(graph.links.some((l) => l.target === ghost.id));
});

test('MEMORY.md index links to its notes', () => {
  const index = graph.nodes.find((n) => n.type === 'index' && n.sub === 'orbit');
  const note = byLabel('feedback-tests-first', 'memory');
  assert.ok(linked(index, note, 'link'));
});

test('finds mentions of agents, skills and commands', () => {
  const claudeMd = graph.nodes.find((n) => n.type === 'instructions' && n.sub === 'global');
  assert.ok(linked(claudeMd, byLabel('scout', 'agent'), 'mention'));
  assert.ok(linked(claudeMd, byLabel('release-checklist', 'skill'), 'mention'));
  assert.ok(linked(byLabel('release-checklist', 'skill'), byLabel('/ship', 'command'), 'mention'));
});

test('follows links to markdown files outside ~/.claude', () => {
  const doc = byLabel('WORKFLOW.md', 'doc');
  assert.ok(doc);
  assert.equal(doc.path, '~/docs/WORKFLOW.md');
});

test('maps hooks to their scripts', () => {
  const hook = byLabel('PreToolUse', 'hook');
  const script = byLabel('guard-bash.sh', 'script');
  assert.ok(linked(hook, script, 'uses'));
  assert.equal(graph.links.find((l) => l.source === hook.id && l.target === script.id).label, 'Bash');
});

test('reads plugins and their parts', () => {
  const plugin = byLabel('starter-kit', 'plugin');
  assert.ok(linked(plugin, byLabel('starter-kit:explain-code', 'skill'), 'contains'));
  assert.ok(linked(plugin, byLabel('starter-kit:mentor', 'agent'), 'contains'));
});

test('reads project-level config and MCP servers', () => {
  const lumen = byLabel('lumen', 'project');
  assert.ok(linked(lumen, byLabel('data-wrangler', 'agent'), 'contains'));
  assert.ok(linked(lumen, byLabel('vercel', 'mcp'), 'uses'));
  const orbit = byLabel('orbit', 'project');
  assert.equal(orbit.sessions, 46);
  assert.ok(linked(orbit, byLabel('app-store-connect', 'mcp'), 'uses'));
});

test('never carries secrets, env values or the real home path', () => {
  const json = JSON.stringify(graph);
  for (const s of Object.values(FAKE)) assert.ok(!json.includes(s), `leaked ${s.slice(0, 8)}…`);
  assert.ok(!json.includes('eu-west'), 'env value leaked');
  assert.ok(!json.includes('ada@example.com'), 'account email leaked');
  assert.ok(!json.includes(home), 'absolute home path leaked');
  assert.ok(!json.includes('server-github'), 'MCP args leaked');
  const s = byLabel('settings.json', 'settings');
  assert.match(s.meta.env, /values not read/);
});

test('--redact drops text, --anonymize drops names', () => {
  const r = scan({ home, redact: true });
  assert.ok(r.nodes.every((n) => !n.preview && !n.desc && !n.meta));
  const a = scan({ home, anonymize: true });
  assert.ok(!a.nodes.some((n) => n.label === 'project-orbit-v2'));
  assert.ok(a.nodes.every((n) => !n.path || n.type === 'root'));
});

test('the page cannot be broken out of by file text', () => {
  const html = renderHtml(graph);
  const dataStart = html.indexOf('id="graph-data">');
  const dataEnd = html.indexOf('</script>', dataStart);
  const blob = html.slice(dataStart + 16, dataEnd);
  assert.ok(!blob.includes('<'), 'raw < inside the data block');
  assert.doesNotThrow(() => JSON.parse(blob));
  assert.ok(html.includes("default-src 'none'"), 'CSP present');
  assert.equal(safeJson({ a: '$&</script>' }), '{"a":"$\\u0026\\u003c/script\\u003e"}');
});

test('redactSecrets keeps prose and kills tokens', () => {
  assert.equal(redactSecrets('the token: required for all calls'), 'the token: required for all calls');
  assert.match(redactSecrets('API_KEY=' + 'q8Z3x' + 'Lm29PvTr55'), /API_KEY=‹redacted›/);
  assert.equal(redactSecrets('see feedback-claude-usage-short-codex-writes-again'), 'see feedback-claude-usage-short-codex-writes-again');
  assert.match(redactSecrets('Authorization: Bearer ' + 'x'.repeat(10) + '12345abc'), /Bearer ‹redacted›/);
});

test('redactSecrets kills passwords, any-case auth, query keys and CLI credentials', () => {
  const v = 'Abc123' + 'Abc123' + 'Abc123';
  const leaks = [
    'password=' + 'correcthorse' + 'batterystaple',
    'password=' + 'aB3!',
    'password="' + 'test pass phrase 123!' + '"',
    '"db_password": "' + 'hunter2' + '"',
    'Authorization: bearer ' + v,
    'authorization: token ' + v,
    'https://example.invalid/?key=' + v,
    'https://example.invalid/cb?state=x&access_token=' + v + '&a=1',
    'curl --oauth2-bearer ' + v + ' https://example.invalid',
    'tool --api-key=' + v,
    'curl -u ada:' + 'hunter2' + ' https://example.invalid',
  ];
  for (const s of leaks) {
    const out = redactSecrets(s);
    assert.ok(!out.includes(v) && !out.includes('hunter2') && !out.includes('batterystaple') && !out.includes('aB3!') && !out.includes('pass phrase'), `leaked: ${s} -> ${out}`);
    assert.match(out, /‹redacted›/);
  }
  // References and prose stay readable
  assert.equal(redactSecrets('password: ${DB_PASSWORD}'), 'password: ${DB_PASSWORD}');
  assert.equal(redactSecrets('token based auth and basic understanding'), 'token based auth and basic understanding');
  assert.equal(redactSecrets('see https://example.invalid/docs?page=2'), 'see https://example.invalid/docs?page=2');
});

test('a private key cut by the preview limit leaves no key line in the page', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyLines = privateKey.split('\n').filter((l) => l.length > 40);
  const cutOut = redactSecrets(privateKey.slice(0, 1800) + '\n…');
  assert.equal(cutOut.split('\n').filter((l) => keyLines.includes(l)).length, 0);
  const agent = path.join(home, '.claude', 'agents', 'keyholder.md');
  fs.writeFileSync(agent, `---\nname: keyholder\ndescription: holds a key\n---\n\n${privateKey}\n`);
  try {
    const page = JSON.stringify(scan({ home }));
    for (const l of keyLines) assert.ok(!page.includes(l), 'a key line reached the graph');
  } finally {
    fs.rmSync(agent);
  }
});

test('frontmatter parser handles nested maps, lists and blocks', () => {
  const { data, body } = parseFrontmatter('---\nname: a\ndescription: >\n  one\n  two\nmetadata:\n  type: user\ntools:\n  - Read\n  - Bash\nlist: [x, "y"]\n---\nBody');
  assert.equal(data.name, 'a');
  assert.equal(data.description, 'one two');
  assert.equal(data.metadata.type, 'user');
  assert.deepEqual(data.tools, ['Read', 'Bash']);
  assert.deepEqual(data.list, ['x', 'y']);
  assert.equal(body, 'Body');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
