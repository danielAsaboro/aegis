import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        'paper-edge': 'var(--paper-edge)',
        ink: 'var(--ink)',
        graphite: 'var(--graphite)',
        mint: 'var(--mint)',
        peach: 'var(--peach)',
        blush: 'var(--blush)',
        sky: 'var(--sky)',
        butter: 'var(--butter)',
        lavender: 'var(--lavender)',
      },
      fontFamily: {
        display: ['"Excalifont"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Geist"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        hand: ['"Caveat"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
