"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type PickerOption = { value: string; label: string; count: number };

/**
 * A dropdown styled to match the board, replacing the browser's own <select> popup
 * (which can't be themed and shows chunky scrollbars on Windows). It follows the
 * "select-only combobox" pattern: focus stays on the button, arrow keys move a
 * highlight, Enter/Space picks, Escape closes. While it is open an invisible layer
 * covers the page, so tapping elsewhere only closes it and never presses what's behind.
 */
export default function CompanyPicker({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId();
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selected];

  const show = () => {
    setActive(selected);
    setOpen(true);
  };
  const hide = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const pick = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    hide(true);
  };

  // keep the highlighted option on screen when moving with the keyboard
  useEffect(() => {
    if (open) (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(active);
        break;
      case "Escape":
        e.preventDefault();
        hide(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div className="picker">
      <button
        ref={button}
        type="button"
        role="combobox"
        className={`picker-btn${value ? " on" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className="picker-value">{current?.label}</span>
        <svg className="picker-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="picker-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <ul ref={list} className="picker-list" id={`${uid}-list`} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value || "all"}
              id={optionId(i)}
              role="option"
              aria-selected={i === selected}
              className={`picker-opt${i === active ? " active" : ""}${i === selected ? " sel" : ""}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <svg className="picker-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span className="picker-label">{o.label}</span>
              <span className="picker-count">{o.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
