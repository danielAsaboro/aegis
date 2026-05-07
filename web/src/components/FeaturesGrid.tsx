"use client";

import { useState } from "react";
import { Reveal } from "./Reveal";

const FEATURES = [
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    label: "Natural Language",
    desc: 'Type "swap 0.01 SOL to USDC" or send a voice note. AEGIS reasons with Claude or GPT, calls the right Zerion CLI tools, and shows the quote before signing.',
    accent: "#e8a030",
    tag: "LLM-driven",
  },
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/></svg>,
    label: "Policy Engine",
    desc: "9 composable policies gate every trade with AND semantics: spend-limit, cooldown, slippage, time-window, consensus, privacy, price-guard, allowlist, deny-approvals. Fail-closed by design.",
    accent: "#c8a060",
    tag: "9 policies",
  },
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>,
    label: "MagicBlock Privacy",
    desc: "Sensitive trades route through MagicBlock Ephemeral Rollups. Your balance and intent stay hidden from front-runners until the swap settles on Solana mainnet.",
    accent: "#4ade80",
    tag: "Shielded",
  },
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.06 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/><path d="M15 2s4 4 4 10"/><path d="M19.5 2.5S22 5.5 22 12"/></svg>,
    label: "Four surfaces",
    desc: "Same agent, four ways in: Telegram bot (voice + slash commands + inline approval), CLI REPL (`aegis chat`), MCP server for Claude Code / Cursor / Codex, and a localhost browser studio.",
    accent: "#e8a030",
    tag: "TG · CLI · MCP · Studio",
  },
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>,
    label: "Local-first AI (QVAC)",
    desc: "Voice notes transcribed on-device with Whisper. LLM runs locally via QVAC. Semantic trade history search. No API keys. No cloud. Your keys never leave the machine.",
    accent: "#e8a030",
    tag: "No cloud",
  },
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
    label: "Multi-Model",
    desc: "Switch between Claude Sonnet, Claude Opus, GPT-4.1, or GPT-5 at runtime — no restart. Same prompt, same tools, same policy gate across every provider.",
    accent: "#c8a060",
    tag: "4 models",
  },
];

function FeatureCard({
  feat,
  delay,
}: {
  feat: typeof FEATURES[0];
  delay: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Reveal delay={delay}>
      <div
        className="card-base p-6 h-full cursor-default"
        style={{
          borderColor: hovered ? `${feat.accent}28` : "#1a1720",
          boxShadow: hovered
            ? `0 0 35px ${feat.accent}14, 0 0 80px ${feat.accent}06, inset 0 1px 0 ${feat.accent}08`
            : "none",
          backgroundColor: hovered ? "#120f18" : "#0e0c12",
          transform: hovered ? "translateY(-2px)" : "translateY(0)",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Icon + tag */}
        <div className="flex items-start justify-between mb-5">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              background: `${feat.accent}10`,
              border: `1px solid ${feat.accent}22`,
              color: feat.accent,
              boxShadow: hovered ? `0 0 16px ${feat.accent}20` : "none",
              transition: "box-shadow 0.25s ease",
            }}
          >
            {feat.icon}
          </div>
          <span
            className="font-mono text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 rounded"
            style={{
              background: `${feat.accent}09`,
              color: `${feat.accent}99`,
              border: `1px solid ${feat.accent}18`,
            }}
          >
            {feat.tag}
          </span>
        </div>

        {/* Label */}
        <h3 className="font-display font-700 text-[#ede9df] text-[1.05rem] mb-2.5 leading-snug">
          {feat.label}
        </h3>

        {/* Description */}
        <p className="text-[#4b4556] text-sm leading-relaxed">{feat.desc}</p>

        {/* Bottom accent line */}
        <div
          className="mt-5 h-px rounded-full transition-all duration-500"
          style={{
            background: `linear-gradient(90deg, ${feat.accent}70, transparent)`,
            width: hovered ? "100%" : "0%",
          }}
        />
      </div>
    </Reveal>
  );
}

export function FeaturesGrid() {
  return (
    <section
      id="features"
      className="relative py-24 px-6"
      style={{
        background:
          "linear-gradient(to bottom, #080708, #0c0a10 50%, #080708)",
      }}
    >
      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.4]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(232,160,48,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(232,160,48,0.02) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* Header */}
        <Reveal className="mb-16 text-center">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="h-px w-8 bg-[#e8a030]/50" />
            <span className="font-mono text-[10px] text-[#e8a030]/70 tracking-[0.22em] uppercase">
              Capabilities
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-800 text-white leading-tight">
            Everything you need.<br />
            <span className="text-[#2e2b35]">Nothing you don&apos;t.</span>
          </h2>
        </Reveal>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((feat, i) => (
            <FeatureCard key={feat.label} feat={feat} delay={i * 70} />
          ))}
        </div>
      </div>
    </section>
  );
}
