#!/usr/bin/env node
/**
 * Tri-track showcase — single user prompt, three sponsors hit.
 *
 *   user prompt  →  QVAC local LLM (Qwen 2.5 7B via Bare sidecar)
 *                →  parses tool calls
 *                →  Zerion getSwapQuote (real api.zerion.io call)
 *                →  MagicBlock depositToShield (real on-chain signature)
 *                →  signatures printed
 *
 * No mocks. The LLM choice (local QVAC), the swap quote (Zerion API), and
 * the deposit (MagicBlock SDK) are the three sponsor surfaces of the
 * Frontier hackathon. This script proves a single user message exercises
 * all three at once.
 *
 * Usage:
 *   QVAC_LLM_MODEL_PATH=~/.cache/aegis/qvac/qwen2.5-7b-instruct-q3_k_m.gguf \
 *   SOLANA_PRIVATE_KEY=$(cat keys/demo2.json) \
 *   DATA_DIR=$(pwd)/.data \
 *   node --env-file=.env scripts/showcase-tri-track.mjs
 */

import { runAgentTurn, setActiveModel, clearHistory, appendHistory } from '../engine/agent/index.mjs';
import { initDb } from '../engine/db/index.mjs';
import { shutdownSidecar } from '../engine/qvac/sidecar/client.mjs';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m',
};
const log = (msg) => console.log(msg);
const section = (t) => console.log(`\n${c.bold}${c.magenta}── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}${c.reset}`);

const USER_ID = `showcase-${Date.now()}`;

function collectPendingApprovals(result) {
  // Vercel AI SDK 6's tool-loop emits approval requests as content parts on
  // the assistant message in result.steps[].content. Walk the steps.
  const requests = [];
  const callsById = new Map();
  const steps = result?.steps || [];
  for (const step of steps) {
    for (const part of step.content || []) {
      if (part.type === 'tool-call') {
        callsById.set(part.toolCallId, { name: part.toolName, args: part.input ?? part.args });
      } else if (part.type === 'tool-approval-request') {
        const call = callsById.get(part.toolCallId) || {};
        requests.push({
          approvalId: part.approvalId,
          toolCallId: part.toolCallId,
          toolName: part.toolName || call.name,
          args: part.input ?? part.args ?? call.args,
        });
      }
    }
  }
  return requests;
}

function summarizeToolCalls(result) {
  const out = [];
  const steps = result?.steps || [];
  for (const step of steps) {
    for (const part of step.content || []) {
      if (part.type === 'tool-call') {
        out.push({ kind: 'call', name: part.toolName, input: part.input });
      } else if (part.type === 'tool-result') {
        out.push({ kind: 'result', name: part.toolName, output: part.output });
      }
    }
  }
  return out;
}

async function runWithAutoApprove(prompt) {
  const allSteps = [];
  const allText = [];
  let result = await runAgentTurn({ prompt, userId: USER_ID, source: 'showcase', skipBudget: true });

  for (let round = 0; round < 5; round++) {
    if (result?.steps) allSteps.push(...result.steps);
    if (typeof result?.text === 'string' && result.text) allText.push(result.text);

    const pending = collectPendingApprovals(result);
    if (pending.length === 0) break;

    log(`${c.dim}auto-approving ${pending.length} tool call(s): ${pending.map(p => p.toolName).join(', ')}${c.reset}`);
    const responses = pending.map((p) => ({
      type: 'tool-approval-response',
      approvalId: p.approvalId,
      approved: true,
    }));
    await appendHistory(USER_ID, [{ role: 'tool', content: responses }]);
    result = await runAgentTurn({ userId: USER_ID, source: 'showcase', skipBudget: true });
  }
  // Return a synthetic result that aggregates every turn's steps + text.
  return { steps: allSteps, text: allText.filter(Boolean).join('\n\n').trim() };
}

