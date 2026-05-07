import type { Metadata } from "next";
import { Syne, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AEGIS — Autonomous Trading Agent",
  description:
    "Privacy-first autonomous trading agent built on Zerion CLI and MagicBlock. Talk to your wallet in natural language. Every trade policy-gated. Every sensitive swap shielded from front-runners.",
  keywords: ["AEGIS", "Solana", "DeFi", "autonomous agent", "privacy", "Zerion", "MagicBlock", "trading"],
  openGraph: {
    title: "AEGIS — Autonomous Trading Agent",
    description: "Talk to your wallet in natural language. Every trade policy-gated, shielded from front-runners.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-body bg-bg text-text-primary antialiased">
        <div className="noise-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
