import { LogoMark } from "./Nav";

const LINKS = [
  { label: "GitHub Repository", href: "https://github.com/danielAsaboro/aegis" },
  { label: "README / Docs", href: "https://github.com/danielAsaboro/aegis/blob/main/README.md" },
  { label: "Track Evidence", href: "https://github.com/danielAsaboro/aegis/blob/main/TRACKS.md" },
  { label: "Evaluation Notes", href: "https://github.com/danielAsaboro/aegis/blob/main/EVALUATION.md" },
];

const BUILT_WITH = [
  { label: "Solana", href: "https://solana.com" },
  { label: "Zerion", href: "https://zerion.io" },
  { label: "MagicBlock", href: "https://www.magicblock.gg" },
  { label: "QVAC", href: "https://docs.qvac.tether.io" },
];

export function Footer() {
  return (
    <footer className="relative border-t border-[#f6f0df10] px-4 py-14 sm:px-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#deb25944] to-transparent" />
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.1fr_0.9fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <LogoMark className="h-10 w-10" />
              <div>
                <div className="font-display text-xl font-extrabold tracking-[0.14em] text-text-primary">
                  AEGIS
                </div>
                <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-text-dim">
                  autonomous onchain agent
                </div>
              </div>
            </div>
            <p className="mt-5 max-w-sm text-sm leading-7 text-text-muted">
              A policy-gated agent built on top of the forked Zerion CLI for
              the Frontier Zerion autonomous onchain agent track.
            </p>
          </div>

          <div>
            <h4 className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-text-dim">
              Verify
            </h4>
            <ul className="mt-4 space-y-3">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center text-sm text-text-muted transition-colors duration-150 ease-out hover:text-aegis-gold focus-ring"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-text-dim">
              Built with
            </h4>
            <div className="mt-4 flex flex-wrap gap-2">
              {BUILT_WITH.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass-chip inline-flex min-h-10 items-center rounded-full px-3 font-mono text-xs text-text-muted transition-colors duration-150 ease-out hover:text-text-primary focus-ring"
                >
                  {item.label}
                </a>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-[#deb25924] bg-[#deb2590d] p-4">
              <div className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-aegis-gold">
                Frontier Hackathon 2026
              </div>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                Real transactions, scoped policies, and Zerion-routed swaps remain the judging center.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-[#f6f0df10] pt-7 text-xs text-text-dim sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono">Open source under MIT license.</p>
          <a
            href="https://t.me/danielAsaboro"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:text-aegis-gold focus-ring"
          >
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
