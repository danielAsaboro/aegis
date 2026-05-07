"use client";

import { Reveal } from "./Reveal";

const SURFACES = [
  {
    label: "Telegram bot",
    cmd: "pnpm start",
    desc: "Conversational chat, voice notes, /dca, /rebalance, /alerts, /propose, /vote, /shield. Inline Approve/Deny keyboards on every value-moving action.",
    badge: "primary",
    accent: "#e8a030",
  },
  {
    label: "CLI REPL",
    cmd: "aegis chat",
    desc: "Talk to the agent in your terminal. Same tools, same policy gate, same approval flow as Telegram. No bot env vars required.",
    badge: "shipped",
    accent: "#c8a060",
  },
  {
    label: "MCP server",
    cmd: "aegis mcp",
    desc: "STDIO MCP server exposing every AEGIS tool to Claude Code, Cursor, Codex CLI, or any MCP host. Use AEGIS as a sub-agent for your own workflows.",
    badge: "shipped",
    accent: "#9945FF",
  },
  {
    label: "Browser studio",
    cmd: "aegis --studio",
    desc: "Hand-drawn whiteboard view of every signal, strategy, agent run, trade, and log line on a localhost-bound page. Read-only, token-gated, never binds beyond 127.0.0.1.",
    badge: "shipped",
    accent: "#4ade80",
  },
  {
    label: "Judge-trace",
    cmd: "aegis judge-trace",
    desc: "Single-screen proof of life for evaluators. Prints every policy decision — approve, deny, route public vs. private — for representative trades. No network. No money moves.",
    badge: "new",
    accent: "#e8a030",
  },
  {
    label: "Live demo",
    cmd: "pnpm demo --execute",
    desc: "End-to-end MagicBlock private flow: deposit → optional private intra-rollup transfer → withdraw. Captures Solscan signatures for the submission.",
    badge: "live",
    accent: "#c8a060",
  },
];

const ARTIFACTS = [
  {
    name: "ai-sdk-qvac",
    npm: "ai-sdk-qvac",
    desc: "Vercel AI SDK community provider for Tether QVAC. The first published path to drop a fully on-device LLM into ToolLoopAgent / generateText / streamText. Apache-2.0.",
    install: "pnpm add ai-sdk-qvac",
    accent: "#00b388",
  },
];

export function Surfaces() {
  return (
    <section
      id="surfaces"
      className="relative py-24 px-6"
      style={{
        background:
          "linear-gradient(to bottom, #080708 0%, #0a0810 50%, #080708 100%)",
      }}
    >
      <div className="relative max-w-6xl mx-auto">
        <Reveal className="mb-16 text-center">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="h-px w-8 bg-[#9945FF]/50" />
            <span className="font-mono text-[10px] text-[#9945FF]/70 tracking-[0.22em] uppercase">
              In the box
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-800 text-white leading-tight">
            Six surfaces. <span className="text-[#2e2b35]">One agent.</span>
          </h2>
          <p className="mt-4 text-[#6b6376] max-w-2xl mx-auto">
            Every entry point ships in the same repo, hits the same tool
            registry, and runs through the same fail-closed policy gate.
            Pick the surface that fits your context — chat, terminal,
            editor, browser, or hackathon judge.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
          {SURFACES.map((s, i) => (
            <Reveal key={s.label} delay={i * 60}>
              <div
                className="card-base p-6 h-full"
                style={{
                  borderColor: "#1a1720",
                  background: "#0e0c12",
                }}
              >
                <div className="flex items-start justify-between mb-4">
                  <h3 className="font-display font-700 text-[#ede9df] text-base">
                    {s.label}
                  </h3>
                  <span
                    className="font-mono text-[9px] tracking-[0.18em] uppercase px-2 py-0.5 rounded"
                    style={{
                      background: `${s.accent}10`,
                      color: `${s.accent}c0`,
                      border: `1px solid ${s.accent}25`,
                    }}
                  >
                    {s.badge}
                  </span>
                </div>
                <code
                  className="block font-mono text-[12.5px] mb-3 px-3 py-2 rounded border"
                  style={{
                    background: "rgba(232,160,48,0.04)",
                    borderColor: "rgba(232,160,48,0.15)",
                    color: s.accent,
                  }}
                >
                  $ {s.cmd}
                </code>
                <p className="text-[#5a5566] text-sm leading-relaxed">
                  {s.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Reusable artifacts */}
        <Reveal>
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-[#00b388]/50" />
              <span className="font-mono text-[10px] text-[#00b388]/70 tracking-[0.22em] uppercase">
                Reusable artifacts
              </span>
              <div className="h-px w-8 bg-[#00b388]/50" />
            </div>
            <h3 className="font-display text-2xl md:text-3xl font-700 text-white">
              Open-sourced for other builders
            </h3>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {ARTIFACTS.map((a, i) => (
            <Reveal key={a.name} delay={i * 80}>
              <div
                className="card-base p-6 h-full"
                style={{
                  borderColor: `${a.accent}25`,
                  background: "linear-gradient(180deg, #0e0c14 0%, #0c0a10 100%)",
                  boxShadow: `0 0 30px ${a.accent}08`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="font-mono text-[10px] tracking-[0.18em] uppercase px-2 py-0.5 rounded"
                    style={{
                      background: `${a.accent}12`,
                      color: a.accent,
                      border: `1px solid ${a.accent}30`,
                    }}
                  >
                    npm
                  </span>
                  <span className="font-mono text-sm font-700 text-white">
                    {a.name}
                  </span>
                </div>
                <p className="text-[#6b6376] text-sm leading-relaxed mb-4">
                  {a.desc}
                </p>
                <code
                  className="block font-mono text-[12.5px] px-3 py-2 rounded border"
                  style={{
                    background: "rgba(0,179,136,0.05)",
                    borderColor: "rgba(0,179,136,0.18)",
                    color: a.accent,
                  }}
                >
                  $ {a.install}
                </code>
                <a
                  href={`https://www.npmjs.com/package/${a.npm}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-mono text-[#6b6376] hover:text-[#00b388] transition-colors"
                >
                  View on npmjs.com
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </a>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
