import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Reveal } from "@/components/Reveal";

const GH = "https://github.com/danielAsaboro/aegis";
const SWAP_TX =
  "https://explorer.solana.com/tx/5aK9pZ9KCBhKawgcMdFGmS5W8rQbRoQ1utiUPSA7tHKF2f1d6zxq1gNRjWpqwMEdn4oA2JBJ5yGa5bqyXaZ16Ko6";
const SHIELD_TX =
  "https://explorer.solana.com/tx/5kdQ6DC93RJ12v4ns4uHvQajXmRVhuEDqzuW9Eus3E3fMb2G2mt9GmawriUhubD6mf7GpVDnvv7yBqaUjsNtASFR?cluster=devnet";

export const metadata: Metadata = {
  title: "AEGIS Changelog - Build Receipts",
  description:
    "A public changelog for AEGIS, the policy-gated onchain agent built on a forked Zerion CLI for Frontier 2026.",
};

const MILESTONES = [
  {
    eyebrow: "Foundation",
    title: "Forked Zerion CLI became the execution layer",
    date: "May 2026",
    accent: "gold",
    summary:
      "AEGIS starts as a fork, not a replacement. The original Zerion wallet, keystore, quote, swap, bridge, and agent-token surfaces remain intact while the autonomous agent is layered over them.",
    shipped: [
      "Registered Zerion CLI verbs as guarded agent tools instead of introducing a parallel wallet backend.",
      "Kept swaps on the Zerion API path through the CLI quote and broadcast code.",
      "Documented the fork boundary so judges can verify what AEGIS adds on top of upstream Zerion.",
    ],
    proof: [
      { label: "CHANGELOG.md", href: `${GH}/blob/main/CHANGELOG.md` },
      { label: "README track map", href: `${GH}/blob/main/README.md#frontier-track-requirements` },
    ],
  },
  {
    eyebrow: "Policy gate",
    title: "Autonomy was boxed inside scoped controls",
    date: "May 2026",
    accent: "green",
    summary:
      "Fund-moving tools were routed through a fail-closed policy engine before signing. Empty policy config is an error, proposals without approved policy results are refused, and approval stays in the user-facing flow.",
    shipped: [
      "Spend limit, cooldown, slippage, time-window, consensus, and privacy policies.",
      "Human approval gates for swaps, DCA, shield deposits, shield withdrawals, and missions.",
      "No-bypass unit coverage for the policy engine and agent executor path.",
    ],
    proof: [
      { label: "No-bypass evidence", href: `${GH}/blob/main/TRACKS.md#hard-constraints--checklist` },
      { label: "Evaluator brief", href: `${GH}/blob/main/EVALUATION.md#3-architecture-at-a-glance` },
    ],
  },
  {
    eyebrow: "Local AI",
    title: "QVAC moved memory, voice, and reasoning on-device",
    date: "May 2026",
    accent: "blue",
    summary:
      "The agent gained a local-first AI path: QVAC embeddings for RAG memory, Whisper speech-to-text for Telegram voice trades, text-to-speech plumbing, and a Vercel AI SDK provider backed by a Bare-runtime sidecar.",
    shipped: [
      "Semantic recall tools for facts, trade history, and similar prior trades.",
      "Telegram voice notes routed through the same approval and policy pipeline as text.",
      "A publishable ai-sdk-qvac provider shape with tool-call normalization.",
    ],
    proof: [
      { label: "QVAC hurdle log", href: `${GH}/blob/main/qvac-hurdles.md` },
      { label: "QVAC track evidence", href: `${GH}/blob/main/TRACKS.md#tracks-claimed` },
    ],
  },
  {
    eyebrow: "Private execution",
    title: "MagicBlock shielded balances became agent tools",
    date: "May 2026",
    accent: "cyan",
    summary:
      "AEGIS added a privacy route where sensitive actions can move through MagicBlock shield deposits. The private-execution path is policy-selected, visible to the agent, and disclosed with its current SDK blocker.",
    shipped: [
      "getShieldBalance, depositToShield, and withdrawFromShield as first-class tools.",
      "Privacy policy rules for thresholds and token allowlists.",
      "Verified devnet shield deposit receipts, with private transfer and withdraw blocker documented.",
    ],
    proof: [
      { label: "MagicBlock deposit tx", href: SHIELD_TX },
      { label: "Open SDK issue notes", href: `${GH}/blob/main/TRACKS.md#open-issue--withdrawspl-returns-delegationrecordinvalidaccountowner` },
    ],
  },
  {
    eyebrow: "Operator surfaces",
    title: "The agent moved from CLI demo to product surfaces",
    date: "May 2026",
    accent: "gold",
    summary:
      "AEGIS expanded into the interfaces needed to demo and operate the system: Telegram, CLI chat, MCP, browser Studio, daemon scheduling, missions, judge traces, and local surfpool execution.",
    shipped: [
      "Telegram chat, slash commands, voice, model switching, and inline approve or deny controls.",
      "Daemon and message runtime for scheduled or socket-driven autonomous turns.",
      "Local browser Studio for runs, logs, trades, signals, and strategy visibility.",
    ],
    proof: [
      { label: "README surfaces", href: `${GH}/blob/main/README.md#architecture` },
      { label: "Studio docs", href: `${GH}/blob/main/README.md#studio--local-browser-ui` },
    ],
  },
  {
    eyebrow: "Submission hardening",
    title: "The final proof became a real mainnet Zerion swap",
    date: "May 14, 2026",
    accent: "green",
    summary:
      "The Frontier proof was hardened with a public mainnet Solana swap receipt: 0.001 SOL to USDC, executed through the forked Zerion CLI path with the policy gate enabled.",
    shipped: [
      "Fixed a CLI import bug that blocked policy loading during live proof.",
      "Imported a funded Solana key as a fresh Zerion wallet for the proof path.",
      "Captured the public transaction receipt and documented the exact command path.",
    ],
    proof: [
      { label: "Mainnet swap receipt", href: SWAP_TX },
      { label: "Track proof notes", href: `${GH}/blob/main/TRACKS.md#zerion-swap-proof-the-headline-track-requirement` },
    ],
  },
];

