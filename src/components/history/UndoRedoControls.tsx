"use client";

import { useEffect } from "react";
import { useProject } from "@/lib/store/project-context";
import { Button } from "@/components/ui/Field";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

/** Global Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z (and Ctrl+Y) for project undo/redo. */
export function UndoRedoKeyboard() {
  const { canUndo, canRedo, undo, redo } = useProject();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;

      // Leave native undo to focused text fields.
      if (isEditableTarget(e.target)) return;

      const wantRedo = key === "y" || (key === "z" && e.shiftKey);
      const wantUndo = key === "z" && !e.shiftKey;

      if (wantRedo && canRedo) {
        e.preventDefault();
        redo();
      } else if (wantUndo && canUndo) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  return null;
}

/** Undo / Redo buttons for shell chrome / resource list. */
export function UndoRedoControls({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { canUndo, canRedo, undo, redo } = useProject();

  const modHint =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘"
      : "Ctrl";

  return (
    <div className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!canUndo}
        onClick={undo}
        title={`Undo (${modHint}+Z)`}
        aria-label="Undo"
      >
        {compact ? "Undo" : "↶ Undo"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!canRedo}
        onClick={redo}
        title={`Redo (${modHint}+Shift+Z)`}
        aria-label="Redo"
      >
        {compact ? "Redo" : "↷ Redo"}
      </Button>
    </div>
  );
}
