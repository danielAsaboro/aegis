"use client";

import { useEffect, useRef, useState } from "react";

type LineKind = "prompt" | "gap" | "user" | "tool" | "output" | "success" | "approve" | "info";

interface TermLine {
  text: string;
  kind: LineKind;
  pause: number;
  typewriter?: boolean;
}

const SEQUENCE: TermLine[] = [
  { text: "$ aegis chat --policy safe-sol", kind: "prompt", pause: 500 },
  { text: "", kind: "gap", pause: 180 },
  { text: "You: rebalance SOL exposure into USDC when policy allows", kind: "user", pause: 360, typewriter: true },
  { text: "AEGIS -> portfolio.getPositions()", kind: "tool", pause: 260 },
  { text: "AEGIS -> market.getSwapQuote()", kind: "tool", pause: 300 },
  { text: "quote ready: Zerion route found, value-moving action detected", kind: "output", pause: 440 },
  { text: "gate: spend-limit passed | cooldown passed | chain lock SOL", kind: "info", pause: 440 },
  { text: "approval required: human must confirm before signing", kind: "approve", pause: 900 },
  { text: "execution path armed: Zerion CLI -> Solana", kind: "success", pause: 3000 },
];

const kindStyle: Record<LineKind, string> = {
  prompt: "text-aegis-gold",
  gap: "",
  user: "text-[#f6f0df]",
  tool: "text-aegis-cyan",
  output: "text-text-muted",
  success: "text-aegis-green",
  approve: "text-aegis-amber",
  info: "text-[#8f866f]",
};

export function TerminalDemo() {
  const [committed, setCommitted] = useState<TermLine[]>([]);
  const [typing, setTyping] = useState<{ kind: LineKind; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setCommitted(SEQUENCE);
      setTyping(null);
      return;
    }

    const clear = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };

    const next = (idx: number) => {
      if (idx >= SEQUENCE.length) {
        timerRef.current = setTimeout(() => {
          setCommitted([]);
          setTyping(null);
          timerRef.current = setTimeout(() => next(0), 550);
        }, 3200);
        return;
      }

      const line = SEQUENCE[idx];

      if (line.typewriter && line.text.length > 0) {
        let ci = 0;
        setTyping({ kind: line.kind, text: "" });

        const typeChar = () => {
          ci += 1;
          setTyping({ kind: line.kind, text: line.text.slice(0, ci) });
          if (ci < line.text.length) {
            timerRef.current = setTimeout(typeChar, 36);
          } else {
            timerRef.current = setTimeout(() => {
              setCommitted((previous) => [...previous, line]);
              setTyping(null);
              timerRef.current = setTimeout(() => next(idx + 1), line.pause);
            }, 80);
          }
        };

        timerRef.current = setTimeout(typeChar, 45);
      } else {
        setCommitted((previous) => [...previous, line]);
        timerRef.current = setTimeout(() => next(idx + 1), line.pause);
      }
    };

    timerRef.current = setTimeout(() => next(0), 420);
    return clear;
  }, []);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [committed, typing]);

  return (
    <div className="terminal-window scanlines relative">
      <div className="terminal-bar">
        <div className="terminal-dot bg-[#ff6b5f]" />
        <div className="terminal-dot bg-[#f2cf7a]" />
        <div className="terminal-dot bg-[#57f287]" />
        <span className="ml-3 font-mono text-[0.72rem] text-text-muted">
          aegis execution run
        </span>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-aegis-green live-dot" />
          <span className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-aegis-green/60">
            policy online
          </span>
        </div>
      </div>

      <div
        ref={bodyRef}
        className="min-h-[322px] overflow-hidden px-5 py-4 font-mono text-[12.5px] leading-[1.86] sm:text-[13px]"
        aria-label="AEGIS command line demo"
      >
        {committed.map((line, index) =>
          line.kind === "gap" ? (
            <div key={index} className="h-3" />
          ) : (
            <div key={index} className={`term-line-enter whitespace-pre-wrap ${kindStyle[line.kind]}`}>
              {line.text}
            </div>
          )
        )}

        {typing && (
          <div className={`whitespace-pre-wrap ${kindStyle[typing.kind]}`}>
            {typing.text}
            <span className="ml-px inline-block h-[13px] w-[2px] align-middle bg-aegis-gold cursor-blink" />
          </div>
        )}

        {!typing && (
          <span className="inline-block h-[14px] w-[8px] align-middle bg-aegis-gold cursor-blink" />
        )}
      </div>
    </div>
  );
}
