const BUILT_WITH = [
  { label: "Solana",     href: "https://solana.com",                                                           color: "#9945FF" },
  { label: "Zerion CLI", href: "https://github.com/zeriontech/zerion-wallet-extension",                        color: "#2962EF" },
  { label: "MagicBlock", href: "https://www.magicblock.gg",                                                    color: "#e8a030" },
  { label: "QVAC",       href: "https://docs.qvac.tether.io",                                                  color: "#00b388" },
];

export function Footer() {
  return (
    <footer className="relative border-t border-border py-16 px-6">
      {/* Gradient top edge */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#e8a030]/20 to-transparent" />

      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-12 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7">
                <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-7 h-7">
                  <path
                    d="M16 2L4 8v9c0 7.18 5.12 13.89 12 15.5C22.88 30.89 28 24.18 28 17V8L16 2z"
                    fill="rgba(232,160,48,0.1)"
                    stroke="#e8a030"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M11 16l3.5 3.5L21 13"
                    stroke="#e8a030"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="font-display font-700 text-base tracking-widest text-white">
                AEGIS
              </span>
            </div>
            <p className="text-text-muted text-sm leading-relaxed max-w-xs">
              Privacy-first autonomous trading agent. Talk to your wallet.
              Policy-gated. Shielded execution.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-mono text-xs tracking-widest uppercase text-text-dim mb-4">
              Resources
            </h4>
            <ul className="space-y-2.5">
              {[
                { label: "GitHub Repository", href: "https://github.com/danielAsaboro/aegis" },
                { label: "README / Docs",     href: "https://github.com/danielAsaboro/aegis/blob/main/README.md" },
                { label: "Zerion Track",      href: "https://github.com/danielAsaboro/aegis/blob/main/TRACKS.md" },
                { label: "MagicBlock Track",  href: "https://github.com/danielAsaboro/aegis/blob/main/TRACKS.md" },
              ].map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-text-muted hover:text-[#e8a030] transition-colors duration-200"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Built with */}
          <div>
            <h4 className="font-mono text-xs tracking-widest uppercase text-text-dim mb-4">
              Built with
            </h4>
            <div className="flex flex-wrap gap-2">
              {BUILT_WITH.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-mono transition-all duration-200 hover:opacity-100 opacity-70"
                  style={{
                    borderColor: `${item.color}30`,
                    background: `${item.color}08`,
                    color: item.color,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: item.color }}
                  />
                  {item.label}
                </a>
              ))}
            </div>

            {/* Hackathon badge */}
            <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 border border-[#e8a030]/25 bg-[#e8a030]/8 rounded text-xs font-mono text-[#e8a030]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              Frontier Hackathon 2025
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-text-dim text-xs font-mono">
            © 2025 AEGIS. Open source under MIT license.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/danielAsaboro/aegis"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-muted hover:text-white transition-colors duration-200"
              aria-label="GitHub"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
            </a>
            <a
              href="https://t.me/danielAsaboro"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-muted hover:text-white transition-colors duration-200"
              aria-label="Telegram"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.48 14.47 4.53 13.54c-.645-.204-.657-.645.136-.953l10.849-4.183c.537-.194 1.006.131.831.95l.216-.106z"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
