import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Shiplog",
  description: "Entregas, verificação e discussão",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {/* Icon font (Material Symbols). display=block on purpose: with swap, icon names flash as text. */}
        {/* eslint-disable-next-line @next/next/google-font-display, @next/next/no-page-custom-font -- App Router root layout, applies to every page */}
        <link
          rel="stylesheet"
          precedence="default"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300..400,0..1,0&display=block"
        />
        {children}
      </body>
    </html>
  );
}