const RECEIPTS = [
  "Checked-in project docs: README, CHANGELOG, TRACKS, EVALUATION, and the QVAC hurdle log.",
  "Public chain receipts: Solana mainnet Zerion swap and devnet MagicBlock shield deposits.",
  "Test and architecture references: no-bypass policy tests, QVAC integration tests, and tool registry docs.",
  "Agent session history was used only to reconstruct order and intent; raw private transcripts, local paths, secrets, and wallet material are not published here.",
];

export default function ChangelogPage() {
  return (
    <main className="site-shell min-h-screen bg-bg text-text-primary">
      <Nav />

      <section className="relative overflow-hidden px-4 pb-16 pt-32 sm:px-6 lg:pt-36">
        <div className="absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(ellipse_at_50%_0%,rgba(222,178,89,0.16),transparent_62%)]" />
        <div className="absolute left-[-18rem] top-28 hidden h-[30rem] w-[48rem] rotate-[16deg] border-y border-[#4f7cff16] bg-[#4f7cff08] lg:block" />

        <div className="relative mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
          <div className="min-w-0">
            <div className="hero-enter flex flex-wrap gap-2" style={{ animationDelay: "0ms" }}>
              {["Public changelog", "Verified receipts", "Forked Zerion CLI"].map((label) => (
                <span
                  key={label}
                  className="glass-chip rounded-full px-3 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.17em] text-text-muted"
                >
                  {label}
                </span>
              ))}
            </div>

            <h1
              className="headline hero-enter mt-7 max-w-[12ch] text-balance text-[clamp(3.6rem,8vw,7.6rem)] leading-[0.86]"
              style={{ animationDelay: "70ms" }}
            >
              How AEGIS got built.
            </h1>
          </div>

          <div
            className="hero-enter premium-panel rounded-[2rem] p-5 sm:p-7"
            style={{ animationDelay: "140ms" }}
          >
            <p className="text-lg leading-8 text-text-muted">
              This page turns the build history into a product changelog: what shipped,
              why it mattered for the Frontier Zerion brief, and which public receipts
              verify the claims. It intentionally omits raw local session text and
              any private wallet or environment data.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["34", "agent tools"],
                ["6", "policy families"],
                ["1", "mainnet swap proof"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-2xl border border-[#f6f0df10] bg-[#07070780] p-4">
                  <div className="font-display text-3xl font-extrabold text-aegis-gold">
                    {value}
                  </div>
                  <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-shell bg-[#080807d9]">
        <div className="section-inner">
          <Reveal>
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <span className="eyebrow">Timeline</span>
                <h2 className="headline mt-5 text-balance text-4xl leading-none md:text-6xl">
                  Milestones from fork to proof.
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-8 text-text-muted lg:justify-self-end">
                The order is product-oriented rather than transcript-oriented: foundation,
                control plane, local AI, private execution, user surfaces, and final
                mainnet evidence.
              </p>
            </div>
          </Reveal>

          <div className="mt-14 space-y-5">
            {MILESTONES.map((item, index) => (
              <Reveal key={item.title} delay={index * 55}>
                <article className="card-base grid gap-6 p-5 sm:p-6 lg:grid-cols-[0.42fr_1fr] lg:p-7">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className={`route-node flex h-11 w-11 items-center justify-center rounded-2xl border ${accentClasses[item.accent].badge}`}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <div className={`font-mono text-[0.66rem] uppercase tracking-[0.18em] ${accentClasses[item.accent].text}`}>
                          {item.eyebrow}
                        </div>
                        <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">
                          {item.date}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <h3 className="font-display text-2xl font-extrabold leading-tight text-text-primary sm:text-3xl">
                      {item.title}
                    </h3>
                    <p className="mt-4 max-w-3xl text-base leading-8 text-text-muted">
                      {item.summary}
                    </p>

                    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.58fr]">
                      <ul className="space-y-3">
                        {item.shipped.map((line) => (
                          <li key={line} className="flex gap-3 text-sm leading-7 text-text-muted">
                            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accentClasses[item.accent].dot}`} />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>

                      <div className="rounded-2xl border border-[#f6f0df10] bg-[#07070780] p-4">
                        <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-text-dim">
                          Receipts
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.proof.map((proof) => (
                            <a
                              key={proof.href}
                              href={proof.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex min-h-10 items-center rounded-full border px-3 font-mono text-[0.72rem] transition-colors duration-150 ease-out focus-ring ${accentClasses[item.accent].link}`}
                            >
                              {proof.label}
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section-shell">
        <div className="section-inner">
          <Reveal>
            <div className="premium-panel rounded-[2rem] p-6 sm:p-8 lg:p-10">
              <div className="grid gap-8 lg:grid-cols-[0.76fr_1.24fr] lg:items-start">
                <div>
                  <span className="eyebrow">Receipts</span>
                  <h2 className="headline mt-5 text-balance text-4xl leading-none md:text-5xl">
                    Public evidence, clean summary.
                  </h2>
                </div>
                <div className="grid gap-3">
                  {RECEIPTS.map((receipt) => (
                    <div
                      key={receipt}
                      className="rounded-2xl border border-[#f6f0df10] bg-[#080807b8] p-4 text-sm leading-7 text-text-muted"
                    >
                      {receipt}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <Footer />
    </main>
  );
}

const accentClasses: Record<
  string,
  { badge: string; dot: string; link: string; text: string }
> = {
  gold: {
    badge: "border-[#deb25928] bg-[#deb25910] font-mono text-[0.68rem] font-bold text-aegis-gold",
    dot: "bg-aegis-gold",
    link: "border-[#deb25928] text-aegis-gold hover:bg-[#deb25912]",
    text: "text-aegis-gold",
  },
  green: {
    badge: "border-[#57f28728] bg-[#57f28710] font-mono text-[0.68rem] font-bold text-aegis-green",
    dot: "bg-aegis-green",
    link: "border-[#57f28728] text-aegis-green hover:bg-[#57f28712]",
    text: "text-aegis-green",
  },
  blue: {
    badge: "border-[#4f7cff28] bg-[#4f7cff10] font-mono text-[0.68rem] font-bold text-aegis-blue",
    dot: "bg-aegis-blue",
    link: "border-[#4f7cff28] text-aegis-blue hover:bg-[#4f7cff12]",
    text: "text-aegis-blue",
  },
  cyan: {
    badge: "border-[#67e8f928] bg-[#67e8f910] font-mono text-[0.68rem] font-bold text-aegis-cyan",
    dot: "bg-aegis-cyan",
    link: "border-[#67e8f928] text-aegis-cyan hover:bg-[#67e8f912]",
    text: "text-aegis-cyan",
  },
};
