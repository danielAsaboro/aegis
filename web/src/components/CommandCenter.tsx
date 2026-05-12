import { Reveal } from "./Reveal";

const POLICY_ROWS = [
  ["spend-limit", "passed"],
  ["cooldown", "passed"],
  ["time-window", "active"],
  ["privacy", "routes private when required"],
  ["approval", "human required"],
] as const;

const ROUTE_STEPS = [
  { label: "Agent proposal", detail: "natural language intent" },
  { label: "Policy kernel", detail: "fail-closed evaluation" },
  { label: "Zerion CLI", detail: "wallet + swap execution" },
  { label: "Solana", detail: "onchain settlement" },
];

export function CommandCenter() {
  return (
    <section id="demo" className="section-shell overflow-hidden">
      <div className="absolute inset-x-0 top-20 h-px bg-gradient-to-r from-transparent via-[#deb25933] to-transparent" />
      <div className="section-inner">
        <div className="grid gap-10 lg:grid-cols-[0.84fr_1.16fr] lg:items-end">
          <Reveal>
            <div>
              <span className="eyebrow">Product demo</span>
              <h2 className="headline mt-5 max-w-2xl text-balance text-4xl leading-[0.98] md:text-6xl">
                The agent can propose. The policy gate decides.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-text-muted">
                AEGIS is not a chatbot wrapped around a wallet. Every value-moving tool call
                becomes a typed proposal, passes the scoped policy stack, then routes through
                the forked Zerion CLI for real execution.
              </p>
            </div>
          </Reveal>

          <Reveal delay={90}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Tool surface", "34 tools"],
                ["Policy mode", "fail-closed"],
                ["Approval", "required"],
                ["Swap route", "Zerion API"],
              ].map(([label, value]) => (
                <div key={label} className="glass-chip rounded-2xl px-4 py-3">
                  <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-text-dim">
                    {label}
                  </div>
                  <div className="mt-2 font-display text-lg font-bold text-text-primary">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        <Reveal delay={140}>
          <div className="premium-panel mt-12 rounded-[2rem] p-3 md:p-5">
            <span aria-hidden="true" className="ambient-orbit -right-14 top-10 h-56 w-56" />
            <span aria-hidden="true" className="ambient-orbit -bottom-20 left-1/3 h-72 w-72 motion-delay-2" />
            <div className="relative z-10 grid gap-4 lg:grid-cols-[0.95fr_1.2fr_0.86fr]">
              <div className="rounded-[1.35rem] border border-[#f6f0df12] bg-[#080807cc] p-4">
                <div className="flex items-center justify-between border-b border-[#f6f0df0d] pb-4">
                  <div>
                    <div className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-aegis-gold">
                      Request
                    </div>
                    <div className="mt-1 font-display text-lg font-bold text-text-primary">
                      Rebalance intent
                    </div>
                  </div>
                  <span className="rounded-full border border-[#57f28733] bg-[#57f28712] px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-aegis-green">
                    armed
                  </span>
                </div>

                <div className="mt-4 space-y-3 font-mono text-[0.76rem] leading-6">
                  <div className="rounded-2xl bg-[#f6f0df08] p-3 text-text-primary">
                    &quot;Move idle SOL into USDC only if the safe-sol policy approves.&quot;
                  </div>
                  <div className="text-text-muted">
                    tool: <span className="text-aegis-cyan">getSwapQuote</span>
                  </div>
                  <div className="text-text-muted">
                    next: <span className="text-aegis-amber">executeSwap requires approval</span>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[1.35rem] border border-[#deb25924] bg-[#0b0b09e6] p-4">
                <div className="scan-beam absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-[#deb25924] to-transparent" />
                <div className="relative z-10">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-aegis-gold">
                        Policy kernel
                      </div>
                      <div className="mt-1 font-display text-2xl font-extrabold text-text-primary">
                        no bypass path
                      </div>
                    </div>
                    <div className="rounded-full border border-[#f6f0df12] bg-[#f6f0df06] px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.18em] text-text-muted">
                      AND semantics
                    </div>
                  </div>

                  <div className="mt-5 grid gap-2">
                    {POLICY_ROWS.map(([name, state], index) => (
                      <div
                        key={name}
                        className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-[#f6f0df0d] bg-[#f6f0df05] px-3 py-2.5"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`route-node inline-block h-2.5 w-2.5 rounded-full ${
                              index === POLICY_ROWS.length - 1 ? "bg-aegis-amber" : "bg-aegis-green"
                            }`}
                          />
                          <span className="font-mono text-[0.77rem] text-text-primary">
                            {name}
                          </span>
                        </div>
                        <span className="text-right font-mono text-[0.68rem] uppercase tracking-[0.13em] text-text-dim">
                          {state}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[1.35rem] border border-[#f6f0df12] bg-[#080807cc] p-4">
                <div className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-aegis-gold">
                  Route
                </div>
                <div className="mt-1 font-display text-lg font-bold text-text-primary">
                  execution ladder
                </div>

                <div className="mt-5 space-y-3">
                  {ROUTE_STEPS.map((step, index) => (
                    <div key={step.label} className="relative flex gap-3">
                      {index < ROUTE_STEPS.length - 1 && (
                        <span className="absolute left-[0.43rem] top-6 h-9 w-px bg-[#deb25930]" />
                      )}
                      <span className={`route-node mt-1 inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-[#deb25966] bg-[#deb2591f] text-aegis-gold ${index % 2 === 1 ? "motion-delay-2" : ""}`} />
                      <span>
                        <span className="block font-display text-sm font-bold text-text-primary">
                          {step.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-text-muted">
                          {step.detail}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-2xl border border-[#4f7cff33] bg-[#4f7cff10] p-3">
                  <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-aegis-blue">
                    Private route
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    MagicBlock shield tools are first-class agent tools and use the same approval
                    and policy path.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
