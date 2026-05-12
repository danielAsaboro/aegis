import { Reveal } from "./Reveal";

const LAYERS = [
  {
    name: "Interaction surfaces",
    detail: "Telegram, CLI, MCP, local studio",
    color: "border-aegis-blue/40 text-aegis-blue",
  },
  {
    name: "AEGIS engine",
    detail: "agent loop, tools, memory, strategies",
    color: "border-aegis-gold/40 text-aegis-gold",
  },
  {
    name: "Policy and approval gate",
    detail: "scoped controls before signing",
    color: "border-aegis-green/40 text-aegis-green",
  },
  {
    name: "Forked Zerion CLI",
    detail: "wallet, portfolio, quotes, swaps",
    color: "border-aegis-blue/40 text-aegis-blue",
  },
  {
    name: "Settlement paths",
    detail: "Solana mainnet and MagicBlock shield tools",
    color: "border-aegis-amber/40 text-aegis-amber",
  },
];

const INVARIANTS = [
  "Swaps continue to route through Zerion API.",
  "Fund-moving actions require policy result and approval.",
  "MagicBlock privacy remains a policy-selected path.",
  "No replacement execution backend is introduced.",
];

export function Architecture() {
  return (
    <section id="architecture" className="section-shell">
      <div className="section-inner">
        <div className="grid gap-12 lg:grid-cols-[1.06fr_0.94fr] lg:items-center">
          <Reveal>
            <div className="premium-panel rounded-[2rem] p-4 md:p-6">
              <span aria-hidden="true" className="ambient-orbit -left-20 top-20 h-64 w-64" />
              <span aria-hidden="true" className="ambient-orbit -bottom-16 right-10 h-44 w-44 motion-delay-3" />
              <div className="relative z-10 space-y-3">
                {LAYERS.map((layer, index) => (
                  <div key={layer.name} className="relative">
                    {index < LAYERS.length - 1 && (
                      <span className="absolute left-6 top-[3.75rem] h-5 w-px bg-[#deb2592b]" />
                    )}
                    <div className={`rounded-2xl border bg-[#080807cc] p-4 ${layer.color}`}>
                      <div className="grid grid-cols-[2.5rem_1fr] items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-current bg-[#f6f0df08] font-mono text-[0.7rem] font-bold opacity-90">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div>
                          <h3 className="font-display text-lg font-extrabold text-text-primary">
                            {layer.name}
                          </h3>
                          <p className="mt-1 text-sm text-text-muted">{layer.detail}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div>
              <span className="eyebrow">Architecture</span>
              <h2 className="headline mt-5 text-balance text-4xl leading-none md:text-6xl">
                A forked wallet layer, not a fantasy executor.
              </h2>
              <p className="mt-6 text-base leading-8 text-text-muted">
                The design is intentionally boring where money moves. AEGIS can add
                intelligence, policy, and interfaces, but execution still passes through
                Zerion CLI and the Zerion API.
              </p>

              <div className="mt-8 space-y-3">
                {INVARIANTS.map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-[#f6f0df10] bg-[#f6f0df05] p-3">
                    <span className="route-node mt-1 inline-block h-2.5 w-2.5 rounded-full bg-aegis-green text-aegis-green shadow-glow-green" />
                    <span className="text-sm leading-6 text-text-muted">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
