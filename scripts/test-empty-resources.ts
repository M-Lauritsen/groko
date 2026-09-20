/**
 * Smoke tests: Uxis empty-state copy (Develops #3).
 */
import assert from "node:assert/strict";
import {
  EMPTY_RESOURCES_COPY,
  emptyResourcesBody,
  emptyResourcesTitle,
} from "../src/lib/store/empty-resources";

console.log("Azure TF Builder — empty resources copy smoke test\n");

{
  assert.equal(
    EMPTY_RESOURCES_COPY.listTitle,
    "No resources in this Environment yet."
  );
  assert.equal(
    EMPTY_RESOURCES_COPY.graphTitle,
    "Nothing to show for this tier."
  );
  assert.equal(EMPTY_RESOURCES_COPY.primaryAddLabel, "Add from catalogue");
  assert.equal(EMPTY_RESOURCES_COPY.secondaryImportLabel, "Import existing");
  console.log("✓ Uxis empty-state titles + CTA labels locked");
}

{
  assert.equal(emptyResourcesTitle("list"), EMPTY_RESOURCES_COPY.listTitle);
  assert.equal(emptyResourcesTitle("graph"), EMPTY_RESOURCES_COPY.graphTitle);
  assert.match(emptyResourcesBody("list"), /Shared|Environment|catalogue/i);
  assert.match(emptyResourcesBody("graph"), /Shared|Environment|catalogue/i);
  // No Terraform / .tf jargon in empty UI copy
  for (const s of [
    EMPTY_RESOURCES_COPY.listTitle,
    EMPTY_RESOURCES_COPY.graphTitle,
    EMPTY_RESOURCES_COPY.listBody,
    EMPTY_RESOURCES_COPY.graphBody,
    EMPTY_RESOURCES_COPY.primaryAddLabel,
    EMPTY_RESOURCES_COPY.secondaryImportLabel,
    EMPTY_RESOURCES_COPY.hiddenNote(2, "Dev"),
  ]) {
    assert.doesNotMatch(s, /\.tf\b/i);
    assert.doesNotMatch(s, /\bHCL\b/);
    assert.doesNotMatch(s, /\bTerraform\b/i);
    assert.doesNotMatch(s, /azurerm_/);
  }
  console.log("✓ Domain language only (no .tf / HCL / Terraform / azurerm_)");
}

{
  assert.match(EMPTY_RESOURCES_COPY.hiddenNote(1, "Dev"), /1 resource/);
  assert.match(EMPTY_RESOURCES_COPY.hiddenNote(3, "Prod"), /3 resources/);
  console.log("✓ Hidden-in-other-env note");
}

console.log("\nAll empty-resources tests passed.");