async function main() {
  console.log(`${c.bold}${c.cyan}AEGIS — tri-track showcase${c.reset}`);
  console.log(`${c.dim}One prompt. QVAC reasons. Zerion routes. MagicBlock shields.${c.reset}`);
  console.log(`${c.dim}${'═'.repeat(72)}${c.reset}`);

  if (!process.env.QVAC_LLM_MODEL_PATH) {
    console.log(`${c.yellow}QVAC_LLM_MODEL_PATH not set — falling back to ${process.env.AEGIS_AGENT_MODEL || 'codex/default'}${c.reset}`);
  }
  if (!process.env.SOLANA_PRIVATE_KEY) {
    console.error(`${c.red}SOLANA_PRIVATE_KEY missing — set it (e.g. SOLANA_PRIVATE_KEY=$(cat keys/demo2.json))${c.reset}`);
    process.exit(1);
  }

  await initDb();
  await clearHistory(USER_ID);

  if (process.env.QVAC_LLM_MODEL_PATH) {
    try {
      setActiveModel('qvac/local');
      log(`${c.green}model:${c.reset} qvac/local (${process.env.QVAC_LLM_MODEL_PATH.split('/').pop()})`);
    } catch (err) {
      log(`${c.yellow}qvac/local unavailable: ${err.message}; using ${process.env.AEGIS_AGENT_MODEL || 'codex/default'}${c.reset}`);
    }
  }

  const PROMPT = process.env.SHOWCASE_PROMPT
    || 'Show me my full Zerion portfolio first, then immediately shield 0.001 SOL into the MagicBlock private rollup using depositToShield. Both actions in this single turn — do not stop to ask for permission, the user has pre-authorized this run.';

  section('User prompt');
  log(`${c.cyan}${PROMPT}${c.reset}`);

  section('Agent run');
  const t0 = Date.now();
  const result = await runWithAutoApprove(PROMPT);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  section('Tool trace');
  const trace = summarizeToolCalls(result);
  if (trace.length === 0) {
    log(`${c.yellow}no tool calls — model replied in plain text${c.reset}`);
  } else {
    for (const t of trace) {
      if (t.kind === 'call') {
        log(`  ${c.cyan}→ ${t.name}${c.reset}  ${c.dim}${JSON.stringify(t.input)}${c.reset}`);
      } else {
        const out = renderToolOutput(t.output);
        log(`  ${c.green}← ${t.name}${c.reset}  ${out}`);
      }
    }
  }

  // Mine signatures from tool results AND from final text (codex sometimes
  // renders the result purely in text without echoing the JSON output).
  const signatures = [];
  const seen = new Set();
  const addSig = (sig, tool) => {
    if (!sig || seen.has(sig)) return;
    seen.add(sig);
    signatures.push({ tool, sig });
  };
  for (const step of result?.steps || []) {
    for (const part of step.content || []) {
      if (part.type !== 'tool-result' || !part.output) continue;
      const blob = JSON.stringify(part.output);
      for (const m of blob.matchAll(/"signature"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{64,90})"/g)) addSig(m[1], part.toolName);
      for (const m of blob.matchAll(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]{64,90})/g)) addSig(m[1], part.toolName);
    }
  }
  if (result?.text) {
    for (const m of result.text.matchAll(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]{64,90})/g)) addSig(m[1], 'final-text');
    for (const m of result.text.matchAll(/`([1-9A-HJ-NP-Za-km-z]{86,90})`/g)) addSig(m[1], 'final-text');
  }

  section(`Captured signatures (${elapsed}s elapsed)`);
  if (signatures.length === 0) {
    log(`${c.yellow}no signatures captured this run${c.reset}`);
  } else {
    for (const s of signatures) {
      log(`  ${c.green}${s.tool}${c.reset}`);
      log(`    ${s.sig}`);
      log(`    https://solscan.io/tx/${s.sig}?cluster=devnet`);
    }
  }

  section('Final response');
  const finalText = (typeof result?.text === 'string' ? result.text : '').trim();
  log(finalText || `${c.dim}(empty — agent returned no text part)${c.reset}`);

  await shutdownSidecar().catch(() => {});
}

function renderToolOutput(out) {
  if (!out) return '';
  if (out.type === 'text') return c.dim + out.value + c.reset;
  if (out.type === 'json') return c.dim + JSON.stringify(out.value).slice(0, 220) + c.reset;
  if (out.type === 'error-text') return c.red + out.value + c.reset;
  if (out.type === 'error-json') return c.red + JSON.stringify(out.value).slice(0, 220) + c.reset;
  return c.dim + JSON.stringify(out).slice(0, 220) + c.reset;
}

await main().catch(async (err) => {
  console.error(`${c.red}showcase failed:${c.reset} ${err.message}`);
  if (process.argv.includes('--verbose')) console.error(err.stack);
  await shutdownSidecar().catch(() => {});
  process.exit(1);
});
