"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { saveAs } from "file-saver";
import { useProject } from "@/lib/store/project-context";
import {
  createImportDiagnosticReport,
  getImportSkipDiagnostic,
  IMPORT_DIAGNOSTIC_REPORT_FILE_NAME,
  importFromUpload,
  readImportUpload,
  type ImportUpload,
  type ImportSummary,
  type MappedItem,
  type ParseResult,
  type RootTfvarsProfile,
  type SkippedItem,
} from "@/lib/import";
import {
  Button,
  Card,
  SectionTitle,
  Badge,
  Hint,
} from "@/components/ui/Field";
import {
  getResourceType,
  isPrivateEndpointTargetCompatible,
  isRoleAssignmentScopeCompatible,
} from "@/lib/schema/resources";
import {
  canReference,
  envScope,
  normalizeScope,
  scopeLabel,
  sharedScope,
  tierShortLabel,
} from "@/lib/schema/environments";
import {
  isReferenceValue,
  type ResourceInstance,
  type ResourceScope,
} from "@/lib/schema/types";
import { shouldGateDestructiveApplyOnProd } from "@/lib/store/prod-friction";
import { ProdFrictionDialog } from "@/components/project/ProdFrictionDialog";

type WizardStep = "upload" | "profile" | "review" | "confirm";
type ApplyMode = "merge" | "replace";

function domainLabel(type: string): string {
  return getResourceType(type)?.label ?? "Unknown resource";
}

function resourceDisplayName(r: ResourceInstance): string {
  const fromValues =
    (typeof r.values.name === "string" && r.values.name) ||
    (typeof r.existingValues.name === "string" && r.existingValues.name) ||
    null;
  return fromValues || r.tfName;
}

function hasLiteralValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && !isReferenceValue(value);
}

function referencesResource(value: unknown, resourceId: string): boolean {
  if (isReferenceValue(value)) return value.resourceId === resourceId;
  if (Array.isArray(value)) return value.some((item) => referencesResource(item, resourceId));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => referencesResource(item, resourceId));
  }
  return false;
}

function missingRequiredFields(
  resource: ResourceInstance,
  draft: ResourceInstance[]
): string[] {
  const def = getResourceType(resource.type);
  if (!def) return ["Supported resource type"];

  const fields = resource.useExisting
    ? def.fields.filter((field) => field.existingKey)
    : def.fields.filter((field) => field.required);

  return fields
    .filter((field) => {
      const value = resource.useExisting
        ? resource.existingValues[field.key] ?? resource.values[field.key]
        : resource.values[field.key];
      return isReferenceValue(value)
        ? resource.useExisting || !draft.some((candidate) => candidate.id === value.resourceId)
        : !hasLiteralValue(value);
    })
    .map((field) => field.label);
}

function invalidReferenceFields(
  resource: ResourceInstance,
  draft: ResourceInstance[]
): string[] {
  const def = getResourceType(resource.type);
  if (!def) return [];

  return def.fields
    .filter((field) => field.type === "reference")
    .filter((field) => {
      const value = resource.values[field.key];
      if (!isReferenceValue(value)) return false;
      const target = draft.find((candidate) => candidate.id === value.resourceId);
      return (
        !target ||
        !field.refTypes?.includes(target.type) ||
        !getResourceType(target.type)?.outputs.includes(value.attr) ||
        !canReference(resource, target)
      );
    })
    .map((field) => field.label);
}

function invalidCompatibilityFields(
  resource: ResourceInstance,
  draft: ResourceInstance[]
): string[] {
  if (resource.type === "azurerm_private_endpoint") {
    const target = resource.values.private_connection_resource_id;
    const targetType = isReferenceValue(target)
      ? draft.find((candidate) => candidate.id === target.resourceId)?.type
      : undefined;
    return targetType && !isPrivateEndpointTargetCompatible(
      resource.values.subresource_names,
      targetType
    )
      ? ["Target resource and Target type (subresource)"]
      : [];
  }

  if (resource.type === "azurerm_role_assignment") {
    const scope = resource.values.scope;
    const scopeType = isReferenceValue(scope)
      ? draft.find((candidate) => candidate.id === scope.resourceId)?.type
      : undefined;
    return scopeType && !isRoleAssignmentScopeCompatible(
      resource.values.role_definition_name,
      scopeType
    )
      ? ["Scope and Role"]
      : [];
  }

  return [];
}

