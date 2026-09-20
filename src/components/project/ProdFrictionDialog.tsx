"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Environment } from "@/lib/schema/types";
import { tierShortLabel } from "@/lib/schema/environments";
import {
  PROD_FRICTION_COPY,
  type ProdFrictionVariant,
} from "@/lib/store/prod-friction";
import { Badge, Button } from "@/components/ui/Field";

/**
 * Extra confirm when active Environment is Prod.
 * Focus trap + Esc → Cancel (same a11y pattern as starter dialog).
 */
export function ProdFrictionDialog({
  environment,
  variant,
  onReplace,
  onMerge,
  onCancel,
  showMerge = true,
}: {
  environment: Environment;
  variant: ProdFrictionVariant;
  onReplace: () => void;
  onMerge?: () => void;
  onCancel: () => void;
  /** When false, only Replace on Prod + Cancel (e.g. empty canvas). */
  showMerge?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    if (!root) return;

    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);

    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused.current?.focus?.();
    };
  }, [onCancel]);

  const body =
    variant === "starter"
      ? PROD_FRICTION_COPY.starterBody
      : PROD_FRICTION_COPY.importBody;

  const mergeLabel =
    variant === "starter"
      ? PROD_FRICTION_COPY.mergeStarterLabel
      : PROD_FRICTION_COPY.mergeImportLabel;

  // Render Prod emphasis in body (Uxis uses **Prod**)
  const bodyNodes = body.split("Prod").reduce<ReactNode[]>(
    (acc, part, i, arr) => {
      acc.push(part);
      if (i < arr.length - 1) {
        acc.push(
          <strong key={`prod-${i}`} className="font-semibold">
            Prod
          </strong>
        );
      }
      return acc;
    },
    []
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-rose-300 dark:border-rose-800 p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3
            id={titleId}
            className="text-base font-semibold text-rose-900 dark:text-rose-100"
          >
            {PROD_FRICTION_COPY.title}
          </h3>
          <Badge tone="amber">
            Tier: <strong className="font-semibold">{tierShortLabel(environment)}</strong>
          </Badge>
        </div>
        <p
          id={bodyId}
          className="text-sm text-slate-700 dark:text-slate-300 mb-4 leading-relaxed"
        >
          {bodyNodes}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="danger" size="sm" onClick={onReplace}>
            {PROD_FRICTION_COPY.replaceLabel}
          </Button>
          {showMerge && onMerge && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onMerge}
            >
              {mergeLabel}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {PROD_FRICTION_COPY.cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
