import { Reveal } from "./Reveal";

const STEPS = [
  {
    num: "01",
    label: "Signal Detected",
    desc: "Price monitors, portfolio watchers, schedulers, and whale trackers emit typed signals onto the event bus. Strategies subscribe and produce a TradeProposal.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
    ),
    color: "#e8a030",
  },
  {
    num: "02",
    label: "Policy Gate",
    desc: "8 composable policies evaluate the proposal in sequence. Fail-closed: empty config = rejected. No policy stack = no trade. The engine never reaches execution without approval.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
      </svg>
    ),
    color: "#c8a060",
  },
  {
    num: "03",
    label: "Shielded Execution",
    desc: "Approved trades route through Zerion's swap router (public) or MagicBlock's Ephemeral Rollup (private). Your balance and intent stay dark until settlement on Solana mainnet.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
    color: "#4ade80",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-28 px-6">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-20 bg-gradient-to-b from-transparent via-[#1e1b24] to-transparent" />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <Reveal className="mb-20 text-center">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="h-px w-8 bg-[#e8a030]/50" />
            <span className="font-mono text-[10px] text-[#e8a030]/70 tracking-[0.22em] uppercase">
              How it works
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-800 text-white leading-tight">
            Signal → Gate → Execute
          </h2>
          <p className="mt-4 text-[#4b4556] max-w-md mx-auto leading-relaxed text-[0.95rem]">
            Every trade passes through three hardened layers before a single
            lamport moves.
          </p>
        </Reveal>

        {/* Steps */}
        <div className="relative grid md:grid-cols-3 gap-10 md:gap-6">

          {/* Connecting line */}
          <div className="hidden md:block absolute top-[46px] left-[calc(16.66%+28px)] right-[calc(16.66%+28px)] h-px">
            <div
              className="h-full"
              style={{
                background: "linear-gradient(90deg, rgba(232,160,48,0.4) 0%, rgba(200,160,96,0.4) 50%, rgba(74,222,128,0.4) 100%)",
              }}
            />
            {/* Arrow mid-point */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#e8a030]"
              style={{ boxShadow: "0 0 10px rgba(232,160,48,0.6)" }}
            />
          </div>

          {STEPS.map((step, i) => (
            <Reveal key={step.num} delay={i * 120}>
              <div className="relative text-center md:text-left">
                {/* Icon circle */}
                <div
                  className="w-[52px] h-[52px] rounded-full flex items-center justify-center mb-6 mx-auto md:mx-0"
                  style={{
                    border: `1px solid ${step.color}35`,
                    background: `${step.color}0d`,
                    boxShadow: `0 0 24px ${step.color}18`,
                    color: step.color,
                  }}
                >
                  {step.icon}
                </div>

                {/* Step number */}
                <div
                  className="font-mono text-[10px] tracking-[0.28em] mb-2"
                  style={{ color: `${step.color}60` }}
                >
                  {step.num}
                </div>

                {/* Label */}
                <h3 className="font-display text-xl font-700 text-[#ede9df] mb-3">
                  {step.label}
                </h3>

                {/* Description */}
                <p className="text-[#4b4556] text-sm leading-relaxed">
                  {step.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