type SkippedGroup = {
  title: string;
  help?: string;
  count: number;
  items: SkippedItem[];
};

function skippedTitle(s: SkippedItem): string {
  if (s.kind === "module") return "Module";
  return domainLabel(s.type);
}

function skippedItemIdentity(s: SkippedItem): string {
  return `${skippedTitle(s)}: ${s.name || "Unnamed source"}`;
}

function groupSkipped(
  skipped: SkippedItem[]
): SkippedGroup[] {
  const map = new Map<string, SkippedGroup>();
  for (const s of skipped) {
    const group = getImportSkipDiagnostic(s);
    const fallback =
      group.reasonCode === "not_supported" ||
      group.reasonCode === "module_not_supported";
    const groupKey = fallback ? `${group.reasonCode}:${s.kind}:${s.type}:${s.name}` : group.reasonCode;
    const current = map.get(groupKey);
    if (current) {
      current.items.push(s);
      current.count++;
    } else {
      map.set(groupKey, { ...group, count: 1, items: [s] });
    }
  }
  return [...map.values()];
}

export function ImportTerraform({
  onImported,
  compact = false,
}: {
  onImported?: () => void;
  compact?: boolean;
}) {
  const { importResources, state } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const confirmTitleRef = useRef<HTMLHeadingElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const stepRef = useRef<WizardStep>("upload");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>("upload");
  const [paneOpen, setPaneOpen] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [upload, setUpload] = useState<ImportUpload | null>(null);
  const [rootProfiles, setRootProfiles] = useState<RootTfvarsProfile[]>([]);
  const [selectedRootProfile, setSelectedRootProfile] = useState("");
  const [draft, setDraft] = useState<ResourceInstance[]>([]);
  const [deselectedDraft, setDeselectedDraft] = useState<ResourceInstance[]>([]);
  const [mappingByResourceId, setMappingByResourceId] = useState<Map<string, MappedItem>>(
    () => new Map()
  );
  const [deselectionNotice, setDeselectionNotice] = useState("");
  const [skipped, setSkipped] = useState<SkippedItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unmappedArgCount, setUnmappedArgCount] = useState(0);
  const [supportedCount, setSupportedCount] = useState(0);
  const [diagnosticImport, setDiagnosticImport] = useState<
    (ImportSummary & { fileCount: number; parse: ParseResult }) | null
  >(null);
  const [statusMessage, setStatusMessage] = useState("");
  /** Pending Replace/Merge awaiting Prod friction confirm. */
  const [prodPendingMode, setProdPendingMode] = useState<ApplyMode | null>(
    null
  );

  const paneTitleId = useId();
  const confirmTitleId = useId();
  const environments = state.environments;
  const activeEnv = useMemo(
    () =>
      environments.find((e) => e.id === state.activeEnvironmentId) ??
      environments[0],
    [environments, state.activeEnvironmentId]
  );

  const resetWizard = useCallback(() => {
    setStep("upload");
    setDraft([]);
    setDeselectedDraft([]);
    setMappingByResourceId(new Map());
    setDeselectionNotice("");
    setSkipped([]);
    setWarnings([]);
    setFileCount(0);
    setUpload(null);
    setRootProfiles([]);
    setSelectedRootProfile("");
    setUnmappedArgCount(0);
    setSupportedCount(0);
    setDiagnosticImport(null);
    setError(null);
    setProdPendingMode(null);
    setStatusMessage("");
  }, []);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const onPick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const loadSummary = useCallback(
    (result: ImportSummary & { fileCount: number }) => {
      setDiagnosticImport(result as ImportSummary & { fileCount: number; parse: ParseResult });
      // Domain draft only — never keep parse/raw HCL on instances.
      setDraft(
        result.resources.map((r) => ({
          ...r,
          values: { ...r.values },
          existingValues: { ...r.existingValues },
          scope: normalizeScope(r.scope),
        }))
      );
      setDeselectedDraft([]);
      setMappingByResourceId(
        new Map(result.resources.map((resource, index) => [resource.id, result.mapped[index]]))
      );
      setDeselectionNotice("");
      setSkipped(result.skipped);
      setWarnings(result.warnings);
      setFileCount(result.fileCount);
      setUnmappedArgCount(result.unmappedArgCount);
      setSupportedCount(result.supportedCount);
      if (result.resources.length === 0 && result.skipped.length === 0) {
        setError(result.warnings[0] ?? "Nothing to import.");
        setStatusMessage("Import failed. Nothing could be imported.");
        setStep("upload");
        return;
      }
      setStatusMessage(
        `Mapping complete: ${result.supportedCount} mapped, ${result.skipped.length} could not map, ${result.unmappedArgCount} partially mapped field${result.unmappedArgCount === 1 ? "" : "s"}.`
      );
      setStep("review");
    },
    []
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        const nextUpload = await readImportUpload(files);
        if (nextUpload.files.length === 0) {
          setError("No .tf / .tfvars files found in the upload.");
          setStatusMessage("Import failed. Nothing could be imported.");
          setStep("upload");
          return;
        }
        setUpload(nextUpload);
        setRootProfiles(nextUpload.rootProfiles);
        if (nextUpload.rootProfiles.length > 1) {
          setSelectedRootProfile("");
          setStatusMessage("Choose one root variable profile before mapping resources.");
          setStep("profile");
        } else {
          loadSummary(importFromUpload(nextUpload, nextUpload.rootProfiles[0]?.path));
        }
      } catch {
        setError("We couldn't read that upload. Check the file type and try again.");
        setStep("upload");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [loadSummary]
  );

  const mapSelectedProfile = useCallback(() => {
    if (!upload || !selectedRootProfile) return;
    setBusy(true);
    try {
      loadSummary(importFromUpload(upload, selectedRootProfile));
    } catch {
      setError("We couldn't map that profile. Choose another profile or upload again.");
      setStep("profile");
    } finally {
      setBusy(false);
    }
  }, [loadSummary, selectedRootProfile, upload]);

  const updateDraft = useCallback((id: string, patch: Partial<ResourceInstance>) => {
    setDraft((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }, []);

  const setDraftScope = useCallback(
    (id: string, scope: ResourceScope) => {
      updateDraft(id, { scope: normalizeScope(scope) });
    },
    [updateDraft]
  );

  const setDraftExisting = useCallback(
    (id: string, useExisting: boolean) => {
      updateDraft(id, { useExisting });
    },
    [updateDraft]
  );

  const removeDraftResource = useCallback((id: string) => {
    setDraft((rows) => {
      const removed = rows.find((row) => row.id === id);
      if (!removed) return rows;
      const dependents = rows.filter(
        (row) => row.id !== id && referencesResource(row.values, id)
      );
      setDeselectedDraft((items) => [...items.filter((item) => item.id !== id), removed]);
      setDeselectionNotice(
        dependents.length > 0
          ? `${resourceDisplayName(removed)} was deselected. ${dependents.length} selected resource${dependents.length === 1 ? " still references it" : "s still reference it"}.`
          : `${resourceDisplayName(removed)} was deselected and can be reselected below.`
      );
      return rows.filter((row) => row.id !== id);
    });
  }, []);

  const reselectDraftResource = useCallback((id: string) => {
    setDeselectedDraft((items) => {
      const resource = items.find((item) => item.id === id);
      if (!resource) return items;
      setDraft((rows) => [...rows, resource]);
      setDeselectionNotice(`${resourceDisplayName(resource)} was reselected. Its preserved references are available again.`);
      return items.filter((item) => item.id !== id);
    });
  }, []);

  const draftValidation = useMemo(
    () => new Map(draft.map((resource) => [resource.id, missingRequiredFields(resource, draft)])),
    [draft]
  );
  const invalidReferenceValidation = useMemo(
    () => new Map(draft.map((resource) => [resource.id, invalidReferenceFields(resource, draft)])),
    [draft]
  );
  const invalidCompatibilityValidation = useMemo(
    () => new Map(draft.map((resource) => [resource.id, invalidCompatibilityFields(resource, draft)])),
    [draft]
  );
  const invalidDraftCount = draft.filter(
    (resource) =>
      (draftValidation.get(resource.id)?.length ?? 0) > 0 ||
      (invalidReferenceValidation.get(resource.id)?.length ?? 0) > 0 ||
      (invalidCompatibilityValidation.get(resource.id)?.length ?? 0) > 0
  ).length;
  const validationSummaryId = useId();

  const goConfirm = useCallback(() => {
    if (draft.length === 0 || invalidDraftCount > 0) return;
    setStep("confirm");
    requestAnimationFrame(() => confirmTitleRef.current?.focus());
  }, [draft.length, invalidDraftCount]);

  const returnToReview = useCallback(() => {
    setStep("review");
    requestAnimationFrame(() => continueButtonRef.current?.focus());
  }, []);

  const commitImport = useCallback(
    (mode: ApplyMode) => {
      if (draft.length === 0) return;
      // Commit domain ResourceInstances only (labels/scopes/existing/values).
      importResources(draft, mode);
      resetWizard();
      setPaneOpen(false);
      onImported?.();
    },
    [draft, importResources, onImported, resetWizard]
  );

  const apply = useCallback(
    (mode: ApplyMode) => {
      if (draft.length === 0) return;
      if (shouldGateDestructiveApplyOnProd(mode, activeEnv)) {
        setProdPendingMode(mode);
        return;
      }
      commitImport(mode);
    },
    [draft.length, activeEnv, commitImport]
  );

  const cancelAll = useCallback(() => {
    resetWizard();
  }, [resetWizard]);

  const closePane = useCallback(() => {
    if (stepRef.current === "confirm") {
      returnToReview();
      return;
    }
    cancelAll();
    setPaneOpen(false);
  }, [cancelAll, returnToReview]);

  const cancelProdConfirmation = useCallback(() => {
    setProdPendingMode(null);
    setStep("review");
    requestAnimationFrame(() => continueButtonRef.current?.focus());
  }, []);

  const openPane = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      previouslyFocused.current = event.currentTarget;
      resetWizard();
      setPaneOpen(true);
    },
    [resetWizard]
  );

  const downloadDiagnostics = useCallback(() => {
    if (!diagnosticImport) return;
    const report = createImportDiagnosticReport(
      diagnosticImport.fileCount,
      diagnosticImport.parse,
      diagnosticImport
    );
    saveAs(
      new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      IMPORT_DIAGNOSTIC_REPORT_FILE_NAME
    );
    setStatusMessage("Import diagnostic report downloaded locally.");
  }, [diagnosticImport]);

  useEffect(() => {
    if (!compact || !paneOpen) return;
    const target = dialogRef.current;
    if (!target) return;

    if (!previouslyFocused.current) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
    }

    return () => {
      previouslyFocused.current?.focus?.();
      previouslyFocused.current = null;
    };
  }, [compact, paneOpen]);

  useEffect(() => {
    // Prod friction owns focus trap + Escape while open.
    if (!compact || !paneOpen || prodPendingMode) return;
    const target = dialogRef.current;
    if (!target) return;

    const focusables = () =>
      Array.from(
        target.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);

    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (stepRef.current === "confirm") returnToReview();
        else closePane();
        return;
      }
      if (e.key !== "Tab") return;
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

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [compact, paneOpen, prodPendingMode, closePane, returnToReview]);

  useEffect(() => {
    if (!prodPendingMode && (!compact || !paneOpen)) return;
    const activeLayerAttribute = prodPendingMode
      ? "data-prod-friction-dialog"
      : "data-import-pane";
    const background = Array.from(document.body.children).filter(
      (element) => !element.hasAttribute(activeLayerAttribute)
    );
    const previous = background.map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.hasAttribute("inert"),
    }));
    background.forEach((element) => {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    });
    return () => {
      previous.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        if (!inert) element.removeAttribute("inert");
      });
    };
  }, [compact, paneOpen, prodPendingMode]);

  const skippedGroups = useMemo(() => groupSkipped(skipped), [skipped]);

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".tf,.tfvars,.zip,application/zip"
      multiple
      className="hidden"
      onChange={(e) => onFiles(e.target.files)}
    />
  );

  const stepIndicator = (
    <ol
      className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-3"
      aria-label="Import steps"
    >
      {(
        (rootProfiles.length > 1
          ? [
              ["upload", "1. Upload"],
              ["profile", "2. Variable profile"],
              ["review", "3. Review mapping"],
              ["confirm", "4. Confirm"],
            ]
          : [
              ["upload", "1. Upload"],
              ["review", "2. Review mapping"],
              ["confirm", "3. Confirm"],
            ]) as Array<[WizardStep, string]>
      ).map(([id, label]) => {
        const active = step === id;
        const done =
          (id === "upload" && step !== "upload") ||
          (id === "review" && step === "confirm");
        return (
          <li key={id}>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                active
                  ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
                  : done
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const reviewPanel = (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge tone="emerald">{supportedCount} mapped</Badge>
        <Badge tone="amber">{skipped.length} couldn’t map</Badge>
        <Badge tone="slate">{fileCount} file(s)</Badge>
        {unmappedArgCount > 0 && (
          <Badge tone="violet">{unmappedArgCount} field(s) skipped</Badge>
        )}
      </div>

      {invalidDraftCount > 0 && (
        <p id={validationSummaryId} role="alert" className="text-sm text-rose-700 dark:text-rose-300">
          {invalidDraftCount} selected resource{invalidDraftCount === 1 ? " needs" : "s need"} attention before continuing.
        </p>
      )}
      {deselectionNotice && (
        <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
          {deselectionNotice}
        </p>
      )}

      {draft.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">
              Mapped resources — edit scope and existing vs create before import
            </caption>
            <thead className="bg-slate-50 dark:bg-slate-950/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Existing / Create
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Scope
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Selection
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {draft.map((r) => {
                const def = getResourceType(r.type);
                const scope = normalizeScope(r.scope);
                const scopeValue =
                  scope.kind === "shared" ? "shared" : scope.environmentId;
                const missingFields = draftValidation.get(r.id) ?? [];
                const invalidReferenceFieldsForResource =
                  invalidReferenceValidation.get(r.id) ?? [];
                const invalidCompatibilityFieldsForResource =
                  invalidCompatibilityValidation.get(r.id) ?? [];
                const mapping = mappingByResourceId.get(r.id);
                const partialMapping = Boolean(
                  mapping && (mapping.unmappedFieldNames.length > 0 || mapping.unsupportedConstructs.length > 0)
                );
                const validationId = `import-validation-${r.id}`;
                return (
                  <tr key={r.id} className="bg-white dark:bg-slate-900">
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-start gap-2 min-w-[8rem]">
                        <span aria-hidden className="mt-0.5">
                          {def?.icon ?? "📦"}
                        </span>
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {domainLabel(r.type)}
                          </div>
                          {partialMapping && (
                            <div className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                              <p>Partially mapped{mapping?.sourcePath ? ` from ${mapping.sourcePath}` : ""}.</p>
                              {mapping?.unmappedFieldNames.length ? <p>Unresolved fields: {mapping.unmappedFieldNames.join(", ")}</p> : null}
                              {mapping?.unsupportedConstructs.length ? <p>Unsupported: {mapping.unsupportedConstructs.join(", ")}</p> : null}
                            </div>
                          )}
                          {(missingFields.length > 0 || invalidReferenceFieldsForResource.length > 0 || invalidCompatibilityFieldsForResource.length > 0) && (
                            <div id={validationId} className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                              {missingFields.length > 0 && <p>Needs: {missingFields.join(", ")}</p>}
                              {invalidReferenceFieldsForResource.length > 0 && <p>Invalid reference: {invalidReferenceFieldsForResource.join(", ")}</p>}
                              {invalidCompatibilityFieldsForResource.length > 0 && <p>Invalid selection: {invalidCompatibilityFieldsForResource.join(", ")}</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="text-slate-800 dark:text-slate-200">
                        {resourceDisplayName(r)}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <fieldset aria-describedby={missingFields.length > 0 ? validationId : undefined}>
                        <legend className="sr-only">
                          Existing or create for {domainLabel(r.type)} {resourceDisplayName(r)}
                        </legend>
                        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950 focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-1 dark:focus-within:ring-offset-slate-900">
                          {([
                            [true, "Existing"],
                            [false, "Create"],
                          ] as const).map(([useExisting, label]) => (
                            <label
                              key={label}
                              className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium ${
                                r.useExisting === useExisting
                                  ? "bg-white text-sky-700 shadow-sm dark:bg-slate-800 dark:text-sky-300"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`existing-${r.id}`}
                                className="sr-only"
                                checked={r.useExisting === useExisting}
                                onChange={() => setDraftExisting(r.id, useExisting)}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <label className="sr-only" htmlFor={`scope-${r.id}`}>
                        Scope for {domainLabel(r.type)} {resourceDisplayName(r)}
                      </label>
                      <select
                        id={`scope-${r.id}`}
                        aria-describedby={invalidReferenceFieldsForResource.length > 0 || invalidCompatibilityFieldsForResource.length > 0 ? validationId : undefined}
                        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        value={scopeValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "shared") setDraftScope(r.id, sharedScope());
                          else setDraftScope(r.id, envScope(v));
                        }}
                      >
                        <option value="shared">Shared</option>
                        {environments.map((env) => (
                          <option key={env.id} value={env.id}>
                            {tierShortLabel(env)} · {env.displayName}
                          </option>
                        ))}
                      </select>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {scopeLabel(scope, environments)}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Deselect ${domainLabel(r.type)} ${resourceDisplayName(r)}`}
                        aria-describedby={validationId}
                        onClick={() => removeDraftResource(r.id)}
                      >
                        Deselect
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No catalogue resources mapped. You can still review what couldn’t be
          mapped below, then add types from the catalogue after closing.
        </p>
      )}

      {deselectedDraft.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-700 p-3">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Deselected resources</p>
          <ul className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            {deselectedDraft.map((resource) => (
              <li key={resource.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{domainLabel(resource.type)}: {resourceDisplayName(resource)}</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => reselectDraftResource(resource.id)}>
                  Reselect
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <details className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 p-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-900 dark:text-amber-200">
            Couldn’t map ({skipped.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm text-amber-900/90 dark:text-amber-100/90">
            {skippedGroups.map((g) => (
              <li key={g.title}>
                <p className="font-medium">
                  {g.title} <Badge tone="amber">{g.count}</Badge>
                </p>
                {g.help && (
                  <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/70">
                    {g.help}
                  </p>
                )}
                <ul className="mt-1 ml-3 list-disc text-xs text-amber-800 dark:text-amber-200/80 space-y-0.5">
                  {g.items.slice(0, 12).map((s, i) => (
                    <li key={`${s.type}-${s.name}-${i}`}>{skippedItemIdentity(s)}</li>
                  ))}
                  {g.items.length > 12 && (
                    <li className="list-none -ml-3">
                      <details>
                        <summary className="cursor-pointer">Show {g.items.length - 12} more</summary>
                        <ul className="mt-1 ml-3 list-disc space-y-0.5">
                          {g.items.slice(12).map((s, i) => (
                            <li key={`${s.type}-${s.name}-${i + 12}`}>{skippedItemIdentity(s)}</li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/70">
            Skipped types stay out of the project until you add them from the
            catalogue.
          </p>
        </details>
      )}

      {warnings.length > 0 && (
        <details className="text-xs text-slate-600 dark:text-slate-400">
          <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300">
            Show detail ({warnings.length} note
            {warnings.length === 1 ? "" : "s"})
          </summary>
          <p className="mt-2">
            {warnings.length} import note{warnings.length === 1 ? "" : "s"} are available in the diagnostic report.
          </p>
        </details>
      )}
    </div>
  );

  const confirmPanel = (
    <div className="space-y-3">
      <h4
        ref={confirmTitleRef}
        id={confirmTitleId}
        tabIndex={-1}
        className="text-sm font-medium text-slate-900 dark:text-slate-100"
      >
        Import {draft.length} resource{draft.length === 1 ? "" : "s"}?
      </h4>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Choose how to apply. Nothing changes until you pick an option. Esc goes back to review.
      </p>
      <ul className="text-xs text-slate-500 max-h-28 overflow-auto space-y-1 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
        {draft.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-1.5">
            <span aria-hidden>{getResourceType(r.type)?.icon ?? "📦"}</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {domainLabel(r.type)}
            </span>
            <span>{resourceDisplayName(r)}</span>
            <Badge tone={r.useExisting ? "amber" : "emerald"}>
              {r.useExisting ? "existing" : "create"}
            </Badge>
            <Badge
              tone={
                normalizeScope(r.scope).kind === "shared" ? "violet" : "sky"
              }
            >
              {scopeLabel(r.scope, environments)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );

  const uploadPanel = (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant={compact ? "secondary" : "primary"}
        size="sm"
        disabled={busy}
        onClick={onPick}
      >
        {busy ? "Reading…" : "Upload Terraform"}
      </Button>
      {!compact && (
        <Hint>
          Client-side only — files never leave your browser.
        </Hint>
      )}
    </div>
  );

  const body = (
    <>
      {stepIndicator}
      {step === "upload" && uploadPanel}
      {step === "profile" && (
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Choose variable profile
            </h4>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Variables are applied only for this import review.
            </p>
          </div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="root-variable-profile">
            Root variable profile
          </label>
          <select
            id="root-variable-profile"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            value={selectedRootProfile}
            onChange={(event) => setSelectedRootProfile(event.target.value)}
          >
            <option value="">Select a profile</option>
            {rootProfiles.map((profile) => (
              <option key={profile.path} value={profile.path}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && step === "upload" && (
        <div role="alert" aria-live="assertive" className="mt-3 rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-700 p-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
          <div className="mt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {step === "review" && reviewPanel}
      {step === "confirm" && confirmPanel}
    </>
  );

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {diagnosticImport && step !== "upload" && (
        <Button type="button" variant="secondary" size="sm" onClick={downloadDiagnostics}>
          Download report
        </Button>
      )}
      {step === "upload" && (
        <Button type="button" variant="ghost" size="sm" onClick={compact ? closePane : cancelAll}>
          Cancel
        </Button>
      )}
      {step === "profile" && (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={cancelAll}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={!selectedRootProfile || busy} onClick={mapSelectedProfile}>
            {busy ? "Mapping…" : "Review mapping"}
          </Button>
        </>
      )}
      {step === "review" && (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={compact ? closePane : cancelAll}>
            Cancel
          </Button>
          <Button ref={continueButtonRef} type="button" variant="primary" size="sm" aria-describedby={invalidDraftCount > 0 ? validationSummaryId : undefined} disabled={draft.length === 0 || invalidDraftCount > 0} onClick={goConfirm}>
            Continue ({draft.length})
          </Button>
        </>
      )}
      {step === "confirm" && (
        <>
          <Button type="button" variant="primary" size="sm" onClick={() => apply("replace")}>
            Replace all
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => apply("merge")}>
            Merge into current
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={returnToReview}>
            Back
          </Button>
        </>
      )}
    </div>
  );

  if (compact) {
    return (
      <>
        {fileInput}
        <Button type="button" variant="secondary" size="sm" onClick={openPane}>
          Import existing
        </Button>
        {paneOpen && createPortal(
          <div data-import-pane className="fixed inset-0 z-50 flex justify-end bg-black/40">
            <div aria-hidden="true" className="absolute inset-0" onClick={closePane} />
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={step === "confirm" ? confirmTitleId : paneTitleId}
              className="relative flex h-full w-full max-w-[min(680px,48vw)] flex-col bg-white shadow-xl dark:bg-slate-900 max-md:max-w-none"
            >
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                <div>
                  <h3 id={paneTitleId} className="text-base font-semibold text-slate-900 dark:text-white">Import existing</h3>
                  <Badge tone="violet">Beta</Badge>
                </div>
                <Button type="button" variant="ghost" size="sm" aria-label="Close import" onClick={closePane}>Close</Button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{body}</div>
              <footer className="shrink-0 border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-900">{actions}</footer>
              <p className="sr-only" role="status" aria-live="polite">{statusMessage}</p>
            </div>
          </div>,
          document.body
        )}
      {prodPendingMode && activeEnv && createPortal(
        <div data-prod-friction-dialog>
          <ProdFrictionDialog
            environment={activeEnv}
            variant="import"
            showMerge
            onReplace={() => commitImport("replace")}
            onMerge={() => commitImport("merge")}
            onCancel={cancelProdConfirmation}
          />
        </div>,
        document.body
      )}
      </>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <SectionTitle>Import existing</SectionTitle>
          <p className="text-sm text-slate-500 mt-1">
            Upload Terraform files or a zip of a root module. Supported Azure
            types are mapped into <strong>domain resources</strong> (Resource
            Group, VNet, …) — no HCL in the primary review. Fix scope and
            Existing/Create, then Replace or Merge like starters.
          </p>
        </div>
        <Badge tone="violet">Beta</Badge>
      </div>
      {fileInput}
      <div
        className="mt-4"
        ref={step === "confirm" || step === "review" ? dialogRef : undefined}
      >
        {body}
      </div>
      <div className="mt-4">{actions}</div>
      <p className="sr-only" role="status" aria-live="polite">{statusMessage}</p>

      {prodPendingMode && activeEnv && createPortal(
        <div data-prod-friction-dialog>
          <ProdFrictionDialog
            environment={activeEnv}
            variant="import"
            showMerge
            onReplace={() => commitImport("replace")}
            onMerge={() => commitImport("merge")}
            onCancel={cancelProdConfirmation}
          />
        </div>,
        document.body
      )}
    </Card>
  );
}
