/**
 * `zerion chat` / `aegis chat` — CLI surface for the AEGIS LLM agent.
 *
 * Two modes:
 *   - One-shot:  zerion chat "rebalance to 60/40 SOL/USDC"
 *   - REPL:      zerion chat
 *
 * Flags:
 *   --model <id>     Override AEGIS_AGENT_MODEL for this session
 *   --wallet <name>  Override DEFAULT_WALLET for tools that resolve addresses
 *   --json           Emit structured JSON per turn instead of human text
 */

import readline from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { print, printError } from "../utils/common/output.js";

// Agent module is heavy (pulls in spl-token / magicblock SDK transitively
// for the shield tools) — defer its import until the command actually runs
// so simply registering this command in zerion.js doesn't slow `--help` and
// doesn't pollute stderr with native-binding warnings.
let _agent = null;
async function loadAgent() {
  if (!_agent) {
    const { initDb } = await import("../../engine/db/index.mjs");
    await initDb();
    const indexMod = await import("../../engine/agent/index.mjs");
    _agent = {
      runAgentTurn: indexMod.runAgentTurn,
      setActiveModel: indexMod.setActiveModel,
      getActiveModel: indexMod.getActiveModel,
      getAvailableModels: indexMod.getAvailableModels,
      clearHistory: indexMod.clearHistory,
      appendHistory: indexMod.appendHistory,
      listSkills: indexMod.listSkills,
      refreshSkills: indexMod.refreshSkills,
    };
  }
  return _agent;
}

function disableAiSdkWarnings() {
  globalThis.AI_SDK_LOG_WARNINGS = false;
}

function collectPendingApprovals(messages) {
  const requests = [];
  const callsById = new Map();
  for (const msg of messages || []) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "tool-call") {
        callsById.set(part.toolCallId, { name: part.toolName, args: part.input ?? part.args });
      } else if (part.type === "tool-approval-request") {
        const call = callsById.get(part.toolCallId) || {};
        requests.push({
          approvalId: part.approvalId,
          toolCallId: part.toolCallId,
          toolName: call.name || "tool",
          args: call.args,
        });
      }
    }
  }
  return requests;
}

function renderTypedError(err) {
  if (!err) return "Unknown error.";
  if (err.code === "AbortError" || err.name === "AbortError") return null; // silent
  if (err.code === "budget_exhausted") {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    const hh = String(next.getHours()).padStart(2, "0");
    const mm = String(next.getMinutes()).padStart(2, "0");
    return `Hourly agent budget reached — try again at ${hh}:${mm}.`;
  }
  if (err.code === "no_policy_result" || err.code === "missing_policy_config") {
    return `Trade refused: ${err.message}`;
  }
  return `error: ${err.message || String(err)}`;
}

function promptYesNo(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const a = (answer || "").trim().toLowerCase();
      resolve(a === "y" || a === "yes" || a === "approve" || a === "a");
    });
  });
}

// Active turn controller — installed for SIGINT-driven aborts.
let _activeController = null;
let _sigintInstalled = false;
let _sigintCount = 0;

function installSigintHandler() {
  if (_sigintInstalled) return;
  _sigintInstalled = true;
  process.on("SIGINT", () => {
    _sigintCount += 1;
    if (_activeController && _sigintCount === 1) {
      print("\n⏹ aborting current turn (Ctrl+C again to exit)…");
      try { _activeController.abort(); } catch {}
      return;
    }
    process.exit(130);
  });
}

