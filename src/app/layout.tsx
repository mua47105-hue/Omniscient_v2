import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/AppShell";

// Inter — the gold standard for UI/data dashboards (used by Stripe, Linear,
// Vercel). Crisp at small sizes, excellent number rendering, professional feel.
const inter = Inter({
  variable: "--inter-font",
  subsets: ["latin"],
  display: "swap",
});

// JetBrains Mono — for tabular numbers, prices, timestamps. Monospaced with
// excellent legibility; tabular-nums keeps columns aligned.
const jetbrainsMono = JetBrains_Mono({
  variable: "--jetbrains-font",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OMNISCIENT — Global Market Intelligence",
  description: "24/7 AI-powered global market intelligence. Crypto, forex, commodities, indices, stocks, IPOs/ICOs, macro economy — multi-LLM deep analysis with Telegram alerts.",
  keywords: ["market intelligence", "crypto analysis", "forex", "trading signals", "AI trading", "market analysis"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        {/* Prevent flash of light theme — force dark before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: 'document.documentElement.className="dark"' }} />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        <Providers>
          <AppShell>{children}</AppShell>
          <Toaster />
          <SonnerToaster />
        </Providers>
      </body>
    </html>
  );
}
