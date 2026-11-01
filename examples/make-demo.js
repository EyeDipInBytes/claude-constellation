#!/usr/bin/env node
// Writes a fictional Claude Code home for "Ada", an indie developer, so the
// viewer has something to show without anyone's real data.
//   node examples/make-demo.js [targetDir]   (default: examples/demo-home)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function makeDemo(target = path.join(here, 'demo-home')) {
  fs.rmSync(target, { recursive: true, force: true });
  const C = path.join(target, '.claude');
  const START = Date.UTC(2026, 2, 2); // 2 March 2026
  const DAY = 86400000;
  let clock = 0;
  const write = (rel, text, day) => {
    const file = path.join(target, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const when = new Date(START + (day ?? clock++ * 0.9) * DAY);
    fs.utimesSync(file, when, when);
    return file;
  };
  const md = (fm, body) =>
    `---\n${Object.entries(fm)
      .map(([k, v]) => (typeof v === 'object' ? `${k}:\n${Object.entries(v).map(([a, b]) => `  ${a}: ${b}`).join('\n')}` : `${k}: ${v}`))
      .join('\n')}\n---\n\n${body.trim()}\n`;

  // ---------------------------------------------------------------- global
  write('.claude/CLAUDE.md', `
# Ada's rules for every session

- Answer short. Verdict first.
- Plan before code on anything bigger than one file. Use the \`scout\` agent for reads.
- Write the test first. See /write-tests.
- Before any release run /release-checklist and ask the \`reviewer\` agent for a pass.
- Never force-push to main.
- My working method lives in [WORKFLOW.md](~/docs/WORKFLOW.md).
- Design questions go to the \`designer\` agent and the design-review skill.
`, 0);
  write('docs/WORKFLOW.md', `
# Workflow

1. Idea goes into Linear.
2. The \`scout\` agent maps the code.
3. The \`builder\` agent writes it, test first (/write-tests).
4. The \`reviewer\` agent reads the diff.
5. /changelog, then /ship.

Release notes follow ~/docs/RELEASES.md.
`, 1);
  write('docs/RELEASES.md', `
# Releases

Every release gets a changelog entry (/changelog) and a perf pass (/perf-pass).
`, 2);

  write('.claude/settings.json', JSON.stringify({
    model: 'opus',
    theme: 'dark',
    permissions: { allow: ['Bash(npm test:*)', 'Bash(git status)'], deny: ['Bash(git push --force:*)'] },
    env: { DEMO_REGION: 'eu-west' },
    enabledPlugins: { 'starter-kit@demo-market': true },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '~/.claude/hooks/guard-bash.sh' }] }],
      PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: '~/.claude/hooks/format.sh' }] }],
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/.claude/hooks/brief.sh' }] }],
      Stop: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/notify.sh --sound glass' }] }],
    },
  }, null, 2), 3);
  write('.claude/hooks/guard-bash.sh', '#!/bin/sh\n# Refuse destructive git commands.\ncase "$1" in *"push --force"*) echo "blocked" >&2; exit 2;; esac\n', 3);
  write('.claude/hooks/format.sh', '#!/bin/sh\n# Format the file that was just edited.\nnpx prettier --write "$1" >/dev/null 2>&1 || true\n', 4);
  write('.claude/hooks/brief.sh', '#!/bin/sh\n# Print open tasks at session start.\ncat ~/notes/today.md 2>/dev/null\n', 5);
  write('.claude/hooks/notify.sh', '#!/bin/sh\n# Play a sound when Claude stops.\nafplay /System/Library/Sounds/Glass.aiff\n', 6);

  // ---------------------------------------------------------------- agents
  const agents = {
    scout: ['Read-only code scout. Finds where things live and returns pointers, never file dumps.', 'haiku', 'Use the bug-hunt skill when asked to find faults.'],
    builder: ['Writes code, test first. Follows the write-tests skill.', 'sonnet', 'Hands the diff to the `reviewer` agent when done.'],
    reviewer: ['Reads a diff cold and reports real defects with file:line.', 'opus', 'Checks the release-checklist before saying ship.'],
    tester: ['Runs the test suite and reports failures by name.', 'sonnet', 'Uses /write-tests patterns. Calls the a11y-check skill for UI.'],
    designer: ['Judges layout, type and color against the design tokens.', 'opus', 'Runs the design-review skill and the a11y-check skill.'],
  };
  Object.entries(agents).forEach(([name, [desc, model, body]], i) => {
    write(`.claude/agents/${name}.md`, md({ name, description: desc, model, tools: 'Read, Grep, Glob, Bash' }, `You are the ${name}.\n\n${body}`), 8 + i * 3);
  });

  // ---------------------------------------------------------------- skills
  const skills = {
    'release-checklist': ['Steps before any App Store or web release.', 'Run /changelog. Run /perf-pass. Ask the `reviewer` agent. Then /ship.'],
    'bug-hunt': ['Find real bugs with file:line proof.', 'Send the `scout` agent first. Confirm each bug with a failing test (write-tests).'],
    'write-tests': ['Write the failing test first, then the fix.', 'Prefer small unit tests. The `tester` agent runs them.'],
    'design-review': ['Review a screen against the design tokens.', 'The `designer` agent leads. Finish with a11y-check.'],
    changelog: ['Write the changelog entry for this release.', 'Group by Added, Fixed, Changed. Link issues.'],
    'perf-pass': ['Measure launch time and memory before release.', 'Compare with the last release. Flag a 10% regression.'],
    'a11y-check': ['Check contrast, labels and Dynamic Type.', 'Every button needs a label. Text must scale.'],
    'db-migrate': ['Plan and run a database migration safely.', 'Back up first. The `reviewer` agent reads the migration.'],
    'deploy-preview': ['Ship a preview build for a pull request.', 'Uses the vercel MCP server for web, TestFlight for iOS.'],
    research: ['Read the docs and return a verdict with sources.', 'Cite every claim. Prefer official docs.'],
  };
  Object.entries(skills).forEach(([name, [desc, body]], i) => {
    write(`.claude/skills/${name}/SKILL.md`, md({ name, description: desc }, `# ${name}\n\n${body}`), 12 + i * 4);
  });
  write('.claude/skills/release-checklist/store-notes.md', '# Store notes\n\nKeep the What\'s New text under 170 characters.\n', 14);

  // ---------------------------------------------------------------- commands
  const commands = {
    ship: ['Tag, build and upload the release.', 'Run the release-checklist skill first.'],
    standup: ['Summarize yesterday\'s commits and today\'s plan.', 'Read git log and ~/notes/today.md.'],
    triage: ['Sort new issues into now, next, later.', 'Ask the `scout` agent for the code area of each issue.'],
    retro: ['Write a short retro after a release.', 'What went well, what broke, one change.'],
  };
  Object.entries(commands).forEach(([name, [desc, body]], i) => {
    write(`.claude/commands/${name}.md`, md({ description: desc }, body), 20 + i * 6);
  });

  // ---------------------------------------------------------------- plugin
  const pluginRoot = '.claude/plugins/cache/demo-market/starter-kit/1.0.0';
  write('.claude/plugins/installed_plugins.json', JSON.stringify({
    version: 2,
    plugins: {
      'starter-kit@demo-market': [{ scope: 'user', installPath: `/Users/ada/${pluginRoot}`, version: '1.0.0', installedAt: '2026-04-10T09:00:00.000Z', lastUpdated: '2026-08-01T09:00:00.000Z' }],
    },
  }, null, 2), 39);
  write(`${pluginRoot}/skills/explain-code/SKILL.md`, md({ name: 'explain-code', description: 'Explain a file in plain words.' }, 'Start with what the file is for. Then the main flow.'), 39);
  write(`${pluginRoot}/skills/scaffold/SKILL.md`, md({ name: 'scaffold', description: 'Create a new module with tests.' }, 'Make the folder, the module and a test (write-tests).'), 39);
  write(`${pluginRoot}/agents/mentor.md`, md({ name: 'mentor', description: 'Patient teacher for new code bases.', model: 'sonnet' }, 'Use the explain-code skill.'), 39);
  write(`${pluginRoot}/commands/hello.md`, md({ description: 'Say hello and list the starter kit.' }, 'List skills: explain-code, scaffold.'), 39);

  // ---------------------------------------------------------------- projects
  const projects = {
    orbit: { path: '/Users/ada/code/orbit', sessions: 46, from: 5, to: 230 },
    lumen: { path: '/Users/ada/code/lumen', sessions: 22, from: 60, to: 210 },
    notes: { path: '/Users/ada/notes', sessions: 7, from: 90, to: 200 },
  };
  const slug = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');
  for (const [name, p] of Object.entries(projects)) {
    const dir = `.claude/projects/${slug(p.path)}`;
    for (let i = 0; i < p.sessions; i++) {
      const day = p.from + ((p.to - p.from) * i) / p.sessions;
      const id = `${name}-${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`;
      write(`${dir}/${id}.jsonl`, `{"type":"summary","summary":"${name} session ${i + 1}"}\n`, day);
    }
  }

  write('code/orbit/CLAUDE.md', `
# Orbit: a night-sky app for iPhone

- SwiftUI, iOS 18+. Use the \`builder\` agent for code.
- Every screen passes design-review and a11y-check.
- Release with /ship after the release-checklist.
`, 5);
  write('code/lumen/CLAUDE.md', `
# Lumen: a light-pollution map for the web

- Next.js app on Vercel. Preview builds through deploy-preview.
- Database changes use the db-migrate skill.
- The \`data-wrangler\` agent owns the import scripts.
`, 60);
  write('code/lumen/.mcp.json', JSON.stringify({ mcpServers: { vercel: { type: 'http', url: 'https://mcp.vercel.example/mcp' } } }, null, 2), 60);
  write('code/lumen/.claude/agents/data-wrangler.md', md({ name: 'data-wrangler', description: 'Cleans and imports sky-brightness data.', model: 'sonnet' }, 'Run /seed after each import. Uses the postgres MCP server.'), 64);
  write('code/lumen/.claude/commands/seed.md', md({ description: 'Seed the local database with sample data.' }, 'Use the db-migrate skill first if the schema changed.'), 66);
  write('notes/CLAUDE.md', '# Notes\n\nPlain markdown notes. Use /standup each morning.\n', 90);

  write('.claude.json', JSON.stringify({
    numStartups: 412,
    mcpServers: {
      github: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      linear: { type: 'http', url: 'https://mcp.linear.example/mcp' },
      postgres: { type: 'stdio', command: 'uvx', args: ['postgres-mcp'] },
      sentry: { type: 'http', url: 'https://mcp.sentry.example/mcp' },
    },
    projects: {
      '/Users/ada/code/orbit': { mcpServers: { 'app-store-connect': { type: 'stdio', command: 'node', args: ['asc-mcp.js'] } } },
      '/Users/ada/code/lumen': { mcpServers: {} },
      '/Users/ada/notes': { mcpServers: {} },
    },
  }, null, 2), 0);

  // ---------------------------------------------------------------- memory
  const memories = {
    orbit: [
      ['user', 'user-role', 'Ada builds iOS apps alone; strong in Swift, new to Metal.', 'Ada ships small apps fast. Explain GPU code step by step. See [[user-prefs]].'],
      ['user', 'user-prefs', 'Short answers, verdict first, no filler.', 'Keep replies short. Put depth in a file. Related: [[feedback-short-answers]].'],
      ['feedback', 'feedback-short-answers', 'Ada wants the answer in the first line.', '**Why:** long replies hide the verdict.\n**How to apply:** first line answers. See [[user-prefs]].'],
      ['feedback', 'feedback-tests-first', 'Write the failing test before the fix.', '**Why:** two regressions in v1.3.\n**How to apply:** use /write-tests. See [[project-sync-engine]].'],
      ['feedback', 'feedback-no-force-push', 'Never force-push main.', '**Why:** lost a day of work in May.\n**How to apply:** the guard hook blocks it. See [[reference-ci]].'],
      ['feedback', 'feedback-swiftui-previews', 'Every new view gets a preview with sample data.', 'Previews catch layout bugs early. Related: [[reference-design-tokens]].'],
      ['feedback', 'feedback-ask-before-deps', 'Ask before adding a dependency.', '**Why:** app size budget.\n**How to apply:** propose, then wait. See [[project-orbit-v2]].'],
      ['feedback', 'feedback-commit-style', 'Commit messages: imperative, under 60 characters.', 'Example: "Fix star label overlap". See [[reference-ci]].'],
      ['feedback', 'feedback-screenshots', 'Show a simulator screenshot after UI changes.', 'Proof before "done". Related: [[feedback-swiftui-previews]], [[project-onboarding]].'],
      ['feedback', 'feedback-small-prs', 'Keep pull requests under 300 lines.', 'Small diffs get real review. See [[feedback-tests-first]].'],
      ['project', 'project-orbit-v2', 'Orbit 2.0 adds live sky tracking and widgets.', 'Scope: [[project-widget]], [[project-sync-engine]], [[project-onboarding]]. Ships after [[project-launch-date]].'],
      ['project', 'project-launch-date', 'Orbit 2.0 targets 14 November 2026.', 'Review buffer: one week. See [[project-app-store-review]] and [[project-pricing]].'],
      ['project', 'project-widget', 'Home-screen widget shows the next visible planet.', 'Uses the shared sky model. Depends on [[project-sync-engine]]. Design: [[reference-design-tokens]].'],
      ['project', 'project-sync-engine', 'CloudKit sync for saved sky spots.', 'Conflict rule: last writer wins per field. Tests: [[feedback-tests-first]]. Crashes: [[reference-crash-reports]].'],
      ['project', 'project-app-store-review', 'Notes for App Review: location use explained.', 'Reviewer asked about background location in v1.2. See [[reference-testflight]].'],
      ['project', 'project-pricing', 'Free with a yearly Pro plan.', 'Pro unlocks widgets and AR. Analytics: [[reference-analytics-dashboard]]. Open: [[pricing-experiment]].'],
      ['project', 'project-onboarding', 'Three-screen onboarding, location ask last.', 'Measured drop-off in [[reference-analytics-dashboard]]. Copy review: [[localization-plan]].'],
      ['reference', 'reference-ci', 'CI runs on every push; release builds tag on main.', 'Dashboard: ci.example/orbit. Related: [[feedback-commit-style]].'],
      ['reference', 'reference-analytics-dashboard', 'Funnel and retention dashboard.', 'D1 and D7 per version. Used by [[project-pricing]].'],
      ['reference', 'reference-design-tokens', 'Colors, type scale and spacing tokens.', 'File: Orbit/Design/Tokens.swift. Audit: [[accessibility-audit]].'],
      ['reference', 'reference-crash-reports', 'Crash reports come from the sentry MCP server.', 'Triage weekly with /triage. Related: [[project-sync-engine]].'],
      ['reference', 'reference-api-docs', 'Sky data API docs and rate limits.', '1,000 calls per hour. Used by [[project-widget]].'],
      ['reference', 'reference-testflight', 'TestFlight groups: friends, beta, press.', 'Beta notes live with [[project-app-store-review]].'],
    ],
    lumen: [
      ['user', 'user-web-stack', 'Ada prefers server components and plain CSS.', 'No CSS frameworks. See [[feedback-perf-budget]].'],
      ['feedback', 'feedback-perf-budget', 'Pages load in under 1 second on 4G.', '**Why:** most users are outdoors on mobile.\n**How to apply:** /perf-pass before deploy. See [[project-map-tiles]].'],
      ['feedback', 'feedback-migrations-reviewed', 'Every migration gets a reviewer pass.', 'Use db-migrate. See [[project-schema-v3]].'],
      ['feedback', 'feedback-preview-links', 'Post the preview link on every pull request.', 'From deploy-preview. Related: [[reference-vercel]].'],
      ['project', 'project-map-tiles', 'Light-pollution tiles rendered nightly.', 'Tiles come from [[project-data-import]]. Hosting: [[reference-vercel]].'],
      ['project', 'project-data-import', 'Nightly import of satellite brightness data.', 'Owned by the data-wrangler agent. Schema: [[project-schema-v3]].'],
      ['project', 'project-schema-v3', 'Schema v3 splits readings by month.', 'Migration plan reviewed. See [[feedback-migrations-reviewed]] and [[reference-postgres]].'],
      ['project', 'project-dark-sky-score', 'A 0 to 100 darkness score per map cell.', 'Formula in the notebook. Shown on [[project-map-tiles]]. Open: [[score-validation]].'],
      ['reference', 'reference-vercel', 'Vercel project and preview settings.', 'Region: fra1. Related: [[feedback-preview-links]].'],
      ['reference', 'reference-postgres', 'Database hosts and backup schedule.', 'Backups at 03:00 UTC. Used by [[project-schema-v3]].'],
      ['reference', 'reference-satellite-source', 'Where the brightness data comes from.', 'Monthly composites. Feeds [[project-data-import]].'],
    ],
  };
  for (const [proj, list] of Object.entries(memories)) {
    const base = `.claude/projects/${slug(projects[proj].path)}/memory`;
    const index = ['# Memory', ''];
    list.forEach(([type, name, desc, body], i) => {
      const file = `${type}_${name.replace(/^(user|feedback|project|reference)-/, '').replace(/-/g, '_')}.md`;
      write(`${base}/${file}`, md({ name, description: desc, metadata: { type } }, body), projects[proj].from + 4 + i * 6);
      index.push(`- [${name}](${file}) — ${desc}`);
    });
    write(`${base}/MEMORY.md`, index.join('\n') + '\n', projects[proj].from + 2);
  }
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = makeDemo(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  process.stdout.write(`Demo home written to ${path.relative(process.cwd(), target) || target}\n`);
}
