"use client";

import { useState } from "react";

const STEPS = [
  {
    label: "Clone & install",
    code: `git clone https://github.com/danielAsaboro/aegis
cd aegis
cp .env.example .env`,
  },
  {
    label: "Set env vars",
    code: `# Edit .env — required:
TELEGRAM_BOT_TOKEN=<from @BotFather>
ZERION_API_KEY=<from dashboard.zerion.io>`,
  },
  {
    label: "Start the agent",
    code: `pnpm install
pnpm db:push
pnpm start`,
  },
  {
    label: "Or chat in CLI",
    code: `# Talk to the agent in your terminal
node engine/index.mjs chat`,
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-xs text-text-muted hover:text-[#e8a030] border border-border hover:border-[#e8a030]/30 rounded transition-all duration-200"
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

export function QuickStart() {
  return (
    <section id="quickstart" className="relative py-28 px-6 bg-surface/20">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-16 bg-gradient-to-b from-transparent to-border" />

      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="h-px w-8 bg-[#4ade80]/50" />
            <span className="font-mono text-[10px] text-[#4ade80]/70 tracking-[0.22em] uppercase">
              Quick Start
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-700 text-white leading-tight">
            Up in four steps.
          </h2>
          <p className="mt-4 text-text-muted">
            Requires Node.js ≥ 20. LLM access via ChatGPT subscription or local QVAC — no API keys.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {STEPS.map((step, i) => (
            <div key={i} className="terminal-window">
              <div className="terminal-bar">
                <div className="terminal-dot bg-[#ff5f56]" />
                <div className="terminal-dot bg-[#ffbd2e]" />
                <div className="terminal-dot bg-[#27c93f]" />
                <div className="ml-3 flex items-center gap-2">
                  <span
                    className="font-mono text-[10px] tracking-widest uppercase px-2 py-0.5 rounded"
                    style={{
                      background: "rgba(232,160,48,0.08)",
                      color: "rgba(232,160,48,0.7)",
                      border: "1px solid rgba(232,160,48,0.15)",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-mono text-xs text-text-muted">
                    {step.label}
                  </span>
                </div>
                <div className="ml-auto">
                  <CopyButton text={step.code} />
                </div>
              </div>
              <pre className="p-5 font-mono text-sm text-[#94a3b8] leading-relaxed overflow-x-auto whitespace-pre">
                {step.code.split("\n").map((line, li) => {
                  const isComment = line.trim().startsWith("#");
                  const isCommand = !isComment && line.trim().length > 0;
                  return (
                    <div key={li}>
                      {isComment ? (
                        <span className="text-[#4a4555]">{line}</span>
                      ) : isCommand ? (
                        <span className="text-[#ede9df]">{line}</span>
                      ) : (
                        <span>{line}</span>
                      )}
                      {"\n"}
                    </div>
                  );
                })}
              </pre>
            </div>
          ))}
        </div>

        {/* Full docs CTA */}
        <div className="mt-10 text-center">
          <a
            href="https://github.com/danielAsaboro/aegis/blob/main/README.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-[#e8a030] transition-colors duration-200 group"
          >
            <span>Full documentation on GitHub</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="group-hover:translate-x-1 transition-transform duration-200"
            >
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
