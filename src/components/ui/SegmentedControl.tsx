"use client";

import React, { useCallback, useId, useRef } from "react";

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional shorter label for compact layouts */
  shortLabel?: string;
}

/**
 * Accessible segmented control using tablist semantics.
 * Arrow keys move selection; Home/End jump to ends.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className = "",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const listId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusIndex = useCallback((i: number) => {
    const el = refs.current[i];
    el?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next = (index + 1) % options.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      next = (index - 1 + options.length) % options.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      next = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      next = options.length - 1;
    } else {
      return;
    }
    onChange(options[next].value);
    focusIndex(next);
  };

  const sizeCls =
    size === "sm"
      ? "px-2.5 py-1 text-[11px]"
      : "px-3 py-1.5 text-sm";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      id={listId}
      className={`inline-flex items-center gap-0.5 rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-950 ${className}`}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-lg font-medium transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 ${sizeCls} ${
              selected
                ? "bg-white dark:bg-slate-800 text-sky-700 dark:text-sky-300 shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            {opt.shortLabel ?? opt.label}
          </button>
        );
      })}
    </div>
  );
}
