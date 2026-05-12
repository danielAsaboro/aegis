const STATS = [
  { value: "Zerion", label: "wallet and execution layer", tone: "text-aegis-blue" },
  { value: "34", label: "registered agent tools", tone: "text-aegis-gold" },
  { value: "6", label: "core scoped policies", tone: "text-aegis-green" },
  { value: "164", label: "tests passed in repo run", tone: "text-aegis-gold" },
];

export function StatsStrip() {
  return (
    <section className="relative border-y border-[#f6f0df0c] bg-[#080807bf] px-4 py-5 backdrop-blur-xl sm:px-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#deb25944] to-transparent" />
      <div className="mx-auto grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className={`stat-card group rounded-2xl border border-[#f6f0df0d] bg-[#f6f0df04] px-4 py-4 transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#f6f0df07] motion-reduce:transform-none ${stat.label.includes("policy") ? "motion-delay-1" : stat.label.includes("tests") ? "motion-delay-2" : ""}`}
          >
            <div className={`font-display text-2xl font-extrabold ${stat.tone}`}>{stat.value}</div>
            <div className="mt-1 font-mono text-[0.66rem] uppercase tracking-[0.17em] text-text-dim">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
