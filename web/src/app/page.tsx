import { Nav } from "@/components/Nav";
import { TerminalDemo } from "@/components/TerminalDemo";
import { StatsStrip } from "@/components/StatsStrip";
import { HowItWorks } from "@/components/HowItWorks";
import { FeaturesGrid } from "@/components/FeaturesGrid";
import { Architecture } from "@/components/Architecture";
import { Surfaces } from "@/components/Surfaces";
import { QuickStart } from "@/components/QuickStart";
import { Footer } from "@/components/Footer";

const GH = "https://github.com/danielAsaboro/aegis";

export default function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <Nav />

      {/* ╔═══════════════════════════════════════════════════════╗
          ║  HERO                                                 ║
          ╚═══════════════════════════════════════════════════════╝ */}
      <section className="relative min-h-screen flex items-center pt-16 px-6 overflow-hidden">

        {/* Structured amber dot grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(rgba(232,160,48,0.18) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage: "radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 100%)",
            opacity: 0.12,
            animation: "gridFade 1.2s ease-out forwards",
          }}
        />

        {/* Single centered radial glow — architectural, not blobby */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(232,160,48,0.06) 0%, transparent 100%)",
          }}
        />

        {/* AEGIS watermark */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
          aria-hidden="true"
        >
          <span className="font-display font-800 text-[24vw] leading-none tracking-[0.12em] text-white/[0.016]">
            AEGIS
          </span>
        </div>

        {/* Content */}
        <div className="relative max-w-6xl mx-auto w-full grid lg:grid-cols-[1.1fr_0.9fr] gap-14 items-center py-20">

          {/* ── Left ───────────────────────────────────────────── */}
          <div>
            {/* Badge strip */}
            <div
              className="hero-enter flex flex-wrap gap-2 mb-8"
              style={{ animationDelay: "0ms" }}
            >
              {[
                { label: "25 Tools"     },
                { label: "9 Policies"   },
                { label: "4 LLM Models" },
                { label: "164 Tests ✓"  },
              ].map((b) => (
                <span
                  key={b.label}
                  className="font-mono text-[10px] tracking-widest uppercase px-2.5 py-1 rounded-full border"
                  style={{
                    borderColor: "rgba(232,160,48,0.22)",
                    background: "rgba(232,160,48,0.07)",
                    color: "rgba(232,160,48,0.75)",
                  }}
                >
                  {b.label}
                </span>
              ))}
            </div>

            {/* Headline */}
            <h1
              className="hero-enter font-display font-800 leading-[0.88] tracking-tight mb-7"
              style={{ animationDelay: "80ms" }}
            >
              <span className="block text-[clamp(3.2rem,7.5vw,6.4rem)] text-white">
                AUTONOMOUS
              </span>
              <span
                className="block text-[clamp(3.2rem,7.5vw,6.4rem)]"
                style={{
                  background: "linear-gradient(130deg, #f5c060 0%, #e8a030 55%, #c47a10 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                TRADING,
              </span>
              <span className="block text-[clamp(1.8rem,4.2vw,3.6rem)] text-white/40 font-600 tracking-normal mt-2">
                ZERO INFORMATION LEAK.
              </span>
            </h1>

            {/* Subtext */}
            <p
              className="hero-enter text-[#6b6376] text-[1.05rem] leading-[1.75] max-w-[480px] mb-10"
              style={{ animationDelay: "160ms" }}
            >
              Talk to your wallet in natural language. AEGIS reasons with
              Claude or GPT, gates every trade through a fail-closed policy
              engine, and routes sensitive swaps through MagicBlock&apos;s
              shielded rollup — so front-runners never see you coming.
            </p>

            {/* CTAs */}
            <div
              className="hero-enter flex flex-wrap gap-4 mb-12"
              style={{ animationDelay: "240ms" }}
            >
              <a
                href={GH}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-flex items-center gap-2.5 px-6 py-3 rounded-xl font-mono text-sm font-500 text-[#080708] bg-[#e8a030] hover:bg-[#f0b040] transition-colors duration-200"
                style={{ boxShadow: "0 0 24px rgba(232,160,48,0.25), 0 4px 16px rgba(0,0,0,0.4)" }}
              >
                <GithubIcon />
                Get Started on GitHub
              </a>

              <a
                href="#quickstart"
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl font-mono text-sm font-500 text-[#e8a030] border border-[#e8a030]/20 hover:border-[#e8a030]/45 hover:bg-[#e8a030]/6 transition-all duration-200"
              >
                Quick Install
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </a>
            </div>

            {/* Built with */}
            <div
              className="hero-enter flex flex-wrap items-center gap-4"
              style={{ animationDelay: "320ms" }}
            >
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#2e2b35]">
                Built with
              </span>
              {[
                { label: "Solana",     color: "#9945FF" },
                { label: "Zerion",     color: "#2962EF" },
                { label: "MagicBlock", color: "#e8a030" },
                { label: "QVAC",       color: "#00b388" },
              ].map((t) => (
                <span
                  key={t.label}
                  className="font-mono text-xs opacity-60 hover:opacity-90 transition-opacity duration-200 cursor-default"
                  style={{ color: t.color }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {/* ── Right: Terminal ─────────────────────────────────── */}
          <div
            className="hero-enter relative"
            style={{ animationDelay: "120ms" }}
          >
            {/* Glow halo */}
            <div
              className="absolute -inset-10 rounded-3xl pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse at 60% 50%, rgba(232,160,48,0.07) 0%, transparent 65%)",
              }}
            />

            <TerminalDemo />

            {/* Floating pill: Tx confirmed */}
            <div
              className="absolute -bottom-6 -left-3 hidden md:flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#1e1b24] bg-[#0a0910]"
              style={{
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                animation: "floatPill 4s ease-in-out infinite",
              }}
            >
              <div className="w-2 h-2 rounded-full bg-[#4ade80] live-dot" />
              <span className="font-mono text-[11px] text-[#4ade80]">Tx confirmed</span>
            </div>

            {/* Floating pill: Policies */}
            <div
              className="absolute -top-6 -right-3 hidden md:flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#1e1b24] bg-[#0a0910]"
              style={{
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                animation: "floatPill 5s ease-in-out infinite 1.5s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e8a030" strokeWidth="2">
                <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
              </svg>
              <span className="font-mono text-[11px] text-[#e8a030]">8 policies active</span>
            </div>
          </div>
        </div>

        {/* Scroll cue */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-25">
          <div className="w-px h-10 bg-gradient-to-b from-[#e8a030] to-transparent" />
          <svg width="12" height="7" viewBox="0 0 12 7" fill="none">
            <path d="M1 1l5 5 5-5" stroke="#e8a030" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </section>

      {/* Stats */}
      <StatsStrip />

      {/* Rest of page */}
      <HowItWorks />
      <FeaturesGrid />
      <Architecture />
      <Surfaces />
      <QuickStart />
      <Footer />
    </div>
  );
}

function GithubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}
