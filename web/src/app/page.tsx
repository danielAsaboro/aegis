import { Architecture } from "@/components/Architecture";
import { CommandCenter } from "@/components/CommandCenter";
import { FeaturesGrid } from "@/components/FeaturesGrid";
import { Footer } from "@/components/Footer";
import { HowItWorks } from "@/components/HowItWorks";
import { Nav } from "@/components/Nav";
import { QuickStart } from "@/components/QuickStart";
import { StatsStrip } from "@/components/StatsStrip";
import { Surfaces } from "@/components/Surfaces";
import { TerminalDemo } from "@/components/TerminalDemo";

const GH = "https://github.com/danielAsaboro/aegis";

export default function Home() {
  return (
    <main className="site-shell min-h-screen bg-bg text-text-primary">
      <Nav />

      <section className="relative min-h-[100svh] overflow-hidden px-4 pb-16 pt-28 sm:px-6 lg:pt-32">
        <div className="absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(ellipse_at_50%_0%,rgba(222,178,89,0.16),transparent_62%)]" />
        <div className="absolute right-[-16rem] top-24 hidden h-[34rem] w-[52rem] rotate-[-18deg] border-y border-[#deb25912] bg-[#deb25906] lg:block" />

        <div className="relative mx-auto grid w-full max-w-6xl min-w-0 gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <div className="w-full min-w-0 max-w-[22rem] sm:max-w-3xl">
            <div className="hero-enter flex flex-wrap gap-2" style={{ animationDelay: "0ms" }}>
              {["Zerion CLI fork", "Real onchain swaps", "Scoped policies", "Human approval"].map((label) => (
                <span
                  key={label}
                  className="glass-chip rounded-full px-3 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.17em] text-text-muted"
                >
                  {label}
                </span>
              ))}
            </div>

            <h1
              className="headline hero-enter mt-7 max-w-[22rem] text-balance text-[clamp(3.8rem,10vw,8.4rem)] leading-[0.82] sm:max-w-[13ch]"
              style={{ animationDelay: "70ms" }}
            >
              Your wallet can act. It cannot go rogue.
            </h1>

            <p
              className="hero-enter mt-7 max-w-[22rem] text-lg leading-8 text-text-muted sm:max-w-xl"
              style={{ animationDelay: "140ms" }}
            >
              AEGIS turns the forked Zerion CLI into an autonomous trading agent:
              natural-language decisions, fail-closed policy controls, human approvals,
              and real execution through Zerion&apos;s swap stack.
            </p>

            <div
              className="hero-enter mt-9 flex w-full max-w-full flex-col gap-3 sm:flex-row"
              style={{ animationDelay: "210ms" }}
            >
              <a
                href={GH}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-flex items-center justify-center gap-2.5 rounded-2xl px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.12em] transition-transform duration-150 ease-out hover:-translate-y-0.5 focus-ring motion-reduce:transform-none"
              >
                <GitHubIcon />
                Open the repo
              </a>
              <a
                href="#demo"
                className="btn-secondary inline-flex items-center justify-center gap-2.5 rounded-2xl px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.12em] transition-colors duration-150 ease-out hover:border-[#f6f0df24] hover:bg-[#f6f0df08] focus-ring"
              >
                See the flow
                <ArrowIcon />
              </a>
            </div>

            <div
              className="hero-enter mt-10 grid max-w-[22rem] grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-4"
              style={{ animationDelay: "280ms" }}
            >
              {[
                ["34", "registered tools"],
                ["6", "core policies"],
                ["164", "tests passed"],
                ["0", "bypass flags"],
              ].map(([value, label]) => (
                <div key={label} className="border-l border-[#deb25924] pl-4">
                  <div className="font-display text-2xl font-extrabold text-aegis-gold sm:text-3xl">
                    {value}
                  </div>
                  <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="hero-enter relative w-full min-w-0 max-w-[22rem] sm:max-w-none"
            style={{ animationDelay: "120ms" }}
          >
            <div className="premium-panel rounded-[2rem] p-2 sm:p-3">
              <div className="rounded-[1.5rem] border border-[#f6f0df0f] bg-[#080807b8] p-2">
                <TerminalDemo />
              </div>
            </div>

            <div className="float-panel absolute -bottom-5 left-3 hidden rounded-2xl border border-[#57f28733] bg-[#07110bcc] px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.4)] backdrop-blur-xl md:block">
              <div className="flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.17em] text-aegis-green">
                <span className="h-2 w-2 rounded-full bg-aegis-green live-dot" />
                Fail-closed gate
              </div>
              <div className="mt-1 text-sm text-text-muted">No policy result, no signing.</div>
            </div>

            <div className="float-panel absolute -right-3 top-8 hidden rounded-2xl border border-[#4f7cff36] bg-[#07101bcc] px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.4)] backdrop-blur-xl md:block">
              <div className="font-mono text-[0.68rem] uppercase tracking-[0.17em] text-aegis-blue">
                Execution layer
              </div>
              <div className="mt-1 text-sm text-text-muted">Forked Zerion CLI</div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-aegis-gold/40 md:flex">
          <span className="h-12 w-px bg-gradient-to-b from-aegis-gold/60 to-transparent" />
          <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em]">scroll</span>
        </div>
      </section>

      <StatsStrip />
      <CommandCenter />
      <HowItWorks />
      <FeaturesGrid />
      <Architecture />
      <Surfaces />
      <QuickStart />
      <Footer />
    </main>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}