async function runUntilStable({ rl, userId, walletName, prompt, resumeMessages, json, askApproval, onResponse }) {
  const agent = await loadAgent();
  const { runAgentTurn, appendHistory } = agent;

  installSigintHandler();

  const tuiMode = typeof askApproval === "function";
  let messages = resumeMessages;
  let userPrompt = prompt;

  // Loop until no pending approvals remain.
  // Each iteration is one agent.generate() turn.
  while (true) {
    const controller = new AbortController();
    _activeController = controller;
    _sigintCount = 0;
    let result;
    try {
      result = await runAgentTurn({
        userId,
        source: "cli",
        walletName,
        prompt: messages ? undefined : userPrompt,
        messages,
        abortSignal: controller.signal,
        onEvents: (events) => {
          if (tuiMode) {
            events.on("tool-call-start", ({ toolName, input }) => {
              onResponse({ type: "tool_start", toolName, input: input ?? null });
            });
            events.on("tool-call-finish", ({ toolName, success, durationMs, output }) => {
              let resultPreview = null;
              if (success && output != null) {
                try {
                  const s = typeof output === "string" ? output : JSON.stringify(output);
                  if (s && s.length <= 200) resultPreview = s;
                } catch { /* ignore */ }
              }
              onResponse({
                type: "tool_finish",
                toolName,
                success: !!success,
                durationMs: durationMs ?? null,
                resultPreview,
              });
            });
            events.on("tool-error", ({ toolName, errorMsg }) => {
              onResponse({ type: "tool_error", toolName, errorMsg: errorMsg ?? "" });
            });
            return;
          }
          if (json) return;
          events.on("tool-call-start", ({ toolName }) => {
            if (toolName) print(`→ ${toolName}`);
          });
          events.on("tool-call-finish", ({ toolName, success, errorMsg, durationMs }) => {
            const dur = durationMs != null ? ` ${durationMs}ms` : "";
            const mark = success ? `✓ ${toolName}${dur}` : `✗ ${toolName}${errorMsg ? ` — ${errorMsg}` : ""}`;
            print(mark);
          });
          events.on("tool-error", ({ toolName, errorMsg }) => {
            if (json) return;
            print(`✗ ${toolName}${errorMsg ? ` — ${errorMsg}` : ""}`);
          });
          events.on("abort", () => {
            if (json) return;
            print("⏹ aborted");
          });
        },
      });
    } finally {
      if (_activeController === controller) _activeController = null;
    }
    userPrompt = undefined;
    messages = undefined;

    if (tuiMode) {
      if (result.text) onResponse({ type: "response", text: result.text });
    } else if (json) {
      process.stdout.write(
        JSON.stringify({
          text: result.text,
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
          steps: result.steps,
        }, null, 2) + "\n"
      );
    } else {
      if (result.toolResults?.length && process.env.AEGIS_CHAT_VERBOSE === "1") {
        for (const tr of result.toolResults) {
          print(`← ${tr.toolName}: ${JSON.stringify(tr.output ?? tr.result ?? {})}`);
        }
      }
      if (result.text) print(result.text);
    }

    const pending = collectPendingApprovals(result.response?.messages);
    if (pending.length === 0) return result;

    // Ask the user about each pending approval.
    const responses = [];
    for (const req of pending) {
      let approved;
      if (tuiMode) {
        approved = await askApproval(req);
      } else {
        const argsStr = req.args ? ` with ${JSON.stringify(req.args)}` : "";
        approved = await promptYesNo(
          rl,
          `\n🤖 Agent wants to call ${req.toolName}${argsStr}\nApprove? [y/N] `
        );
      }
      responses.push({
        type: "tool-approval-response",
        approvalId: req.approvalId,
        approved,
      });
    }

    const toolMsg = { role: "tool", content: responses };
    await appendHistory(userId, [toolMsg]);

    // Build resume messages: history (which now ends with toolMsg) + nothing more.
    // runAgentTurn with messages=undefined and prompt=undefined will use history.
    messages = undefined;
  }
}

// ── TUI mode: NDJSON subprocess protocol ────────────────────────────────────

