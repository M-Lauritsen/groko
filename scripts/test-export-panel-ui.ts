/**
 * Focused UI smoke checks for the leave-unmapped confirmation dialog.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/components/export/ExportPanel.tsx"),
  "utf8"
);

console.log("Groko export panel UI checks\n");

assert.match(
  source,
  /ref=\{leaveConfirmRef\}[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-describedby=\{leaveConfirmDescriptionId\}/,
  "leave-unmapped confirmation remains a labelled modal dialog"
);
assert.match(
  source,
  /previouslyFocused\.current = document\.activeElement[\s\S]*?focusables\(\)\[0\]\?\.focus\(\)/,
  "opening the dialog records the invoker and moves focus to an action"
);
assert.match(
  source,
  /event\.key === "Escape"[\s\S]*?closeLeaveConfirmation\(\)[\s\S]*?event\.key !== "Tab"[\s\S]*?last\.focus\(\)/,
  "Escape cancels and Tab is trapped within the dialog"
);
assert.match(
  source,
  /previouslyFocused\.current\?\.focus\?\.\(\)/,
  "closing the dialog restores focus to its invoker"
);
assert.match(
  source,
  /await copyGeneratedContent\(pendingCopyText\);\s*closeLeaveConfirmation\(\);/,
  "a successful confirmed copy closes the dialog"
);

console.log("✓ leave-unmapped dialog focus lifecycle and confirmed-copy close");
