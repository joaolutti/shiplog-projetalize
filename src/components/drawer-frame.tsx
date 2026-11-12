"use client";
/**
 * The side panel's frame: a dialog on the right over a dimmed page. It's opened by a `?s=` URL
 * param (so it's server-rendered and the back button closes it); Esc, the close button or a click
 * outside go back to the URL without it.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./ui";

export function DrawerFrame({ closeHref, labelledBy, children }: { closeHref: string; labelledBy: string; children: ReactNode }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const close = (e: KeyboardEvent) => e.key === "Escape" && router.replace(closeHref, { scroll: false });
    document.addEventListener("keydown", close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = overflow;
    };
  }, [closeHref, router]);

  return (
    <>
      <Link className="drawer-scrim" href={closeHref} scroll={false} replace aria-label="Fechar" tabIndex={-1} />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={panel}>
        <Link className="icon-btn drawer-close" href={closeHref} scroll={false} replace aria-label="Fechar">
          <Icon name="close" />
        </Link>
        {children}
      </div>
    </>
  );
}
