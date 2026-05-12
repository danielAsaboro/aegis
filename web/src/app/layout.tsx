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
  title: "AEGIS — Policy-Gated Onchain Agent",
  description:
    "Autonomous onchain agent built on a forked Zerion CLI. Natural-language trading, scoped policies, human approval gates, and real Zerion-routed execution.",
  keywords: ["AEGIS", "Solana", "DeFi", "autonomous agent", "privacy", "Zerion", "MagicBlock", "trading"],
  openGraph: {
    title: "AEGIS — Policy-Gated Onchain Agent",
    description: "Natural-language trading with scoped policies, approval gates, and Zerion-routed execution.",
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
