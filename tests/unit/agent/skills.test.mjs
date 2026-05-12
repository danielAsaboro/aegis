import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  discoverSkills,
  makeLoadSkillTool,
  renderSkillsPrompt,
} = await import('../../../engine/agent/skills.mjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(__dirname, '../../..', '.agents', 'skills');

describe('agent skills', () => {
  test('discovers the AEGIS capability skill for wallet-state and status requests', () => {
    const skills = discoverSkills([skillRoot]);
    const capabilitySkill = skills.find(s => s.name === 'aegis-operator-capabilities');

    assert.ok(capabilitySkill);
    assert.match(capabilitySkill.description, /current wallet\/tokens\/balances\/positions\/status\/policies\/strategies/);
    assert.match(capabilitySkill.description, /asking for wallet, chain, token list, or balances/);
  });

  test('discovers the memory orchestration skill for notes, plans, issues, and fuzzy recall', () => {
    const skills = discoverSkills([skillRoot]);
    const memorySkill = skills.find(s => s.name === 'memory-orchestration');

    assert.ok(memorySkill);
    assert.match(memorySkill.description, /notes\/plans\/issues/);
    assert.match(memorySkill.description, /the usual/);
    assert.match(memorySkill.description, /the one that failed/);
  });

  test('renders discoverable skill names into the agent prompt', () => {
    const prompt = renderSkillsPrompt(discoverSkills([skillRoot]));

    assert.match(prompt, /aegis-operator-capabilities/);
    assert.match(prompt, /memory-orchestration/);
    assert.match(prompt, /trading-tool-orchestration/);
    assert.match(prompt, /Call `loadSkill\(\{ name \}\)`/);
  });

  test('loads the capability skill body through the loadSkill tool', async () => {
    const skills = discoverSkills([skillRoot]);
    const loadSkill = makeLoadSkillTool(skills);
    const out = await loadSkill.execute({ name: 'aegis-operator-capabilities' }, {});

    assert.equal(out.success, true);
    assert.match(out.content, /Do not ask the user to manually provide wallet/);
    assert.match(out.content, /getPositions\(\{ limit: 25 \}\)/);
    assert.match(out.content, /DCA_TICK/);
    assert.doesNotMatch(out.content, /^---/);
  });

  test('loads the memory orchestration skill body through the loadSkill tool', async () => {
    const skills = discoverSkills([skillRoot]);
    const loadSkill = makeLoadSkillTool(skills);
    const out = await loadSkill.execute({ name: 'memory-orchestration' }, {});

    assert.equal(out.success, true);
    assert.match(out.content, /Do not remember:/);
    assert.match(out.content, /searchFacts/);
    assert.match(out.content, /Hidden state caused most proof failures/);
    assert.match(out.content, /do not ask the user to type the token list/);
    assert.doesNotMatch(out.content, /^---/);
  });
});
