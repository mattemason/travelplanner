import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Barlow_Condensed } from "next/font/google";
import "./globals.css";

// Barlow Condensed for dates and headings; Atkinson Hyperlegible for everything else,
// chosen for readability in sunlight.
const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Trip Planner",
  description: "Day-by-day road trip plans from your saved Google Maps places",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9eeec" },
    { media: "(prefers-color-scheme: dark)", color: "#0e181a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={`${barlow.variable} ${atkinson.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
