import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/components/project/ImportTerraform.tsx"),
  "utf8"
);
const resourceFormSource = readFileSync(
  resolve("src/components/resources/ResourceForm.tsx"),
  "utf8"
);
const referencePickerSource = readFileSync(
  resolve("src/components/resources/ReferencePicker.tsx"),
  "utf8"
);
const containerAppExtrasSource = readFileSync(
  resolve("src/components/resources/ContainerAppExtras.tsx"),
  "utf8"
);

function requireSource(pattern: RegExp, description: string) {
  assert.match(source, pattern, description);
}

function main() {
  console.log("Groko import pane UI checks\n");

  requireSource(/createImportDiagnosticReport/, "uses the sanitized diagnostic report helper");
  requireSource(/IMPORT_DIAGNOSTIC_REPORT_FILE_NAME/, "uses the report helper filename");
  requireSource(/saveAs\([\s\S]*JSON\.stringify\(report, null, 2\)/, "downloads serialized report JSON locally");
  requireSource(/data-import-pane/, "renders the import surface in a pane portal");
  requireSource(/role="dialog"[\s\S]*aria-modal="true"/, "exposes a modal dialog");
  requireSource(/const paneTitleId = useId\(\);[\s\S]*const confirmTitleId = useId\(\);/, "uses distinct pane and confirmation heading IDs");
  requireSource(/type WizardStep = "upload" \| "profile" \| "review" \| "confirm";/, "adds a profile selection wizard state");
  requireSource(/readImportUpload\(files\)[\s\S]*nextUpload\.rootProfiles\.length > 1[\s\S]*setStep\("profile"\)/, "requires root profile selection before mapping ambiguous uploads");
  requireSource(/<label[^>]*htmlFor="root-variable-profile"[\s\S]*<select[\s\S]*id="root-variable-profile"/, "labels the keyboard-accessible root profile selector");
  requireSource(/disabled=\{!selectedRootProfile \|\| busy\}[\s\S]*Review mapping/, "requires a selected root profile before mapping");
  requireSource(/aria-labelledby=\{step === "confirm" \? confirmTitleId : paneTitleId\}/, "labels the pane dialog with the active wizard-step heading");
  requireSource(/id=\{confirmTitleId\}/, "gives the confirmation prompt its own heading ID");
  assert.doesNotMatch(source, /const titleId = useId\(\)/, "does not reuse one ID for separate dialog labels");
  requireSource(/max-w-\[min\(680px,48vw\)\][\s\S]*max-md:max-w-none/, "uses desktop pane and mobile sheet sizing");
  requireSource(/setAttribute\("inert", ""\)/, "makes the application background inert");
  requireSource(/data-prod-friction-dialog/, "renders production confirmation in a dedicated modal layer");
  requireSource(/const activeLayerAttribute = prodPendingMode[\s\S]*"data-prod-friction-dialog"[\s\S]*"data-import-pane"/, "keeps only the topmost modal layer accessible");
  requireSource(/setStep\("review"\);[\s\S]*requestAnimationFrame\(\(\) => continueButtonRef\.current\?\.focus\(\)\)/, "returns production cancellation to the review draft with focus restored");
  requireSource(/const goConfirm[\s\S]*setStep\("confirm"\);[\s\S]*requestAnimationFrame\(\(\) => confirmTitleRef\.current\?\.focus\(\)\)/, "moves focus to the confirmation heading");
  requireSource(/const returnToReview[\s\S]*setStep\("review"\);[\s\S]*requestAnimationFrame\(\(\) => continueButtonRef\.current\?\.focus\(\)\)/, "returns confirmation focus to Continue");
  requireSource(/ref=\{confirmTitleRef\}[\s\S]*tabIndex=\{-1\}/, "makes the confirmation heading programmatically focusable");
  requireSource(/type="radio"[\s\S]*name=\{`existing-\$\{r\.id\}`\}/, "uses native radio controls for Existing/Create");
  requireSource(/focus-within:ring-2 focus-within:ring-sky-500/, "shows a visible focus treatment for Existing/Create radios");
  requireSource(/function missingRequiredFields[\s\S]*def\.fields\.filter\(\(field\) => field\.required\)/, "derives required Create fields from the catalogue definition");
  requireSource(/def\.fields\.filter\(\(field\) => field\.existingKey\)/, "requires Existing identifying keys from the catalogue definition");
  requireSource(/isReferenceValue\(value\)[\s\S]*draft\.some\(\(candidate\) => candidate\.id === value\.resourceId\)/, "accepts only resolvable references for Create fields");
  requireSource(/function invalidReferenceFields[\s\S]*field\.type === "reference"[\s\S]*!field\.refTypes\?\.includes\(target\.type\)[\s\S]*!canReference\(resource, target\)/, "validates imported reference type and scope without rewriting the mapped value");
  requireSource(/function invalidCompatibilityFields[\s\S]*isPrivateEndpointTargetCompatible[\s\S]*isRoleAssignmentScopeCompatible/, "validates Private Endpoint and Role Assignment domain compatibility without rewriting imported values");
  requireSource(/const invalidCompatibilityValidation[\s\S]*invalidCompatibilityFields\(resource, draft\)/, "revalidates domain compatibility from the review draft");
  requireSource(/invalidCompatibilityValidation\.get\(resource\.id\)/, "blocks Continue for invalid domain compatibility");
  requireSource(/Invalid selection: \{invalidCompatibilityFieldsForResource\.join/, "visibly identifies incompatible domain selections in their source rows");
  requireSource(/const invalidReferenceValidation[\s\S]*invalidReferenceFields\(resource, draft\)/, "revalidates reference integrity from the review draft after scope changes");
  requireSource(/const setDraftScope[\s\S]*updateDraft\(id, \{ scope: normalizeScope\(scope\) \}\)/, "preserves mapped references when a scope change makes one invalid");
  requireSource(/const invalidDraftCount[\s\S]*disabled=\{draft\.length === 0 \|\| invalidDraftCount > 0\}/, "blocks Continue while selected rows are incomplete");
  requireSource(/Needs: \{missingFields\.join\(", "\)\}/, "shows missing fields on incomplete rows");
  requireSource(/Invalid reference: \{invalidReferenceFieldsForResource\.join\(", "\)\}/, "visibly identifies invalid references in their source rows");
  requireSource(/removeDraftResource[\s\S]*Deselect/, "lets users deselect an invalid row without silently changing it");
  requireSource(/role="alert" aria-live="assertive"/, "announces upload failures assertively");
  requireSource(/setStatusMessage\("Import failed\. Nothing could be imported\."\)/, "does not announce mapping completion after an empty import");
  requireSource(/function skippedItemIdentity[\s\S]*\$\{skippedTitle\(s\)\}: \$\{s\.name/, "shows safe domain and source identities for skipped items");
  requireSource(/getImportSkipDiagnostic\(s\)[\s\S]*group\.reasonCode[\s\S]*groupKey/, "groups skipped items through the shared diagnostic reason code");
  assert.doesNotMatch(source, /function plainSkipReason/, "does not classify skips with UI text matching");
  requireSource(/<details>[\s\S]*<summary[^>]*>Show \{g\.items\.length - 12\} more<\/summary>/, "uses a native keyboard-operable disclosure for truncated skipped items");
  requireSource(/<div aria-hidden="true" className="absolute inset-0" onClick=\{closePane\} \/>/, "keeps the compact modal backdrop out of keyboard focus");
  assert.equal((source.match(/role="status" aria-live="polite"/g) ?? []).length, 2, "renders one polite status region for each mutually exclusive layout");
  requireSource(/if \(stepRef\.current === "confirm"\) \{[\s\S]*returnToReview\(\);/, "returns from confirmation close to the preserved review draft");
  requireSource(/if \(stepRef\.current === "confirm"\) returnToReview\(\);/, "returns from confirmation Escape to the preserved review draft");
  assert.doesNotMatch(source, /warnings\.slice\(/, "does not render raw parser warning text");
  assert.doesNotMatch(source, /Module calls are not imported/, "does not collapse module skips into one generic group");
  requireSource(/g\.items\.slice\(0, 12\)/, "keeps the per-group item limit");
  requireSource(/<ul className="mt-3[\s\S]*<ul className="mt-1/, "keeps semantic nested skip lists");
  assert.match(referencePickerSource, /const selectId = useId\(\);[\s\S]*<Label htmlFor=\{selectId\}[\s\S]*<SelectInput[\s\S]*id=\{selectId\}/, "connects each reference label to its select input");
  assert.match(containerAppExtrasSource, /resource\.type === "azurerm_key_vault"[\s\S]*canReference\(current, resource\)/, "filters Container App Key Vault choices through shared scope policy");
  assert.match(resourceFormSource, /isPrivateEndpointTargetCompatible[\s\S]*updateResourceValue\(resource!\.id, "subresource_names", subresource\)/, "resets an incompatible Private Endpoint target type after its target changes");
  assert.match(resourceFormSource, /isRoleAssignmentScopeCompatible[\s\S]*updateResourceValue\(resource!\.id, "role_definition_name", role\)/, "resets an incompatible Role Assignment role after its scope changes");
  assert.match(resourceFormSource, /role="status">[\s\S]*\{compatibilityNote\}/, "announces an automatic compatible selection update");

  console.log("✓ pane dialog, skip groups, radio controls, report download, and privacy contracts");
}

main();