async function runTuiMode(flags) {
  disableAiSdkWarnings();
  const agent = await loadAgent();
  const { setActiveModel, getActiveModel, getAvailableModels, clearHistory, listSkills } = agent;

  if (flags.model) {
    try { setActiveModel(flags.model); } catch {}
  }
  const walletName = flags.wallet || flags.w;
  const sessionId = `tui-${Date.now()}`;
  let userId = sessionId;

  // All TUI output goes through this — one JSON object per line
  const tuiWrite = (obj) => {
    process.stdout.write(JSON.stringify(obj) + "\n");
  };

  // Pending approval resolvers: approvalId → resolve(boolean)
  const pendingApprovals = new Map();

  // Resolve wallet address for title bar display
  let walletAddr = null;
  try {
    const { getSolAddress, getEvmAddress } = await import("../utils/wallet/keystore.js");
    const wn = walletName || process.env.DEFAULT_WALLET || "default";
    walletAddr = getSolAddress(wn) || getEvmAddress(wn) || null;
  } catch {}

  // Emit ready
  tuiWrite({ type: "ready", model: getActiveModel(), models: getAvailableModels(), wallet: walletAddr, session_id: sessionId });

  // Read stdin line-by-line
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  const handleMessage = async (text) => {
    try {
      await runUntilStable({
        rl: null,
        userId,
        walletName,
        prompt: text,
        json: false,
        askApproval: async (req) => {
          tuiWrite({
            type: "approval_request",
            approvalId: req.approvalId,
            toolName: req.toolName,
            args: req.args ?? null,
          });
          return new Promise((resolve) => {
            pendingApprovals.set(req.approvalId, resolve);
          });
        },
        onResponse: (obj) => tuiWrite(obj),
      });
    } catch (err) {
      if (err?.code === "AbortError" || err?.name === "AbortError") {
        tuiWrite({ type: "aborted" });
      } else {
        tuiWrite({ type: "error", message: err?.message || String(err) });
      }
    }
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }

    switch (cmd.type) {
      case "message":
        handleMessage(String(cmd.text || "")).catch(() => {});
        break;
      case "approval": {
        const resolve = pendingApprovals.get(cmd.approvalId);
        if (resolve) {
          pendingApprovals.delete(cmd.approvalId);
          resolve(!!cmd.approved);
        }
        break;
      }
      case "model":
        try { setActiveModel(String(cmd.model || "")); } catch {}
        break;
      case "reset":
        await clearHistory(userId).catch(() => {});
        break;
      case "abort":
        if (_activeController) {
          try { _activeController.abort(); } catch {}
        }
        break;
      case "list_skills": {
        const skills = listSkills();
        tuiWrite({ type: "skills_list", skills: skills.map(s => s.name) });
        break;
      }
      case "list_sessions": {
        const { listSessions } = await import("../../engine/agent/db-memory.mjs");
        const sessions = await listSessions("tui-");
        tuiWrite({ type: "sessions_list", sessions });
        break;
      }
      case "resume_session": {
        const newId = String(cmd.session_id || "");
        if (newId.startsWith("tui-")) {
          userId = newId;
          tuiWrite({ type: "session_resumed", session_id: newId });
        }
        break;
      }
      case "quit":
        process.exit(0);
        break;
      default:
        break;
    }
  }
}

