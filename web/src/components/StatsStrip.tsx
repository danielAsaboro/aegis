const STATS = [
  { value: "25",  label: "Agent Tools",   color: "#e8a030" },
  { value: "9",   label: "Policies",      color: "#c8a060" },
  { value: "164", label: "Tests Passing", color: "#4ade80" },
  { value: "4",   label: "LLM Models",    color: "#c8a060" },
  { value: "4",   label: "Surfaces",      color: "#a07030" },
];

export function StatsStrip() {
  return (
    <div className="relative border-y border-[#ffffff05] overflow-hidden">
      {/* Horizontal glow lines */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#e8a030]/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#c8a060]/15 to-transparent" />

      <div
        className="py-8 px-6"
        style={{
          background: "linear-gradient(to bottom, rgba(232,160,48,0.025), transparent)",
        }}
      >
        <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8 md:gap-0">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className="flex flex-col items-center text-center"
              style={{
                borderRight: i < STATS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}
            >
              <span
                className="font-display font-800 text-[2.6rem] leading-none tabular-nums"
                style={{
                  color: s.color,
                  textShadow: `0 0 30px ${s.color}50`,
                  animation: `statIn 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 80}ms both`,
                }}
              >
                {s.value}
              </span>
              <span className="mt-1.5 font-mono text-[10px] tracking-widest uppercase text-[#374151]">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
