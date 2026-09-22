import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/components/resources/ResourceForm.tsx"),
  "utf8"
);

console.log("Groko resource form UI checks\n");

assert.match(
  source,
  /if \(resource!\.useExisting && field\.existingKey\) \{[\s\S]*?<Label htmlFor=\{`ex-\$\{field\.key\}`\} required>[\s\S]*?<TextInput[\s\S]*?required/,
  "Existing identifiers remain visibly and semantically required regardless of the catalogue field.required setting"
);

console.log("✓ Existing identifier requirement is independent of field.required");
