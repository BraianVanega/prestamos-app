import type { Metadata } from "next";
import { DM_Mono, Geist } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

// Cifras y signos de los montos en DM Mono también dentro del texto en Geist
// (inputs, etiquetas, frases): el unicode-range hace que el resto use Geist.
const cifras = localFont({
  variable: "--font-cifras",
  src: [
    { path: "../fonts/dm-mono-400.woff2", weight: "400" },
    { path: "../fonts/dm-mono-500.woff2", weight: "500" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0024-0025, U+002C, U+002E, U+0030-0039, U+2212" }],
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Cierre & Reparto",
  description: "Gestión de préstamos",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${dmMono.variable} ${cifras.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
