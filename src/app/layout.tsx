import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import ConnectionFlash from "@/components/ConnectionFlash";
import Shell from "@/components/Shell";
import { Toaster } from "@/components/Toaster";
import { SITE } from "@/lib/site";

// next/font/google does not list Proxima Nova, and the Google stylesheet
// returns 403 when a page sends a Referer. These are the latin 400/600/700 cuts.
// Weight 500 is not served.
const proximaNova = localFont({
  src: [
    { path: "./fonts/proxima-nova-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/proxima-nova-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/proxima-nova-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "'Proxima Nova'" }],
});

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s — ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4490c",
  // Shrink the layout with the on-screen keyboard so h-dvh composers stay above it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${proximaNova.className} ${geistMono.variable}`}>
      <body className={`${geistMono.variable} font-sans antialiased`}>
        <Suspense fallback={<div className="min-h-dvh bg-ground" />}>
          <Shell>{children}</Shell>
        </Suspense>
        <Suspense fallback={null}>
          <ConnectionFlash />
        </Suspense>
        <Toaster />
      </body>
    </html>
  );
}
