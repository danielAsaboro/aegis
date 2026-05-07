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
  { text: "$ aegis chat", kind: "prompt", pause: 650 },
  { text: "", kind: "gap", pause: 200 },
  { text: "You:   swap 0.01 SOL to USDC", kind: "user", pause: 420, typewriter: true },
  { text: "AEGIS: → getSwapQuote()", kind: "tool", pause: 360 },
  { text: "       Quote: 0.01 SOL → ~1.94 USDC (Jupiter)", kind: "output", pause: 420 },
  { text: "       Approve? [y/N]", kind: "approve", pause: 1050 },
  { text: "> y", kind: "user", pause: 480, typewriter: true },
  { text: "       → executeSwap()", kind: "tool", pause: 280 },
  { text: "       policies passed: spend-limit ✓  cooldown ✓", kind: "info", pause: 460 },
  { text: "       ✅ Tx: solscan.io/tx/4xK2…ZqVk", kind: "success", pause: 3800 },
];

const kindStyle: Record<LineKind, string> = {
  prompt:  "text-[#e8a030]",
  gap:     "",
  user:    "text-[#fbbf24]",
  tool:    "text-[#c8a060]",
  output:  "text-[#94a3b8]",
  success: "text-[#4ade80]",
  approve: "text-[#fb923c]",
  info:    "text-[#4a4555]",
};

const cursorColor: Partial<Record<LineKind, string>> = {
  user:   "#fbbf24",
  prompt: "#e8a030",
};

export function TerminalDemo() {
  const [committed, setCommitted] = useState<TermLine[]>([]);
  const [typing, setTyping]       = useState<{ kind: LineKind; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clear = () => { if (timerRef.current) clearTimeout(timerRef.current); };

    const next = (idx: number) => {
      if (idx >= SEQUENCE.length) {
        timerRef.current = setTimeout(() => {
          setCommitted([]);
          setTyping(null);
          timerRef.current = setTimeout(() => next(0), 600);
        }, 3500);
        return;
      }

      const line = SEQUENCE[idx];

      if (line.typewriter && line.text.length > 0) {
        let ci = 0;
        setTyping({ kind: line.kind, text: "" });

        const typeChar = () => {
          ci++;
          setTyping({ kind: line.kind, text: line.text.slice(0, ci) });
          if (ci < line.text.length) {
            timerRef.current = setTimeout(typeChar, 58);
          } else {
            timerRef.current = setTimeout(() => {
              setCommitted((p) => [...p, line]);
              setTyping(null);
              timerRef.current = setTimeout(() => next(idx + 1), line.pause);
            }, 80);
          }
        };

        timerRef.current = setTimeout(typeChar, 35);
      } else {
        setCommitted((p) => [...p, line]);
        timerRef.current = setTimeout(() => next(idx + 1), line.pause);
      }
    };

    timerRef.current = setTimeout(() => next(0), 500);
    return clear;
  }, []);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [committed, typing]);

  const activeCursor = typing ? (cursorColor[typing.kind] ?? "#e8a030") : "#e8a030";

  return (
    <div className="terminal-window scanlines relative">
      {/* Title bar */}
      <div className="terminal-bar">
        <div className="terminal-dot bg-[#ff5f56]" />
        <div className="terminal-dot bg-[#ffbd2e]" />
        <div className="terminal-dot bg-[#27c93f]" />
        <span className="ml-3 font-mono text-[11px] text-[#4a4555] tracking-wide select-none">
          aegis — chat
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#4ade80] live-dot" />
          <span className="font-mono text-[9px] text-[#4ade80]/40 tracking-[0.2em] uppercase select-none">
            live
          </span>
        </div>
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        className="px-5 py-4 font-mono text-[13px] min-h-[308px] max-h-[340px] overflow-hidden"
        style={{ lineHeight: "1.78" }}
      >
        {committed.map((line, i) =>
          line.kind === "gap" ? (
            <div key={i} className="h-3" />
          ) : (
            <div key={i} className={`term-line-enter whitespace-pre ${kindStyle[line.kind]}`}>
              {line.text}
            </div>
          )
        )}

        {/* Active typewriter line */}
        {typing && (
          <div className={`whitespace-pre ${kindStyle[typing.kind]}`}>
            {typing.text}
            <span
              className="inline-block w-[2px] h-[13px] align-middle cursor-blink ml-px"
              style={{ background: activeCursor, borderRadius: "1px" }}
            />
          </div>
        )}

        {/* Idle block cursor */}
        {!typing && (
          <span
            className="inline-block w-[8px] h-[14px] align-middle cursor-blink"
            style={{ background: activeCursor, borderRadius: "1px" }}
          />
        )}
      </div>
    </div>
  );
}
