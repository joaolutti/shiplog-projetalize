import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "./actions";
import { getViewer } from "@/lib/auth/viewer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shiplog",
  description: "Entregas, verificação e discussão",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-border">
          <nav className="mx-auto flex w-full max-w-4xl items-center gap-5 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold text-foreground">
              Shiplog
            </Link>
            {/* The viewer is read per request, so the menu streams in behind the static shell. */}
            <Suspense fallback={null}>
              <ViewerMenu />
            </Suspense>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}

async function ViewerMenu() {
  const viewer = await getViewer();
  if (!viewer) return null;
  return (
    <>
      <Link href="/" className="text-muted hover:text-foreground">
        Entregas
      </Link>
      {viewer.role === "lead" && (
        <Link href="/unclaimed" className="text-muted hover:text-foreground">
          Sem responsável
        </Link>
      )}
      <Link href="/settings" className="text-muted hover:text-foreground">
        Configurações
      </Link>
      <form action={signOutAction} className="ml-auto flex items-center gap-3">
        <span className="text-muted">{viewer.name}</span>
        <button type="submit" className="text-muted hover:text-foreground">
          Sair
        </button>
      </form>
    </>
  );
}
