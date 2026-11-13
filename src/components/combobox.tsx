"use client";
// A filter dropdown: a button that opens a list of options, with a search box for long lists.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./ui";

export interface ComboOption {
  value: string;
  label: string;
}

// Accent- and case-insensitive, so "joao" finds "João".
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function Combobox(props: {
  // The filter's name: the button text while nothing is chosen.
  label: string;
  icon: string;
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  // The first entry, which clears the filter ("Qualquer status").
  all: string;
  search?: boolean;
}) {
  const { label, value, search = false } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const focusable = useRef<HTMLInputElement & HTMLUListElement>(null);

  const every = [{ value: "", label: props.all }, ...props.options];
  const items = query ? every.filter((o) => fold(o.label).includes(fold(query))) : every;
  const selected = props.options.find((o) => o.value === value);
  const activeId = items[active] ? `${id}-${active}` : undefined;

  const show = () => {
    setQuery("");
    setActive(Math.max(0, every.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const choose = (o: ComboOption) => {
    if (o.value !== value) props.onChange(o.value);
    close(true);
  };

  // Near the right edge, open towards the left so the list stays on screen.
  useLayoutEffect(() => {
    if (pop.current && pop.current.getBoundingClientRect().right > window.innerWidth - 16) pop.current.classList.add("end");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    focusable.current?.focus();
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const keys = (e: KeyboardEvent) => {
    const last = items.length - 1;
    const move: Record<string, () => void> = {
      ArrowDown: () => setActive((a) => Math.min(last, a + 1)),
      ArrowUp: () => setActive((a) => Math.max(0, a - 1)),
      Home: () => setActive(0),
      End: () => setActive(Math.max(0, last)),
      Enter: () => items[active] && choose(items[active]),
      Escape: () => close(true),
    };
    if (e.key === "Tab") return close(false);
    if (!move[e.key]) return;
    e.preventDefault();
    move[e.key]();
  };

  return (
    <div className="combo" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`combo-btn ${value ? "on" : ""}`}
        aria-label={`${label}: ${selected?.label ?? props.all}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
      >
        <Icon name={props.icon} />
        <span className="combo-v">{selected?.label ?? label}</span>
        <Icon name="expand_more" className="chev" />
      </button>
      {open && (
        <div className="combo-pop" ref={pop}>
          {search && (
            <div className="combo-q">
              <Icon name="search" />
              <input
                ref={focusable}
                role="combobox"
                aria-label={`Buscar ${label.toLowerCase()}`}
                aria-expanded
                aria-controls={`${id}-list`}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                placeholder="Buscar…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={keys}
              />
            </div>
          )}
          <ul
            ref={search ? undefined : focusable}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            tabIndex={search ? -1 : 0}
            aria-activedescendant={search ? undefined : activeId}
            onKeyDown={search ? undefined : keys}
          >
            {items.map((o, i) => (
              <li
                key={o.value || "all"}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={i === active ? "act" : ""}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <span>{o.label}</span>
                {o.value === value && <Icon name="check" />}
              </li>
            ))}
          </ul>
          {items.length === 0 && <p className="combo-none">Nada encontrado.</p>}
        </div>
      )}
    </div>
  );
}
