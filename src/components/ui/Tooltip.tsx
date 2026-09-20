"use client";

import { cloneElement, useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

const TOOLTIP_DELAY = 1500;

export function Tooltip({
  children,
  content,
}: {
  children: ReactElement<{ "aria-describedby"?: string }>;
  content: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function showAfterDelay() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={showAfterDelay}
      onMouseLeave={hide}
      onFocusCapture={showAfterDelay}
      onBlurCapture={hide}
    >
      {cloneElement(children, {
        "aria-describedby": open ? tooltipId : undefined,
      })}
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-max max-w-64 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-normal text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          {content}
        </span>
      )}
    </span>
  );
}