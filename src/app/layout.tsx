import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LegalLens — Understand what you're signing",
  description:
    "Drop in any legal document. Get a plain-language summary, risk flags, and grounded Q&A. Every claim cites the exact source on the original page. Never advice. Always understanding.",
  keywords: ["legal", "document understanding", "lease", "NDA", "contract review", "plain language"],
  authors: [{ name: "LegalLens" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "LegalLens",
    description: "Understand what you're signing. Plain-language legal document summaries with clickable source citations.",
    siteName: "LegalLens",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
