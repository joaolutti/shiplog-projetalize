"use client";
/**
 * The side panel's frame: a dialog on the right over a dimmed page. It's opened by a `?s=` URL
 * param (so it's server-rendered and the back button closes it); Esc, the close button or a click
 * outside slide it out first, then go back to the URL without it.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./ui";

export function DrawerFrame({ closeHref, labelledBy, children }: { closeHref: string; labelledBy: string; children: ReactNode }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  // The links still carry the href (middle click, no JS); a plain click animates out instead.
  const close = (e: MouseEvent) => {
    e.preventDefault();
    setClosing(true);
  };

  useEffect(() => {
    panel.current?.focus();
    const close = (e: KeyboardEvent) => e.key === "Escape" && setClosing(true);
    document.addEventListener("keydown", close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <>
      <Link className={`drawer-scrim ${closing ? "out" : ""}`} href={closeHref} scroll={false} replace aria-label="Fechar" tabIndex={-1} onClick={close} />
      <div
        className={`drawer ${closing ? "out" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={panel}
        onAnimationEnd={(e) => closing && e.target === e.currentTarget && router.replace(closeHref, { scroll: false })}
      >
        <Link className="icon-btn drawer-close" href={closeHref} scroll={false} replace aria-label="Fechar" onClick={close}>
          <Icon name="close" />
        </Link>
        {children}
      </div>
    </>
  );
}
