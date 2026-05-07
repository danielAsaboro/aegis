const ARCH_LINES = [
  { text: "$ aegis --show-architecture", kind: "prompt" },
  { text: "", kind: "gap" },
  { text: "┌────────────────────────────────────────────────────────┐", kind: "border" },
  { text: "│  LLM AGENT  (Claude Sonnet · Claude Opus · GPT-5)     │", kind: "layer-1" },
  { text: "│  Vercel AI SDK 6 · ToolLoopAgent · Per-user budget    │", kind: "detail" },
  { text: "└─────────────────────────┬──────────────────────────────┘", kind: "border" },
  { text: "                          │ tool calls", kind: "arrow" },
  { text: "┌─────────────────────────▼──────────────────────────────┐", kind: "border" },
  { text: "│  AEGIS ENGINE                                          │", kind: "layer-2" },
  { text: "│  policies · strategies · monitors · execution          │", kind: "detail" },
  { text: "│  MagicBlock Ephemeral Rollup (private path)            │", kind: "detail" },
  { text: "└─────────────────────────┬──────────────────────────────┘", kind: "border" },
  { text: "                          │ real tx", kind: "arrow" },
  { text: "┌─────────────────────────▼──────────────────────────────┐", kind: "border" },
  { text: "│  ZERION CLI  (forked)                                  │", kind: "layer-3" },
  { text: "│  wallet keystore · swap · bridge · analytics           │", kind: "detail" },
  { text: "└─────────────────────────┬──────────────────────────────┘", kind: "border" },
  { text: "                          │ onchain tx", kind: "arrow" },
  { text: "┌─────────────────────────▼──────────────────────────────┐", kind: "border" },
  { text: "│  SOLANA MAINNET                                        │", kind: "layer-4" },
  { text: "│  Jupiter swap router · SPL tokens · Solscan explorer  │", kind: "detail" },
  { text: "└────────────────────────────────────────────────────────┘", kind: "border" },
];

const kindColor: Record<string, string> = {
  prompt:  "#e8a030",
  gap:     "transparent",
  border:  "#1e1b24",
  "layer-1": "#c8a060",
  "layer-2": "#e8a030",
  "layer-3": "#c8a060",
  "layer-4": "#4ade80",
  detail:  "#6b6376",
  arrow:   "#4a4555",
};

export function Architecture() {
  return (
    <section id="architecture" className="relative py-28 px-6">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-16 bg-gradient-to-b from-transparent to-border" />

      <div className="max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Terminal with arch diagram */}
          <div className="terminal-window scanlines order-2 lg:order-1">
            <div className="terminal-bar">
              <div className="terminal-dot bg-[#ff5f56]" />
              <div className="terminal-dot bg-[#ffbd2e]" />
              <div className="terminal-dot bg-[#27c93f]" />
              <span className="ml-3 font-mono text-xs text-text-muted">
                aegis — architecture
              </span>
            </div>
            <div className="p-5 font-mono text-[12px] leading-[1.8] overflow-x-auto">
              {ARCH_LINES.map((line, i) => (
                <div
                  key={i}
                  className="whitespace-pre"
                  style={{ color: kindColor[line.kind] }}
                >
                  {line.text || " "}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Explanation */}
          <div className="order-1 lg:order-2">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-px w-8 bg-[#e8a030]/50" />
              <span className="font-mono text-[10px] text-[#e8a030]/70 tracking-[0.22em] uppercase">
                Architecture
              </span>
            </div>

            <h2 className="font-display text-4xl md:text-5xl font-700 text-white leading-tight mb-6">
              Four clean<br />
              layers.<br />
              <span className="text-gradient-amber">No leaks.</span>
            </h2>

            <p className="text-text-muted leading-relaxed mb-8">
              AEGIS composes three OSS foundations into one coherent
              execution stack. The LLM reasons and decides. The engine
              enforces policy. Zerion routes and executes. Solana settles.
            </p>

            {/* Layer legend */}
            <div className="space-y-3">
              {[
                { color: "#c8a060", label: "LLM Agent",    note: "Claude · GPT · QVAC local" },
                { color: "#e8a030", label: "AEGIS Engine", note: "Policies · Strategies · Monitors" },
                { color: "#c8a060", label: "Zerion CLI",   note: "Swap router · Wallet keystore" },
                { color: "#4ade80", label: "Solana",       note: "Mainnet settlement" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: item.color }}
                  />
                  <span className="font-display font-600 text-sm text-white w-28">
                    {item.label}
                  </span>
                  <span className="text-sm text-text-muted">{item.note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
