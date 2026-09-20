/**
 * First-class Environment helpers: defaults, visibility, ref eligibility.
 */

import type {
  Environment,
  EnvironmentKnobs,
  ResourceInstance,
  ResourceScope,
} from "./types";

/** Types that default to env-scoped when added from the catalogue. */
const ENV_SCOPED_DEFAULT_TYPES = new Set([
  "azurerm_container_app",
  "azurerm_linux_web_app",
  "azurerm_linux_virtual_machine",
  "azurerm_mssql_database",
  "azurerm_service_plan",
  "azurerm_mssql_server",
]);

export function sharedScope(): ResourceScope {
  return { kind: "shared" };
}

export function envScope(environmentId: string): ResourceScope {
  return { kind: "environment", environmentId };
}

export function defaultKnobsForId(id: string): EnvironmentKnobs {
  if (id === "staging") {
    return {
      namingSuffix: "-stg",
      tags: { Environment: "staging" },
      acrSku: "Standard",
      caCpu: 0.5,
      caMemory: "1Gi",
      caMinReplicas: 1,
      caMaxReplicas: 5,
      caIngressExternal: true,
    };
  }
  if (id === "prod") {
    return {
      namingSuffix: "-prd",
      tags: { Environment: "prod" },
      acrSku: "Premium",
      caCpu: 1.0,
      caMemory: "2Gi",
      caMinReplicas: 2,
      caMaxReplicas: 10,
      caIngressExternal: false,
    };
  }
  // dev + any custom env fallback
  return {
    namingSuffix: id === "dev" ? "-dev" : `-${id}`,
    tags: { Environment: id },
    acrSku: "Basic",
    caCpu: 0.25,
    caMemory: "0.5Gi",
    caMinReplicas: 0,
    caMaxReplicas: 2,
    caIngressExternal: true,
  };
}

/** Default three environments matching historical hard-coded tfvars. */
export function defaultEnvironments(): Environment[] {
  return [
    {
      id: "dev",
      displayName: "Development",
      knobs: defaultKnobsForId("dev"),
    },
    {
      id: "staging",
      displayName: "Staging",
      knobs: defaultKnobsForId("staging"),
    },
    {
      id: "prod",
      displayName: "Production",
      knobs: defaultKnobsForId("prod"),
    },
  ];
}

export function normalizeScope(scope: ResourceScope | undefined | null): ResourceScope {
  if (!scope || (scope.kind !== "shared" && scope.kind !== "environment")) {
    return sharedScope();
  }
  if (scope.kind === "environment" && !scope.environmentId) {
    return sharedScope();
  }
  return scope;
}

export function isResourceVisibleInEnv(
  resource: ResourceInstance,
  environmentId: string
): boolean {
  const scope = normalizeScope(resource.scope);
  if (scope.kind === "shared") return true;
  return scope.environmentId === environmentId;
}

export function resourcesVisibleInEnv(
  resources: ResourceInstance[],
  environmentId: string
): ResourceInstance[] {
  return resources.filter((r) => isResourceVisibleInEnv(r, environmentId));
}

/**
 * Cross-env refs are blocked.
 * Shared ↔ shared OK; shared ↔ same-env OK; envA ↔ envB blocked.
 */
export function canReference(
  from: ResourceInstance,
  to: ResourceInstance
): boolean {
  const a = normalizeScope(from.scope);
  const b = normalizeScope(to.scope);
  // Shared may only depend on shared (env-scoped targets would leak across envs).
  if (a.kind === "shared") return b.kind === "shared";
  // Env-scoped may depend on shared or the same environment only.
  if (a.kind === "environment") {
    if (b.kind === "shared") return true;
    return b.kind === "environment" && a.environmentId === b.environmentId;
  }
  return false;
}

/**
 * Candidates for a reference picker while viewing / editing in an environment.
 * Only shared + same-env resources of allowed types (excludes self).
 */
export function filterRefCandidates(
  resources: ResourceInstance[],
  opts: {
    currentId: string;
    refTypes: string[];
    /** Active env — used when current resource is shared to still block other envs. */
    activeEnvironmentId: string;
    current?: ResourceInstance;
  }
): ResourceInstance[] {
  const current =
    opts.current ?? resources.find((r) => r.id === opts.currentId);
  return resources.filter((r) => {
    if (r.id === opts.currentId) return false;
    if (!opts.refTypes.includes(r.type)) return false;
    if (current) {
      return canReference(current, r);
    }
    // No current yet — allow shared + active env only
    return isResourceVisibleInEnv(r, opts.activeEnvironmentId);
  });
}

/** Default scope when adding a resource from the catalogue. */
export function defaultScopeForNewResource(
  type: string,
  activeEnvironmentId: string
): ResourceScope {
  if (ENV_SCOPED_DEFAULT_TYPES.has(type)) {
    return envScope(activeEnvironmentId);
  }
  return sharedScope();
}

/**
 * Best-effort: if name clearly encodes an env (e.g. myapp-dev-ca, foo-prd),
 * scope to that environment; otherwise shared.
 */
export function inferScopeFromName(
  name: unknown,
  environments: Environment[]
): ResourceScope {
  if (typeof name !== "string" || !name.trim()) return sharedScope();
  const lower = name.toLowerCase();
  // Prefer longer / more specific ids first
  const sorted = [...environments].sort((a, b) => b.id.length - a.id.length);
  for (const env of sorted) {
    const id = env.id.toLowerCase();
    const aliases =
      id === "staging"
        ? ["staging", "stg"]
        : id === "prod"
          ? ["prod", "prd", "production"]
          : id === "dev"
            ? ["dev", "development"]
            : [id];
    for (const alias of aliases) {
      const patterns = [
        new RegExp(`(^|[-_])${alias}([-_]|$)`, "i"),
      ];
      if (patterns.some((re) => re.test(lower))) {
        return envScope(env.id);
      }
    }
  }
  return sharedScope();
}

export function environmentById(
  environments: Environment[],
  id: string
): Environment | undefined {
  return environments.find((e) => e.id === id);
}

export function scopeLabel(
  scope: ResourceScope,
  environments: Environment[]
): string {
  const s = normalizeScope(scope);
  if (s.kind === "shared") return "Shared";
  const env = environmentById(environments, s.environmentId);
  return env?.displayName ?? s.environmentId;
}

/** Short tier label for badges / Dev|Staging|Prod control (falls back to displayName). */
export function tierShortLabel(env: Environment | undefined | null): string {
  if (!env) return "—";
  if (env.id === "dev") return "Dev";
  if (env.id === "staging") return "Staging";
  if (env.id === "prod") return "Prod";
  return env.displayName || env.id;
}
