import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-syne)", "sans-serif"],
        body: ["var(--font-dm-sans)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      colors: {
        bg: "#080708",
        surface: "#0f0d12",
        card: "#100e14",
        "card-hover": "#151220",
        border: "#1e1b24",
        "border-glow": "rgba(232,160,48,0.3)",
        aegis: {
          amber: "#e8a030",
          gold: "#c8a060",
          green: "#4ade80",
          red: "#ff4b4b",
          dim: "#c47a10",
        },
        text: {
          primary: "#ede9df",
          muted: "#6b6376",
          dim: "#2e2b35",
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        "fade-in-up": "fadeInUp 0.35s ease-out forwards",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
        "scan": "scan 8s linear infinite",
        "float": "float 6s ease-in-out infinite",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 20px rgba(232,160,48,0.1), 0 0 60px rgba(232,160,48,0.04)" },
          "50%": { boxShadow: "0 0 30px rgba(232,160,48,0.22), 0 0 80px rgba(232,160,48,0.08)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(200%)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      boxShadow: {
        "glow-amber": "0 0 20px rgba(232,160,48,0.15), 0 0 60px rgba(232,160,48,0.05)",
        "glow-gold": "0 0 20px rgba(200,160,96,0.15), 0 0 60px rgba(200,160,96,0.05)",
        "glow-green": "0 0 20px rgba(74,222,128,0.15), 0 0 60px rgba(74,222,128,0.05)",
        "terminal": "0 0 0 1px rgba(232,160,48,0.2), 0 0 40px rgba(232,160,48,0.08), 0 25px 50px rgba(0,0,0,0.5)",
      },
      backgroundImage: {
        "grid-amber": "linear-gradient(rgba(232,160,48,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(232,160,48,0.04) 1px, transparent 1px)",
        "radial-amber": "radial-gradient(ellipse at center, rgba(232,160,48,0.12) 0%, transparent 70%)",
      },
      backgroundSize: {
        "grid": "60px 60px",
      },
    },
  },
  plugins: [],
};

export default config;
