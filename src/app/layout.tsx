import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProviders } from "../providers/authProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Runes AI — LaTeX editor with AI prose suggestions",
    template: "%s | Runes AI",
  },
  description:
    "Runes AI is a browser LaTeX editor with a Monaco writing surface, AI prose suggestions you review before they land in your source, and PDF compilation.",
};

export const viewport: Viewport = {
  themeColor: "#FAFAF7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The next/font variables have to be declared on <html>: the design tokens in
    // globals.css reference them from :root, and an unresolvable var() silently
    // turns `font-mono` back into the inherited (serif) font.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <AuthProviders>{children}</AuthProviders>
      </body>
    </html>
  );
}
