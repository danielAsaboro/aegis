import { Reveal } from "./Reveal";

const STEPS = [
  {
    num: "01",
    label: "Intent becomes a proposal",
    desc: "Telegram, CLI, MCP, and the local studio all converge on the same agent core. The model can reason, but value movement is represented as a typed proposal.",
    accent: "bg-aegis-blue",
  },
  {
    num: "02",
    label: "Policy stack evaluates first",
    desc: "Spend limit, cooldown, price guard, time window, consensus, and privacy policies run before signing. Empty or missing policy config fails closed.",
    accent: "bg-aegis-gold",
  },
  {
    num: "03",
    label: "Approval keeps humans in path",
    desc: "Any swap, DCA tick, bridge, or shield deposit requires approval at the interaction surface. There is no hidden autonomous signer path.",
    accent: "bg-aegis-green",
  },
  {
    num: "04",
    label: "Zerion executes the real action",
    desc: "Approved actions route through the forked Zerion CLI and Zerion API for wallet operations and swaps, then settle onchain.",
    accent: "bg-aegis-amber",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="section-shell">
      <div className="section-inner">
        <Reveal>
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <span className="eyebrow">Policy-first autonomy</span>
              <h2 className="headline mt-5 text-balance text-4xl leading-none md:text-6xl">
                Autonomy with a hard boundary.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-8 text-text-muted lg:justify-self-end">
              The bounty wants real transactions, not simulations, and scoped controls,
              not god-mode agents. AEGIS makes that constraint the core product loop.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-4 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal key={step.num} delay={index * 80}>
              <article className="card-base group h-full p-5 transition-transform duration-150 ease-out hover:-translate-y-1 motion-reduce:transform-none">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[0.72rem] uppercase tracking-[0.2em] text-text-dim">
                    {step.num}
                  </span>
                  <span className={`h-2 w-10 rounded-full ${step.accent}`} />
                </div>
                <h3 className="mt-12 font-display text-2xl font-extrabold leading-tight text-text-primary">
                  {step.label}
                </h3>
                <p className="mt-4 text-sm leading-7 text-text-muted">{step.desc}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
