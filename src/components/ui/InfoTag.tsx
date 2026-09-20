"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";

export function InfoTag({
  title,
  children,
  variant = "default",
}: {
  title: string;
  children: ReactNode;
  variant?: "default" | "warning" | "success";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const tone = {
    default: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
    warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  }[variant];

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm transition hover:brightness-95 ${tone}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${title} information`}
      >
        <span aria-hidden>i</span>
        {title}
      </button>

      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={`${title} details`}
          className="absolute left-0 top-full z-30 mt-2 w-[min(28rem,82vw)] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            {title}
          </div>
          <div className="text-xs leading-5 text-slate-600 dark:text-slate-300">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
