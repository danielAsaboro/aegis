/**
 * Agent Skills runtime — implements the `agentskills.io` progressive
 * disclosure pattern for AEGIS.
 *
 * - At startup, scan a small set of skill directories for `SKILL.md`
 *   files, parse the YAML frontmatter, and surface only `name +
 *   description` to the model.
 * - The model decides when to load the full body via the `loadSkill`
 *   tool; the body is read into context only on demand.
 * - The agent already has Read / Bash etc. via existing tools, so a
 *   skill's bundled scripts run through the existing `executeSwap` /
 *   `runPolicies` boundary — there's no second tool surface to gate.
 *
 * Skill discovery directories (first wins on duplicate names):
 *   - <project root>/.agents/skills/     (project-bundled, checked in)
 *   - ~/.config/aegis/skills/            (user-local overrides)
 *
 * The format follows agentskills.io exactly; SKILL.md frontmatter is
 * minimal YAML (we parse `name:` and `description:` ourselves so we
 * don't pull in a heavyweight YAML lib for two fields).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { tool } from 'ai';
import { z } from 'zod';
import { createLogger } from '../core/logger.mjs';

const log = createLogger('agent-skills');

const __dirname = dirname(fileURLToPath(import.meta.url));
// engine/agent/skills.mjs → aegis root
const KRAKEN_ROOT = resolve(__dirname, '..', '..');

const DEFAULT_DIRS = [
  join(KRAKEN_ROOT, '.agents', 'skills'),
  join(homedir(), '.config', 'aegis', 'skills'),
];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  const body = match[1];
  const out = {};
  // Only `name:` and `description:` are required; description may span
  // multiple indented lines (YAML block scalar).
  const lines = body.split(/\r?\n/);
  let pendingKey = null;
  let pendingValue = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      if (pendingKey) out[pendingKey] = pendingValue.trim();
      pendingKey = m[1];
      pendingValue = m[2];
    } else if (pendingKey && /^\s+/.test(raw)) {
      pendingValue += ' ' + raw.trim();
    }
  }
  if (pendingKey) out[pendingKey] = pendingValue.trim();
  return out;
}

export function stripFrontmatter(content) {
  const m = content.match(FRONTMATTER_RE);
  return m ? content.slice(m[0].length).trimStart() : content;
}

/**
 * Scan the configured skill directories. Returns metadata only — bodies
 * are loaded on demand by the loadSkill tool.
 *
 * @returns {Array<{ name: string, description: string, path: string, source: string }>}
 */
export function discoverSkills(dirs = DEFAULT_DIRS) {
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir); }
    catch (err) {
      log.warn({ err: err.message, dir }, 'skill dir read failed');
      continue;
    }
    for (const entry of entries) {
      const skillDir = join(dir, entry);
      let st;
      try { st = statSync(skillDir); }
      catch { continue; }
      if (!st.isDirectory()) continue;
      const skillFile = join(skillDir, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      let content;
      try { content = readFileSync(skillFile, 'utf-8'); }
      catch (err) {
        log.warn({ err: err.message, skillFile }, 'SKILL.md read failed');
        continue;
      }
      const meta = parseFrontmatter(content);
      if (!meta?.name || !meta?.description) {
        log.warn({ skillFile }, 'SKILL.md missing name/description in frontmatter');
        continue;
      }
      if (seen.has(meta.name)) {
        log.debug({ name: meta.name, skillFile }, 'duplicate skill name — first wins');
        continue;
      }
      seen.add(meta.name);
      out.push({
        name: meta.name,
        description: meta.description,
        path: skillDir,
        source: dir,
      });
    }
  }
  return out;
}

/**
 * Render the discovered skills as a system-prompt block. The model sees
 * only names + descriptions until it decides to call `loadSkill`.
 */
export function renderSkillsPrompt(skills) {
  if (!skills?.length) return '';
  const lines = [
    'Skills (specialized playbooks you can pull into context on demand):',
  ];
  for (const s of skills) {
    lines.push(`- ${s.name} — ${s.description}`);
  }
  lines.push('');
  lines.push('Call `loadSkill({ name })` when a user request matches one. The tool returns the full skill body and a path you can use to read bundled files (references/, scripts/) via the existing tools.');
  return lines.join('\n');
}

/**
 * The `loadSkill` tool surfaced to the agent. Closes over a list of
 * known skills so the executor can find the right SKILL.md.
 */
export function makeLoadSkillTool(skills) {
  return tool({
    description: 'Load the full body of an Agent Skill by name. Use this when the user request matches one of the skills listed in the system prompt — it returns the playbook the agent should follow plus the directory path for bundled references/scripts.',
    inputSchema: z.object({
      name: z.string().min(1).describe('Skill identifier (frontmatter `name:` field).'),
    }),
    execute: async ({ name }) => {
      const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (!skill) {
        return {
          success: false,
          error: `Skill "${name}" not found. Available: ${skills.map(s => s.name).join(', ') || '(none)'}`,
        };
      }
      const skillFile = join(skill.path, 'SKILL.md');
      let raw;
      try { raw = readFileSync(skillFile, 'utf-8'); }
      catch (err) {
        return { success: false, error: `Failed to read ${skillFile}: ${err.message}` };
      }
      return {
        success: true,
        name: skill.name,
        skillDirectory: skill.path,
        content: stripFrontmatter(raw),
      };
    },
  });
}

/**
 * `readSkillFile` tool — lets the agent read bundled references/scripts
 * inside a skill directory without granting it general FS access. Path
 * traversal is rejected: requested files must resolve under one of the
 * known skill directories.
 */
export function makeReadSkillFileTool(skills) {
  const allowedRoots = skills.map(s => s.path);
  return tool({
    description: 'Read a file bundled inside an Agent Skill (e.g. references/value-moving-flow.md). Pass the path returned by loadSkill plus the relative file path. Restricted to known skill directories — cannot escape via "..".',
    inputSchema: z.object({
      skillDirectory: z.string().min(1).describe('Absolute path returned by loadSkill.skillDirectory.'),
      relativePath: z.string().min(1).describe('Path relative to skillDirectory (e.g. "references/value-moving-flow.md").'),
    }),
    execute: async ({ skillDirectory, relativePath }) => {
      const root = resolve(skillDirectory);
      if (!allowedRoots.some(r => resolve(r) === root)) {
        return { success: false, error: `skillDirectory ${skillDirectory} is not a known skill root` };
      }
      const target = resolve(root, relativePath);
      if (!target.startsWith(root + '/') && target !== root) {
        return { success: false, error: 'path traversal rejected' };
      }
      if (!existsSync(target)) {
        return { success: false, error: `not found: ${relativePath}` };
      }
      try {
        const body = readFileSync(target, 'utf-8');
        return { success: true, path: target, content: body };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });
}
