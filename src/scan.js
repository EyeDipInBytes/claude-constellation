// Scanner: reads a Claude Code home (~/.claude and ~/.claude.json) and returns
// a graph of nodes and links. It never reads env values, MCP args, headers or
// credentials. Text previews pass through the secret scrubber.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatter } from './frontmatter.js';
import { redactSecrets, makeTildify } from './redact.js';

const PREVIEW_CHARS = 1800;
const DESC_CHARS = 320;
const MAX_TEXT_BYTES = 512 * 1024;
const LINK_PRIORITY = { link: 4, uses: 3, mention: 2, contains: 1 };
const WIKI_TYPES = new Set(['memory', 'index', 'instructions', 'doc']);
const SECRETISH_KEY = /token|secret|key|passw|credential|auth|cookie|session/i;

export const NODE_TYPES = [
  'root', 'group', 'instructions', 'settings', 'project', 'index', 'memory',
  'skill', 'agent', 'command', 'hook', 'script', 'mcp', 'plugin', 'doc', 'ghost',
];

export function scan(options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const claudeDir = path.join(home, '.claude');
  const cfgPath = path.join(home, '.claude.json');
  if (!isDir(claudeDir)) {
    const err = new Error(`No Claude Code folder at ${claudeDir}`);
    err.code = 'NO_CLAUDE_DIR';
    throw err;
  }

  const opts = {
    redact: Boolean(options.redact || options.anonymize),
    anonymize: Boolean(options.anonymize),
    allProjects: Boolean(options.allProjects),
    docDepth: options.docDepth ?? 1,
    now: options.now || new Date(),
  };
  const tildify = makeTildify(home);
  const clean = (s) => redactSecrets(tildify(s));
  const g = new GraphBuilder();
  const texts = []; // { id, file, text, scope } for the link pass
  const memoryIndex = new Map(); // scope -> Map(norm -> id)
  const globalMemory = new Map(); // norm -> id
  const lexicon = new Map(); // lowercase name -> id
  const ghostNames = new Map();

  // ---------- helpers ----------
  const remap = (p) => remapPath(p, home);

  function fileNode(file, type, extra = {}) {
    const real = realpath(file);
    const id = `file:${real}`;
    if (g.has(id)) return g.get(id);
    const st = stat(file);
    return g.add({
      id,
      type,
      label: extra.label || path.basename(file),
      path: tildify(file),
      created: st ? isoDate(st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs) : undefined,
      modified: st ? isoDate(st.mtimeMs) : undefined,
      bytes: st ? st.size : undefined,
      ...extra,
    });
  }

  function addText(id, file, raw, scope) {
    texts.push({ id, file, text: raw, scope });
  }

  function readDoc(file) {
    const raw = readText(file);
    if (raw == null) return null;
    const { data, body } = parseFrontmatter(raw);
    return { raw, data, body };
  }

  function preview(body) {
    if (opts.redact || !body) return undefined;
    const trimmed = body.replace(/^\s+/, '');
    const cut = trimmed.length > PREVIEW_CHARS;
    return clean(cut ? trimmed.slice(0, PREVIEW_CHARS) + '\n…' : trimmed);
  }

  function desc(s) {
    if (opts.redact || !s) return undefined;
    const t = String(s).replace(/\s+/g, ' ').trim();
    return clean(t.length > DESC_CHARS ? t.slice(0, DESC_CHARS) + '…' : t);
  }

  function safeMeta(obj) {
    if (opts.redact || !obj) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || v === '') continue;
      if (SECRETISH_KEY.test(k) && !/^(allowed-tools|tools|effort)$/i.test(k)) continue;
      let val = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? null : String(v);
      if (val == null) continue;
      if (val.length > 160) val = val.slice(0, 160) + '…';
      out[k] = clean(val);
    }
    return Object.keys(out).length ? out : undefined;
  }

  function group(key, label) {
    const id = `group:${key}`;
    if (!g.has(id)) {
      g.add({ id, type: 'group', label });
      g.link('root', id, 'contains');
    }
    return id;
  }

  function registerName(name, id) {
    if (!name) return;
    const k = String(name).toLowerCase().trim();
    if (k.length < 2) return;
    if (!lexicon.has(k)) lexicon.set(k, id);
  }

  function registerMemory(scope, names, id) {
    if (!memoryIndex.has(scope)) memoryIndex.set(scope, new Map());
    const m = memoryIndex.get(scope);
    for (const n of names) {
      if (!n) continue;
      const k = norm(n);
      // auto-memory files are named <type>_<slug>.md; links often drop the type
      const bare = k.replace(/^(?:user|feedback|project|reference)-/, '');
      for (const key of new Set([k, bare])) {
        if (!m.has(key)) m.set(key, id);
        if (!globalMemory.has(key)) globalMemory.set(key, id);
      }
    }
  }

  // ---------- root ----------
  g.add({ id: 'root', type: 'root', label: 'Claude Code', path: tildify(claudeDir) });

  // ---------- global instructions ----------
  for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) {
    const f = path.join(claudeDir, name);
    if (!isFile(f)) continue;
    const doc = readDoc(f);
    const n = fileNode(f, 'instructions', {
      label: name,
      sub: 'global',
      desc: desc(firstHeading(doc?.body)),
      preview: preview(doc?.body),
    });
    g.link('root', n.id, 'contains');
    if (doc) addText(n.id, f, doc.raw, 'global');
  }

  // ---------- settings + hooks ----------
  const settingsFiles = ['settings.json', 'settings.local.json'].map((s) => path.join(claudeDir, s)).filter(isFile);
  const enabledPlugins = {};
  for (const f of settingsFiles) {
    const json = readJson(f);
    if (!json) continue;
    const n = fileNode(f, 'settings', { sub: 'global', meta: settingsMeta(json) });
    g.link('root', n.id, 'contains');
    Object.assign(enabledPlugins, json.enabledPlugins || {});
    scanHooks(json.hooks, n.id);
  }

  function settingsMeta(json) {
    if (opts.redact) return undefined;
    const meta = {};
    for (const [k, v] of Object.entries(json)) {
      if (k === 'env') {
        meta.env = `${Object.keys(v || {}).length} variables (values not read)`;
        continue;
      }
      if (SECRETISH_KEY.test(k) || k === 'apiKeyHelper') continue;
      if (['string', 'number', 'boolean'].includes(typeof v)) meta[k] = clean(String(v)).slice(0, 80);
      else if (k === 'permissions' && v && typeof v === 'object') {
        const parts = ['allow', 'ask', 'deny'].filter((x) => Array.isArray(v[x])).map((x) => `${v[x].length} ${x}`);
        if (parts.length) meta.permissions = parts.join(' · ');
      } else if (k === 'hooks' && v) meta.hooks = `${Object.keys(v).length} events`;
      else if (k === 'enabledPlugins' && v) meta.plugins = `${Object.values(v).filter(Boolean).length} enabled`;
    }
    return Object.keys(meta).length ? meta : undefined;
  }

  function scanHooks(hooks, ownerId) {
    if (!hooks || typeof hooks !== 'object') return;
    const hooksGroup = group('hooks', 'Hooks');
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      const hookId = `hook:${event}`;
      if (!g.has(hookId)) {
        g.add({ id: hookId, type: 'hook', label: event });
        g.link(hooksGroup, hookId, 'contains');
      }
      g.link(ownerId, hookId, 'uses');
      for (const grp of groups) {
        for (const h of grp?.hooks || []) {
          const target = hookTarget(h);
          if (!target) continue;
          g.link(hookId, target, 'uses', grp.matcher ? clean(String(grp.matcher)).slice(0, 80) : undefined);
        }
      }
    }
  }

  function hookTarget(h) {
    if (!h || typeof h !== 'object') return null;
    if (h.type && h.type !== 'command') {
      const id = `hookcfg:${h.type}:${hash(JSON.stringify(h))}`;
      if (!g.has(id)) {
        g.add({
          id,
          type: 'script',
          label: `${h.type} hook`,
          desc: desc(h.prompt || h.description || ''),
        });
      }
      return id;
    }
    if (!h.command) return null;
    const command = String(h.command);
    const first = firstToken(command);
    const expanded = remap(expandHome(first, home));
    if (expanded && isFile(expanded)) {
      const doc = readText(expanded, 200 * 1024);
      const n = fileNode(expanded, 'script', {
        desc: desc(command.length > first.length ? command : ''),
        preview: doc && !doc.includes('\u0000') ? preview(doc) : undefined,
      });
      return n.id;
    }
    const id = `cmd:${hash(command)}`;
    if (!g.has(id)) {
      g.add({ id, type: 'script', label: path.basename(first) || 'command', desc: desc(command) });
    }
    return id;
  }

  // ---------- agents, skills, commands (global) ----------
  scanAgents(path.join(claudeDir, 'agents'), 'global', null);
  scanSkills(path.join(claudeDir, 'skills'), 'global', null);
  scanCommands(path.join(claudeDir, 'commands'), 'global', null);

  function scanAgents(dir, scope, ownerId, namespace) {
    for (const f of walk(dir, 2).filter((x) => x.endsWith('.md'))) {
      const doc = readDoc(f);
      if (!doc) continue;
      const name = String(doc.data.name || path.basename(f, '.md'));
      const label = namespace ? `${namespace}:${name}` : name;
      const n = fileNode(f, 'agent', {
        label,
        sub: scope,
        desc: desc(doc.data.description),
        meta: safeMeta(pick(doc.data, ['model', 'effort', 'tools', 'color', 'permissionMode'])),
        preview: preview(doc.body),
      });
      g.link(ownerId || group('agents', 'Agents'), n.id, 'contains');
      registerName(name, n.id);
      registerName(label, n.id);
      addText(n.id, f, doc.raw, scope);
    }
  }

  function scanSkills(dir, scope, ownerId, namespace) {
    for (const entry of listDir(dir)) {
      const skillDir = path.join(dir, entry);
      const f = path.join(skillDir, 'SKILL.md');
      if (!isFile(f)) continue;
      const doc = readDoc(f);
      if (!doc) continue;
      const name = String(doc.data.name || entry);
      const label = namespace ? `${namespace}:${name}` : name;
      const files = walk(skillDir, 3).length;
      const n = fileNode(f, 'skill', {
        label,
        sub: scope,
        desc: desc(doc.data.description),
        meta: safeMeta({
          ...pick(doc.data, ['allowed-tools', 'model', 'argument-hint', 'disable-model-invocation', 'user-invocable', 'version']),
          files: files > 1 ? `${files} files` : undefined,
        }),
        preview: preview(doc.body),
      });
      g.link(ownerId || group('skills', 'Skills'), n.id, 'contains');
      registerName(name, n.id);
      registerName(label, n.id);
      if (entry !== name) registerName(entry, n.id);
      addText(n.id, f, doc.raw, scope);
    }
  }

  function scanCommands(dir, scope, ownerId, namespace) {
    for (const f of walk(dir, 3).filter((x) => x.endsWith('.md'))) {
      const doc = readDoc(f);
      if (!doc) continue;
      const rel = path.relative(dir, f).replace(/\.md$/, '').split(path.sep).join(':');
      const label = namespace ? `${namespace}:${rel}` : rel;
      const n = fileNode(f, 'command', {
        label: `/${label}`,
        sub: scope,
        desc: desc(doc.data.description || firstHeading(doc.body)),
        meta: safeMeta(pick(doc.data, ['allowed-tools', 'argument-hint', 'model'])),
        preview: preview(doc.body),
      });
      g.link(ownerId || group('commands', 'Commands'), n.id, 'contains');
      registerName(rel, n.id);
      registerName(label, n.id);
      addText(n.id, f, doc.raw, scope);
    }
  }

  // ---------- MCP servers ----------
  const cfg = readJson(cfgPath) || {};

  function mcpNode(name, conf, scopeLabel, ownerId) {
    if (!name) return;
    const id = `mcp:${String(name).toLowerCase()}`;
    let n = g.get(id);
    if (!n) {
      n = g.add({ id, type: 'mcp', label: String(name), meta: opts.redact ? undefined : {} });
      g.link(group('mcp', 'MCP servers'), id, 'contains');
      registerName(name, id);
    }
    if (n.meta) {
      const transport = conf?.type || (conf?.url ? 'http' : conf?.command ? 'stdio' : undefined);
      if (transport) n.meta.transport = transport;
      if (conf?.url) {
        try {
          n.meta.host = new URL(conf.url).host;
        } catch {
          /* ignore */
        }
      }
      if (conf?.command && !conf?.url) n.meta.command = path.basename(firstToken(String(conf.command)));
      n.meta.scope = uniqJoin(n.meta.scope, scopeLabel);
    }
    if (ownerId) g.link(ownerId, id, 'uses');
  }

  for (const [name, conf] of Object.entries(cfg.mcpServers || {})) mcpNode(name, conf, 'user', null);
  const globalMcpJson = readJson(path.join(claudeDir, '.mcp.json'));
  for (const [name, conf] of Object.entries(globalMcpJson?.mcpServers || {})) mcpNode(name, conf, 'user', null);

  // ---------- plugins ----------
  const installed = readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json'));
  const pluginEntries = installed?.plugins || {};
  for (const [key, val] of Object.entries(pluginEntries)) {
    const entry = Array.isArray(val) ? val[0] : val;
    const [pname, market] = key.split('@');
    const id = `plugin:${key}`;
    const enabled = enabledPlugins[key];
    g.add({
      id,
      type: 'plugin',
      label: pname,
      sub: market,
      created: entry?.installedAt ? isoDate(Date.parse(entry.installedAt)) : undefined,
      modified: entry?.lastUpdated ? isoDate(Date.parse(entry.lastUpdated)) : undefined,
      meta: safeMeta({ marketplace: market, version: entry?.version, enabled: enabled === undefined ? 'not set' : String(enabled) }),
    });
    g.link(group('plugins', 'Plugins'), id, 'contains');
    registerName(pname, id);
    const dir = entry?.installPath ? remap(entry.installPath) : null;
    if (!dir || !isDir(dir)) continue;
    scanSkills(path.join(dir, 'skills'), 'plugin', id, pname);
    scanAgents(path.join(dir, 'agents'), 'plugin', id, pname);
    scanCommands(path.join(dir, 'commands'), 'plugin', id, pname);
    const hooksJson = readJson(path.join(dir, 'hooks', 'hooks.json'));
    if (hooksJson) scanHooks(hooksJson.hooks || hooksJson, id);
    const pm = readJson(path.join(dir, '.mcp.json'));
    for (const [name, conf] of Object.entries(pm?.mcpServers || pm || {})) {
      if (conf && typeof conf === 'object') mcpNode(name, conf, `plugin ${pname}`, id);
    }
  }
  for (const [key, on] of Object.entries(enabledPlugins)) {
    if (on && g.has(`plugin:${key}`)) {
      for (const s of settingsFiles) g.link(`file:${realpath(s)}`, `plugin:${key}`, 'uses');
    }
  }

  // ---------- projects ----------
  const projectsRoot = path.join(claudeDir, 'projects');
  const cfgProjects = cfg.projects && typeof cfg.projects === 'object' ? cfg.projects : {};
  const slugToPath = new Map();
  for (const p of Object.keys(cfgProjects)) slugToPath.set(slugify(p), p);
  const slugs = new Set(listDir(projectsRoot).filter((s) => isDir(path.join(projectsRoot, s))));
  for (const p of Object.keys(cfgProjects)) slugs.add(slugify(p));

  let sessionTotal = 0;
  for (const slug of [...slugs].sort()) {
    const realPath = slugToPath.get(slug) || null;
    if (!opts.allProjects && isTempPath(realPath || '', slug)) continue;
    const projDir = path.join(projectsRoot, slug);
    const localPath = realPath ? remap(realPath) : null;
    const hasLocal = localPath && isDir(localPath);
    const isHomeProject = hasLocal && realpath(localPath) === realpath(home);

    const sessions = listDir(projDir).filter((f) => f.endsWith('.jsonl'));
    const sessionStats = sessions.map((f) => stat(path.join(projDir, f))).filter(Boolean);
    const memDir = path.join(projDir, 'memory');
    const memFiles = walk(memDir, 2).filter((f) => f.endsWith('.md'));
    const projInstr = hasLocal
      ? ['CLAUDE.md', 'CLAUDE.local.md', ...(isHomeProject ? [] : [path.join('.claude', 'CLAUDE.md')])].map((x) => path.join(localPath, x)).filter(isFile)
      : [];
    // the home folder's .claude is the global config, already scanned above
    const projClaude = hasLocal && !isHomeProject ? path.join(localPath, '.claude') : null;
    const projMcp = hasLocal ? readJson(path.join(localPath, '.mcp.json')) : null;
    const cfgMcp = cfgProjects[realPath]?.mcpServers || {};
    const hasConfig = projClaude && isDir(projClaude) && listDir(projClaude).length > 0;
    if (!sessions.length && !memFiles.length && !projInstr.length && !hasConfig && !projMcp && !Object.keys(cfgMcp).length) continue;

    sessionTotal += sessions.length;
    const label = projectLabel(realPath, slug, home);
    const id = `project:${slug}`;
    const firstSeen = sessionStats.length ? Math.min(...sessionStats.map((s) => (s.birthtimeMs > 0 ? s.birthtimeMs : s.mtimeMs))) : null;
    const lastSeen = sessionStats.length ? Math.max(...sessionStats.map((s) => s.mtimeMs)) : null;
    g.add({
      id,
      type: 'project',
      label,
      path: realPath ? tildify(realPath) : undefined,
      sessions: sessions.length,
      created: firstSeen ? isoDate(firstSeen) : undefined,
      modified: lastSeen ? isoDate(lastSeen) : undefined,
      meta: safeMeta({
        sessions: String(sessions.length),
        'last active': lastSeen ? isoDate(lastSeen) : undefined,
        memories: memFiles.length ? String(memFiles.length) : undefined,
      }),
    });
    g.link(group('projects', 'Projects'), id, 'contains');
    registerName(label, id);
    const scope = id;

    for (const f of projInstr) {
      const doc = readDoc(f);
      const n = fileNode(f, 'instructions', {
        label: path.basename(f),
        sub: label,
        desc: desc(firstHeading(doc?.body)),
        preview: preview(doc?.body),
      });
      g.link(id, n.id, 'contains');
      if (doc) addText(n.id, f, doc.raw, scope);
    }

    // memory
    for (const f of memFiles) {
      const doc = readDoc(f);
      if (!doc) continue;
      const isIndex = path.basename(f) === 'MEMORY.md';
      const stem = path.basename(f, '.md');
      const mtype = doc.data.type || doc.data.metadata?.type;
      const n = fileNode(f, isIndex ? 'index' : 'memory', {
        label: isIndex ? `MEMORY.md` : String(doc.data.name || stem),
        sub: isIndex ? label : mtype ? String(mtype) : undefined,
        project: label,
        desc: desc(doc.data.description),
        preview: preview(doc.body),
      });
      if (isIndex) g.link(id, n.id, 'contains');
      else {
        registerMemory(scope, [doc.data.name, stem, doc.data.metadata?.name], n.id);
        n._needsParent = id;
      }
      addText(n.id, f, doc.raw, scope);
    }

    // project-scoped config
    if (hasConfig) {
      for (const s of ['settings.json', 'settings.local.json']) {
        const f = path.join(projClaude, s);
        const json = isFile(f) ? readJson(f) : null;
        if (!json) continue;
        const n = fileNode(f, 'settings', { sub: label, meta: settingsMeta(json) });
        g.link(id, n.id, 'contains');
        scanHooks(json.hooks, n.id);
      }
      scanAgents(path.join(projClaude, 'agents'), 'project', id);
      scanSkills(path.join(projClaude, 'skills'), 'project', id);
      scanCommands(path.join(projClaude, 'commands'), 'project', id);
    }
    for (const [name, conf] of Object.entries(projMcp?.mcpServers || {})) mcpNode(name, conf, `project ${label}`, id);
    for (const [name, conf] of Object.entries(cfgMcp)) mcpNode(name, conf, `local ${label}`, id);
  }

  // two projects with the same folder name get their parent folder added
  const projectNodes = [...g.nodes.values()].filter((n) => n.type === 'project');
  const seenLabels = new Map();
  for (const n of projectNodes) seenLabels.set(n.label, (seenLabels.get(n.label) || 0) + 1);
  for (const n of projectNodes) {
    if (seenLabels.get(n.label) > 1 && n.path) {
      const parent = path.basename(path.dirname(n.path.replace(/^~/, home)));
      if (parent) n.label = `${n.label} (${parent})`;
    }
  }

  // ---------- link pass ----------
  const docQueue = texts.map((t) => ({ ...t, depth: 0 }));
  const docsSeen = new Set();
  for (let qi = 0; qi < docQueue.length; qi++) {
    const t = docQueue[qi];
    const { id, file, text, scope, depth } = t;
    const body = stripCodeFences(text);

    // [[wikilinks]] (notes only; bash `[[ -f x ]]` tests are not links)
    const wikiTypes = WIKI_TYPES.has(g.get(id)?.type);
    for (const m of wikiTypes ? body.matchAll(/\[\[([^\]|#\n]{1,120})(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g) : []) {
      if (!/^[^\s$!-][^$=<>&|]*$/.test(m[1]) || /\s-[a-z]\s/.test(m[1])) continue;
      const name = m[1].trim();
      const k = norm(name);
      const target = memoryIndex.get(scope)?.get(k) || globalMemory.get(k) || lexicon.get(name.toLowerCase());
      if (target) g.link(id, target, 'link');
      else if (g.get(id)?.type !== 'doc') {
        const gid = `ghost:${k}`;
        if (!g.has(gid)) {
          g.add({ id: gid, type: 'ghost', label: name, desc: opts.redact ? undefined : 'A link to a note that does not exist yet.' });
          ghostNames.set(gid, name);
        }
        g.link(id, gid, 'link');
      }
    }

    // [text](path) markdown links and ~/ or absolute .md mentions
    const refs = [];
    for (const m of body.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) refs.push({ ref: m[1], kind: 'link' });
    for (const m of body.matchAll(/(?<![\w/.])((?:~|\/(?:Users|home)\/[\w.-]+)\/[^\s`'"()<>\]]+?\.md)(?![\w])/g)) refs.push({ ref: m[1], kind: 'mention' });
    for (const { ref, kind } of refs) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('file:')) continue; // http:, mailto:, etc
      let p = ref.replace(/^file:\/\//, '').replace(/#.*$/, '');
      try {
        p = decodeURIComponent(p);
      } catch {
        /* keep raw */
      }
      if (!p) continue;
      let abs;
      if (p.startsWith('~/')) abs = path.join(home, p.slice(2));
      else if (path.isAbsolute(p)) abs = remap(p);
      else abs = path.resolve(path.dirname(file), p);
      if (!abs || !isFile(abs)) continue;
      const tid = `file:${realpath(abs)}`;
      if (g.has(tid)) {
        g.link(id, tid, kind);
        continue;
      }
      if (!/\.(md|markdown|mdx|txt)$/i.test(abs) || depth >= opts.docDepth || docsSeen.has(tid)) continue;
      docsSeen.add(tid);
      const doc = readDoc(abs);
      if (!doc) continue;
      const n = fileNode(abs, 'doc', {
        label: path.basename(abs),
        desc: desc(doc.data.description || firstHeading(doc.body)),
        preview: preview(doc.body),
      });
      g.link(id, n.id, kind);
      docQueue.push({ id: n.id, file: abs, text: doc.raw, scope, depth: depth + 1 });
    }

    // mentions of skills, agents, commands, MCP servers, plugins
    const found = new Set();
    for (const m of body.matchAll(/(?:^|[\s(`'"[])\/([a-z0-9][\w:.-]*[a-z0-9])(?![\w/])/gim)) found.add(m[1].toLowerCase());
    for (const m of body.matchAll(/`([^`\n]{2,64})`/g)) found.add(m[1].trim().replace(/^\//, '').toLowerCase());
    for (const m of body.matchAll(/(?<![\w/.@-])([a-z0-9]+(?:[-:][a-z0-9]+)+)(?![\w-]|\.\w|\/)/gi)) {
      if (m[1].length >= 6) found.add(m[1].toLowerCase());
    }
    for (const word of found) {
      const target = lexicon.get(word);
      if (target && target !== id) g.link(id, target, 'mention');
    }
  }

  // memories nobody links to still belong to their project
  for (const n of g.nodes.values()) {
    if (n._needsParent) {
      if (!g.hasIncoming(n.id)) g.link(n._needsParent, n.id, 'contains');
      delete n._needsParent;
    }
  }

  return g.finish({
    opts,
    meta: {
      tool: 'claude-constellation',
      version: '0.1.0',
      generated: opts.now.toISOString(),
      home: '~',
      claudeDir: tildify(claudeDir),
      sessions: sessionTotal,
      redacted: opts.redact,
      anonymized: opts.anonymize,
    },
  });
}

// ---------- graph builder ----------
class GraphBuilder {
  constructor() {
    this.nodes = new Map();
    this.links = new Map();
    this.incoming = new Set();
  }
  has(id) {
    return this.nodes.has(id);
  }
  get(id) {
    return this.nodes.get(id);
  }
  add(node) {
    if (this.nodes.has(node.id)) return this.nodes.get(node.id);
    for (const k of Object.keys(node)) if (node[k] === undefined) delete node[k];
    this.nodes.set(node.id, node);
    return node;
  }
  hasIncoming(id) {
    return this.incoming.has(id);
  }
  link(source, target, kind, label) {
    if (!source || !target || source === target) return;
    if (!this.nodes.has(source) || !this.nodes.has(target)) return;
    const key = `${source}\u0000${target}`;
    const prev = this.links.get(key);
    if (prev && LINK_PRIORITY[prev.kind] >= LINK_PRIORITY[kind]) {
      if (label && !prev.label) prev.label = label;
      return;
    }
    const l = { source, target, kind };
    if (label) l.label = label;
    this.links.set(key, l);
    if (kind !== 'contains') this.incoming.add(target);
  }
  finish({ opts, meta }) {
    const ids = new Map();
    const nodes = [];
    const counters = {};
    let i = 0;
    for (const n of this.nodes.values()) {
      const short = `n${i++}`;
      ids.set(n.id, short);
      const out = { ...n, id: short };
      if (opts.anonymize && n.type !== 'root' && n.type !== 'group') {
        counters[n.type] = (counters[n.type] || 0) + 1;
        out.label = `${n.type} ${counters[n.type]}`;
        delete out.path;
        delete out.sub;
        delete out.project;
        delete out.bytes;
      }
      if (opts.redact) {
        delete out.preview;
        delete out.desc;
        delete out.meta;
      }
      nodes.push(out);
    }
    const links = [];
    for (const l of this.links.values()) {
      const out = { source: ids.get(l.source), target: ids.get(l.target), kind: l.kind };
      if (l.label && !opts.redact) out.label = l.label;
      links.push(out);
    }
    const counts = {};
    for (const n of nodes) counts[n.type] = (counts[n.type] || 0) + 1;
    return { meta: { ...meta, nodes: nodes.length, links: links.length, counts }, nodes, links };
  }
}

// ---------- fs helpers ----------
function stat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
function isDir(p) {
  return Boolean(p) && Boolean(stat(p)?.isDirectory());
}
function isFile(p) {
  return Boolean(p) && Boolean(stat(p)?.isFile());
}
function realpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
function listDir(p) {
  try {
    return fs.readdirSync(p).filter((f) => !f.startsWith('.')).sort();
  } catch {
    return [];
  }
}
function walk(dir, maxDepth, depth = 0, seen = new Set()) {
  if (!isDir(dir) || depth > maxDepth) return [];
  const real = realpath(dir);
  if (seen.has(real)) return [];
  seen.add(real);
  const out = [];
  for (const f of listDir(dir)) {
    const p = path.join(dir, f);
    if (isDir(p)) out.push(...walk(p, maxDepth, depth + 1, seen));
    else if (isFile(p)) out.push(p);
  }
  return out;
}
function readText(p, max = MAX_TEXT_BYTES) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return null;
    if (st.size <= max) return fs.readFileSync(p, 'utf8');
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(max);
      fs.readSync(fd, buf, 0, max, 0);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
function readJson(p) {
  const t = readText(p, 64 * 1024 * 1024);
  if (t == null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// ---------- string helpers ----------
export function slugify(p) {
  return String(p).replace(/[^a-zA-Z0-9]/g, '-');
}
export function norm(s) {
  return String(s).toLowerCase().trim().replace(/\.md$/, '').replace(/[\s_]+/g, '-');
}
function hash(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}
function isoDate(ms) {
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') out[k] = obj[k];
  return out;
}
function uniqJoin(prev, add) {
  const set = new Set(String(prev || '').split(', ').filter(Boolean));
  if (add) set.add(add);
  return [...set].join(', ');
}
function firstHeading(body) {
  const m = String(body || '').match(/^#{1,3}\s+(.+)$/m);
  return m ? m[1].trim() : undefined;
}
function firstToken(cmd) {
  const s = cmd.trim();
  const q = s.match(/^(["'])(.*?)\1/);
  if (q) return q[2];
  const parts = s.split(/\s+/);
  // skip leading env assignments and interpreters: FOO=1 bash script.sh
  let i = 0;
  while (i < parts.length && /^[A-Z_][A-Z0-9_]*=/.test(parts[i])) i++;
  if (/^(bash|sh|zsh|node|python3?|bun|deno|npx|uv|uvx)$/.test(path.basename(parts[i] || '')) && parts[i + 1] && !parts[i + 1].startsWith('-')) {
    return parts[i + 1];
  }
  return parts[i] || s;
}
function expandHome(p, home) {
  if (!p) return p;
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p.replace(/^\$HOME(?=\/)/, home).replace(/^\$\{HOME\}(?=\/)/, home);
}
// A path from another machine (/Users/ada/...) maps into --home when it does not exist here.
export function remapPath(p, home) {
  if (!p) return p;
  if (fs.existsSync(p)) return p;
  const m = String(p).match(/^\/(?:Users|home)\/[^/]+\/(.*)$/);
  if (m) {
    const alt = path.join(home, m[1]);
    if (fs.existsSync(alt)) return alt;
  }
  return p;
}
function isTempPath(p, slug) {
  return /^\/(?:private\/)?(?:tmp|var\/folders)(?:\/|$)/.test(p) || /^-(?:private-)?(?:tmp|var-folders)(?:-|$)/.test(slug);
}
function projectLabel(realPath, slug, home) {
  if (realPath) {
    const base = path.basename(realPath);
    if (realPath === home || /^\/(?:Users|home)\/[^/]+\/?$/.test(realPath)) return '~ (home)';
    return base || realPath;
  }
  return slug.replace(/^-(?:Users|home)-[^-]+-/, '').replace(/^-/, '') || slug;
}
function stripCodeFences(text) {
  // keep links inside prose; fenced code often holds examples, not real links
  return String(text).replace(/```[\s\S]*?```/g, ' ');
}
