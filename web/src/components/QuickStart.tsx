"use client";

import { useState } from "react";
import { Reveal } from "./Reveal";

const STEPS = [
  {
    label: "Clone the fork",
    code: `git clone https://github.com/danielAsaboro/aegis
cd aegis
cp .env.example .env`,
  },
  {
    label: "Configure execution",
    code: `# Required for Telegram and Zerion-routed swaps
TELEGRAM_BOT_TOKEN=<from @BotFather>
ZERION_API_KEY=<from dashboard.zerion.io>`,
  },
  {
    label: "Start services",
    code: `pnpm install
pnpm db:push
pnpm start`,
  },
  {
    label: "Run the CLI surface",
    code: `node engine/index.mjs chat`,
  },
];

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 1800);
  };

  const label = state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy";

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#f6f0df12] px-3 font-mono text-xs text-text-muted transition-colors duration-150 ease-out hover:border-[#deb2594d] hover:text-aegis-gold focus-ring"
      aria-live="polite"
    >
      {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      {label}
    </button>
  );
}

export function QuickStart() {
  return (
    <section id="quickstart" className="section-shell">
      <div className="section-inner">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <span className="eyebrow justify-center">Quickstart</span>
            <h2 className="headline mt-5 text-balance text-4xl leading-none md:text-6xl">
              Clone, configure, prove the path.
            </h2>
            <p className="mt-5 text-base leading-8 text-text-muted">
              Requires Node.js 20 or newer. The demo path keeps real execution routed
              through the forked Zerion CLI and the Zerion API.
            </p>
          </div>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-4xl gap-4">
          {STEPS.map((step, index) => (
            <Reveal key={step.label} delay={index * 60}>
              <div className="terminal-window">
                <div className="terminal-bar flex-wrap gap-3">
                  <span className="rounded-full border border-[#deb25930] bg-[#deb25910] px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-aegis-gold">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-base font-bold text-text-primary">
                    {step.label}
                  </span>
                  <div className="ml-auto">
                    <CopyButton text={step.code} />
                  </div>
                </div>
                <pre className="overflow-x-auto p-5 text-left font-mono text-sm leading-7 text-text-muted">
                  {step.code.split("\n").map((line, lineIndex) => (
                    <span
                      key={`${step.label}-${lineIndex}`}
                      className={line.trim().startsWith("#") ? "text-text-dim" : "text-text-primary"}
                    >
                      {line}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <div className="mt-10 text-center">
            <a
              href="https://github.com/danielAsaboro/aegis/blob/main/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[#f6f0df12] px-4 font-mono text-sm font-bold uppercase tracking-[0.12em] text-text-muted transition-colors duration-150 ease-out hover:border-[#deb25940] hover:text-aegis-gold focus-ring"
            >
              Read the full docs
              <ArrowIcon />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}
