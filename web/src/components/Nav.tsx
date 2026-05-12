"use client";

import { useEffect, useState } from "react";

const LINKS = [
  { label: "Flow", href: "/#demo" },
  { label: "Policies", href: "/#how-it-works" },
  { label: "Architecture", href: "/#architecture" },
  { label: "Surfaces", href: "/#surfaces" },
  { label: "Changelog", href: "/changelog" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className="fixed left-0 right-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <div
        className={`mx-auto flex h-16 max-w-6xl items-center justify-between rounded-2xl border px-3 transition-colors duration-150 ease-out sm:px-4 ${
          scrolled
            ? "border-[#f6f0df1a] bg-[#080807d9] shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl"
            : "border-transparent bg-transparent"
        }`}
      >
        <a
          href="/"
          className="group flex min-h-10 items-center gap-3 rounded-xl px-1.5 focus-ring"
          aria-label="AEGIS home"
        >
          <LogoMark />
          <div className="leading-none">
            <span className="block font-display text-[1.05rem] font-extrabold tracking-[0.16em] text-text-primary">
              AEGIS
            </span>
            <span className="mt-1 hidden font-mono text-[0.58rem] uppercase tracking-[0.2em] text-text-dim sm:block">
              Zerion CLI fork
            </span>
          </div>
        </a>

        <div className="hidden items-center gap-1 rounded-full border border-[#f6f0df12] bg-[#f6f0df05] p-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-2 text-sm text-text-muted transition-colors duration-150 ease-out hover:bg-[#f6f0df08] hover:text-text-primary focus-ring"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/#quickstart"
            className="hidden min-h-10 items-center rounded-xl px-3 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-text-muted transition-colors duration-150 ease-out hover:text-aegis-gold focus-ring sm:inline-flex"
          >
            Install
          </a>
          <a
            href="https://github.com/danielAsaboro/aegis"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#deb25945] bg-[#deb25914] px-3.5 text-sm font-semibold text-aegis-gold transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:border-[#deb25980] hover:bg-[#deb2591f] focus-ring motion-reduce:transform-none"
          >
            <GitHubIcon />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </div>
    </nav>
  );
}

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-xl border border-[#deb25955] bg-[#deb25914] text-aegis-gold shadow-glow-amber ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" fill="none" className="h-5 w-5">
        <path
          d="M16 3.5 5.5 8.75v7.75c0 6.35 4.42 11.62 10.5 13 6.08-1.38 10.5-6.65 10.5-13V8.75L16 3.5Z"
          stroke="currentColor"
          strokeWidth="1.55"
          strokeLinejoin="round"
        />
        <path
          d="M10.6 16.15 14.2 20l7.4-8.05"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[#070707] bg-aegis-green" />
    </span>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  );
}
