import { Reveal } from "./Reveal";

const FEATURES = [
  {
    label: "Natural language agent",
    desc: "Run the same core from Telegram or the CLI. Ask for portfolio checks, swaps, DCA plans, shields, and trade history without changing surfaces.",
    tag: "agent core",
    tone: "text-aegis-gold",
  },
  {
    label: "Forked Zerion execution",
    desc: "AEGIS extends Zerion CLI instead of replacing it. Wallet creation, portfolio reads, quotes, swaps, and API-routed execution stay on the Zerion layer.",
    tag: "required path",
    tone: "text-aegis-blue",
  },
  {
    label: "Scoped policies",
    desc: "Spend limits, cooldown, time window, price guard, consensus, and privacy checks compose with AND semantics before any value-moving action signs.",
    tag: "fail closed",
    tone: "text-aegis-green",
  },
  {
    label: "Human approval gates",
    desc: "The agent can prepare a transaction, but swap execution remains approval-gated through the visible interaction surface.",
    tag: "no god mode",
    tone: "text-aegis-amber",
  },
  {
    label: "MagicBlock shield tools",
    desc: "Deposit, withdraw, and shield balance tools are available to the agent and follow the same policy and approval path as public routes.",
    tag: "private path",
    tone: "text-aegis-cyan",
  },
  {
    label: "QVAC local intelligence",
    desc: "Local speech and memory tooling reduce cloud exposure while preserving the same tool registry and structured decision flow.",
    tag: "local first",
    tone: "text-aegis-green",
  },
];

function FeatureIcon({ index, tone }: { index: number; tone: string }) {
  return (
    <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-[#f6f0df12] bg-[#f6f0df06] ${tone}`}>
      <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {index === 0 && <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />}
        {index === 1 && <path d="M4 7h16M4 12h10M4 17h16" />}
        {index === 2 && <path d="M12 3 4 7v6c0 5 3.4 8.6 8 9 4.6-.4 8-4 8-9V7l-8-4Z" />}
        {index === 3 && <path d="M9 12 11.2 14.2 16 9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />}
        {index === 4 && <path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5V11Z" />}
        {index === 5 && <path d="M12 2v20M4.5 6.5h15M4.5 17.5h15M6 12h12" />}
      </svg>
    </div>
  );
}

export function FeaturesGrid() {
  return (
    <section id="features" className="section-shell bg-[#0b0b09cc]">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(120deg,transparent_0_18%,rgba(87,242,135,0.045)_18.1%_18.3%,transparent_18.5%_100%)]" />
      <div className="section-inner">
        <Reveal>
          <div className="max-w-3xl">
            <span className="eyebrow">What ships</span>
            <h2 className="headline mt-5 text-balance text-4xl leading-none md:text-6xl">
              Built for judges to verify, and builders to fork.
            </h2>
          </div>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.label} delay={index * 60}>
              <article className="card-base group h-full p-5 transition-transform duration-150 ease-out hover:-translate-y-1 motion-reduce:transform-none">
                <div className="flex items-start justify-between gap-4">
                  <FeatureIcon index={index} tone={feature.tone} />
                  <span className="rounded-full border border-[#f6f0df12] bg-[#f6f0df06] px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-text-dim">
                    {feature.tag}
                  </span>
                </div>
                <h3 className="mt-7 font-display text-xl font-extrabold leading-tight text-text-primary">
                  {feature.label}
                </h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">{feature.desc}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
