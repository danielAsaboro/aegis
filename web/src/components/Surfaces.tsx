import { Reveal } from "./Reveal";

const SURFACES = [
  {
    label: "Telegram bot",
    command: "pnpm start",
    desc: "Voice, slash commands, inline approve and deny controls, and the same value-moving policy path.",
    status: "primary",
  },
  {
    label: "CLI REPL",
    command: "node engine/index.mjs chat",
    desc: "Terminal conversation surface with the same tool registry and approval flow.",
    status: "shipped",
  },
  {
    label: "MCP server",
    command: "aegis mcp",
    desc: "Expose AEGIS tools to Claude Code, Cursor, Codex CLI, or any MCP host.",
    status: "shipped",
  },
  {
    label: "Browser studio",
    command: "aegis --studio",
    desc: "Localhost-bound visibility into signals, strategies, agent runs, trades, and logs.",
    status: "local",
  },
  {
    label: "Judge trace",
    command: "aegis judge-trace",
    desc: "Single-screen proof of policy approve, deny, public route, and private route decisions.",
    status: "demo",
  },
  {
    label: "Live demo script",
    command: "pnpm demo --execute",
    desc: "End-to-end flow for MagicBlock shield deposit and onchain execution receipts.",
    status: "execute",
  },
];

export function Surfaces() {
  return (
    <section id="surfaces" className="section-shell bg-[#080807d9]">
      <div className="section-inner">
        <Reveal>
          <div className="grid gap-8 lg:grid-cols-[0.86fr_1.14fr] lg:items-end">
            <div>
              <span className="eyebrow">Surfaces</span>
              <h2 className="headline mt-5 text-balance text-4xl leading-none md:text-6xl">
                One agent, multiple doors.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-8 text-text-muted lg:justify-self-end">
              Each interface is a different entry point into the same guarded engine.
              The web page now makes that visible instead of hiding it in a list of features.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 overflow-hidden rounded-[2rem] border border-[#f6f0df12] bg-[#10100de6] shadow-[0_28px_90px_rgba(0,0,0,0.36)]">
          {SURFACES.map((surface, index) => (
            <Reveal key={surface.label} delay={index * 45}>
              <div className={`surface-row grid gap-4 border-b border-[#f6f0df0d] p-5 last:border-b-0 md:grid-cols-[0.7fr_0.9fr_1.25fr] md:items-center ${index % 3 === 1 ? "motion-delay-1" : index % 3 === 2 ? "motion-delay-2" : ""}`}>
                <div className="flex items-center gap-3">
                  <span className="route-node flex h-10 w-10 items-center justify-center rounded-2xl border border-[#deb25928] bg-[#deb25910] font-mono text-[0.68rem] font-bold text-aegis-gold">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-extrabold text-text-primary">
                      {surface.label}
                    </h3>
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-text-dim">
                      {surface.status}
                    </span>
                  </div>
                </div>
                <code className="block overflow-x-auto rounded-2xl border border-[#f6f0df10] bg-[#070707] px-4 py-3 font-mono text-[0.78rem] text-aegis-cyan">
                  $ {surface.command}
                </code>
                <p className="text-sm leading-7 text-text-muted">{surface.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <div className="mt-8 rounded-[2rem] border border-[#57f28726] bg-[#57f2870a] p-5 md:flex md:items-center md:justify-between md:gap-6">
            <div>
              <div className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-aegis-green">
                reusable artifact
              </div>
              <h3 className="mt-2 font-display text-2xl font-extrabold text-text-primary">
                ai-sdk-qvac provider
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-text-muted">
                A community provider for using Tether QVAC with Vercel AI SDK workflows.
              </p>
            </div>
            <a
              href="https://www.npmjs.com/package/ai-sdk-qvac"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex min-h-11 items-center rounded-2xl border border-[#57f28733] px-4 font-mono text-sm font-bold uppercase tracking-[0.12em] text-aegis-green transition-colors duration-150 ease-out hover:bg-[#57f28712] focus-ring md:mt-0"
            >
              View package
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
