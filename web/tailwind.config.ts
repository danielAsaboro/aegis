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
        bg: "#070707",
        surface: "#101112",
        card: "#141412",
        "card-hover": "#1b1b18",
        border: "#2a2822",
        "border-glow": "rgba(222,178,89,0.34)",
        aegis: {
          amber: "#deb259",
          gold: "#f2cf7a",
          green: "#57f287",
          red: "#ff6b5f",
          blue: "#4f7cff",
          cyan: "#67e8f9",
          ink: "#070707",
          dim: "#9a6a28",
        },
        text: {
          primary: "#f6f0df",
          muted: "#a69c88",
          dim: "#6e6656",
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
        "glow-amber": "0 0 24px rgba(222,178,89,0.18), 0 0 80px rgba(222,178,89,0.08)",
        "glow-gold": "0 0 20px rgba(242,207,122,0.16), 0 0 64px rgba(242,207,122,0.07)",
        "glow-green": "0 0 20px rgba(87,242,135,0.15), 0 0 60px rgba(87,242,135,0.05)",
        "terminal": "0 0 0 1px rgba(222,178,89,0.2), 0 0 42px rgba(222,178,89,0.08), 0 28px 70px rgba(0,0,0,0.55)",
      },
      backgroundImage: {
        "grid-amber": "linear-gradient(rgba(222,178,89,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(222,178,89,0.05) 1px, transparent 1px)",
        "radial-amber": "radial-gradient(ellipse at center, rgba(222,178,89,0.13) 0%, transparent 70%)",
      },
      backgroundSize: {
        "grid": "60px 60px",
      },
    },
  },
  plugins: [],
};

export default config;