export default async function chat(args, flags) {
  // --tui: hand off entirely to the NDJSON subprocess protocol handler
  if (flags.tui) {
    await runTuiMode(flags);
    return;
  }

  // Interactive REPL with no args and no special flags → exec the Ratatui TUI
  // immediately, before loading the heavy agent module.
  const json = !!flags.json;
  if (json) {
    disableAiSdkWarnings();
  }
  if (args.length === 0 && !json && !flags.audio && process.stdin.isTTY) {
    const tuiBin = fileURLToPath(new URL("../tui/target/release/aegis-tui", import.meta.url));
    if (existsSync(tuiBin)) {
      const res = spawnSync(tuiBin, [], { stdio: "inherit", env: process.env });
      process.exit(res.status ?? 0);
    }
  }

  // Optional flags
  const agent = await loadAgent();
  const { setActiveModel, getActiveModel, getAvailableModels, clearHistory } = agent;

  if (flags.model) {
    try { setActiveModel(flags.model); }
    catch (err) { printError("invalid_model", err.message); process.exit(1); }
  }
  const walletName = flags.wallet || flags.w;

  const userId = `cli-${process.pid}`;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // --audio <path>: transcribe locally via QVAC and feed the result as the prompt.
  if (flags.audio) {
    let audioBuf;
    try { audioBuf = readFileSync(flags.audio); }
    catch (err) { printError("audio_read", `Failed to read ${flags.audio}: ${err.message}`); process.exit(1); }

    let transcribed;
    try {
      const { getTranscriber } = await import("../../engine/qvac/index.mjs");
      const t = await getTranscriber();
      const result = await t.transcribe(audioBuf, {});
      transcribed = (result.text || "").trim();
      if (!transcribed) {
        printError("audio_empty", "No speech detected in the supplied audio.");
        process.exit(1);
      }
      print(`🎙️ heard: "${transcribed}"`);
    } catch (err) {
      printError("audio_transcribe", err.message || String(err));
      process.exit(1);
    }

    const promptFromAudio = [transcribed, ...args].filter(Boolean).join(" ").trim();
    try {
      await runUntilStable({ rl, userId, walletName, prompt: promptFromAudio, json });
    } catch (err) {
      const friendly = renderTypedError(err);
      if (friendly === null) {
        // silent abort
      } else {
        printError(err.code || "agent_error", friendly.replace(/^error:\s*/, ""));
      }
      process.exit(err.code === "AbortError" ? 130 : 1);
    } finally {
      rl.close();
    }
    return;
  }

  // One-shot mode: arg(s) joined as the prompt.
  if (args.length > 0) {
    const prompt = args.join(" ");
    try {
      await runUntilStable({ rl, userId, walletName, prompt, json });
    } catch (err) {
      const friendly = renderTypedError(err);
      if (friendly === null) {
        // silent abort
      } else if (err.code === "budget_exhausted") {
        printError("budget_exhausted", friendly);
      } else {
        printError(err.code || "agent_error", friendly.replace(/^error:\s*/, ""));
      }
      process.exit(err.code === "AbortError" ? 130 : 1);
    } finally {
      rl.close();
    }
    return;
  }

  print(`AEGIS chat — model: ${getActiveModel()}. Type :help for commands, :quit to exit.`);
  print(`Available models: ${getAvailableModels().join(", ")}`);

  const ask = () =>
    new Promise((resolve) => {
      if (rl.closed) { resolve(null); return; }
      rl.once('close', () => resolve(null));
      try {
        rl.question("\nyou> ", (answer) => resolve(answer));
      } catch {
        resolve(null);
      }
    });

  while (true) {
    const raw = await ask();
    if (raw === null) break;
    const line = raw.trim();
    if (!line) continue;

    if (line === ":quit" || line === ":q" || line === "exit") break;
    if (line === ":help") {
      print(":model <id>   switch model");
      print(":reset        clear chat history");
      print(":models       list available models");
      print(":skills       list discovered Agent Skills");
      print(":skills refresh  re-scan skill directories");
      print(":quit         exit");
      continue;
    }
    if (line === ":skills") {
      const { listSkills } = agent;
      const skills = listSkills();
      if (skills.length === 0) {
        print("No skills found. Drop a folder with SKILL.md into .agents/skills/ or ~/.config/aegis/skills/");
      } else {
        for (const s of skills) {
          print(`• ${s.name}`);
          print(`  ${s.description}`);
        }
      }
      continue;
    }
    if (line === ":skills refresh" || line === ":skills reload") {
      const { refreshSkills } = agent;
      const skills = refreshSkills();
      print(`reloaded ${skills.length} skill${skills.length === 1 ? '' : 's'}`);
      continue;
    }
    if (line === ":reset") {
      await clearHistory(userId);
      print("history cleared.");
      continue;
    }
    if (line === ":models") {
      print(getAvailableModels().join("\n"));
      continue;
    }
    if (line.startsWith(":model ")) {
      const id = line.slice(7).trim();
      try { setActiveModel(id); print(`switched to ${id}`); }
      catch (err) { print(`error: ${err.message}`); }
      continue;
    }

    try {
      await runUntilStable({ rl, userId, walletName, prompt: line, json });
    } catch (err) {
      const friendly = renderTypedError(err);
      if (friendly !== null) print(friendly);
    }
  }

  rl.close();
}
