/**
 * Shared-hub DNS ownership (Develops #2).
 *
 * Owner = Environment that created the VNet link / hub DNS zone in the domain
 * graph. Prefer Existing / reuse never transfers ownership — only explicit
 * reassign does. Derives display from Environment scopes + refs; stores
 * hubOwnerEnvironmentId as the durable owner chip (not a second graph model).
 */

import { isReferenceValue } from "../schema/types";
import type {
  Environment,
  ResourceInstance,
  ResourceScope,
} from "../schema/types";
import {
  environmentById,
  normalizeScope,
  tierShortLabel,
} from "../schema/environments";
import { collectDeps } from "../generate/deps";

export const HUB_DNS_ZONE_TYPE = "azurerm_private_dns_zone";
export const HUB_VNET_LINK_TYPE =
  "azurerm_private_dns_zone_virtual_network_link";

export const HUB_DNS_TYPES = new Set([HUB_DNS_ZONE_TYPE, HUB_VNET_LINK_TYPE]);

/** Uxis copy for Shared-hub DNS ownership polish. */
export const HUB_OWNERSHIP_COPY = {
  sharedHubDns: "Shared hub DNS",
  vnetLinkSharedHub: "VNet link · Shared hub",
  ownedBy: (envLabel: string) => `owned by ${envLabel}`,
  usedByEnvs: (n: number) =>
    n === 1 ? "used by 1 Environment" : `used by ${n} Environments`,
  changeOwnerLabel: "Change owner…",
  reassignTitle: "Change hub owner",
  reassignConfirm: (envLabel: string) =>
    `Move hub ownership to ${envLabel}? Other Environments keep using this zone.`,
  reassignConfirmLabel: "Move ownership",
  cancelLabel: "Cancel",
  ownerReadOnlyHint:
    "Owner is the Environment that created this hub link. Prefer Existing does not move ownership.",
  envReuseCallout: (ownerLabel: string, zoneLabel: string) =>
    `This Environment reuses shared hub DNS (${zoneLabel}) owned by ${ownerLabel}. Prefer Existing stays default — ownership does not move.`,
} as const;

export function isHubDnsType(type: string): boolean {
  return HUB_DNS_TYPES.has(type);
}

/** Shared + Use existing private DNS zone = hub DNS pattern. */
export function isSharedHubDnsZone(r: ResourceInstance): boolean {
  return (
    r.type === HUB_DNS_ZONE_TYPE &&
    r.useExisting &&
    normalizeScope(r.scope).kind === "shared"
  );
}

/** Shared VNet link (typical hub networking). */
export function isSharedHubVnetLink(r: ResourceInstance): boolean {
  return (
    r.type === HUB_VNET_LINK_TYPE && normalizeScope(r.scope).kind === "shared"
  );
}

export function shouldStampHubOwnerOnCreate(type: string): boolean {
  return isHubDnsType(type);
}

/**
 * Stamp owner at create time (catalogue / starter / import).
 * Prefer Existing later must not overwrite this.
 */
export function withHubOwnerOnCreate(
  resource: ResourceInstance,
  activeEnvironmentId: string
): ResourceInstance {
  if (!shouldStampHubOwnerOnCreate(resource.type)) return resource;
  if (resource.hubOwnerEnvironmentId) return resource;
  return { ...resource, hubOwnerEnvironmentId: activeEnvironmentId };
}

/**
 * Resolve owner Environment id without inventing a parallel graph:
 * 1. Durable hubOwnerEnvironmentId (explicit / create stamp)
 * 2. Env scope on the resource itself
 * 3. For DNS zones: owner of a VNet link that refs this zone (first stable)
 * 4. For VNet links: scope of the linked VNet (via virtual_network_id ref)
 */
export function resolveHubOwnerEnvironmentId(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  _environments: Environment[]
): string | undefined {
  if (resource.hubOwnerEnvironmentId) return resource.hubOwnerEnvironmentId;

  const scope = normalizeScope(resource.scope);
  if (scope.kind === "environment") return scope.environmentId;

  if (resource.type === HUB_DNS_ZONE_TYPE) {
    const links = vnetLinksToZone(resource.id, resources);
    for (const link of links) {
      const id = resolveHubOwnerEnvironmentId(link, resources, _environments);
      if (id) return id;
    }
  }

  if (resource.type === HUB_VNET_LINK_TYPE) {
    const vnetRef = resource.values.virtual_network_id;
    if (isReferenceValue(vnetRef)) {
      const vnet = resources.find((r) => r.id === vnetRef.resourceId);
      if (vnet) {
        const vs = normalizeScope(vnet.scope);
        if (vs.kind === "environment") return vs.environmentId;
      }
    }
  }

  return undefined;
}

export function resolveHubOwnerEnvironment(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  environments: Environment[]
): Environment | undefined {
  const id = resolveHubOwnerEnvironmentId(resource, resources, environments);
  return id ? environmentById(environments, id) : undefined;
}

/** VNet links that reference this DNS zone (by resource id). */
export function vnetLinksToZone(
  zoneId: string,
  resources: ResourceInstance[]
): ResourceInstance[] {
  return resources.filter((r) => {
    if (r.type !== HUB_VNET_LINK_TYPE) return false;
    const ref = r.values.private_dns_zone_name ?? r.existingValues.private_dns_zone_name;
    return isReferenceValue(ref) && ref.resourceId === zoneId;
  });
}

/**
 * Environments that have a VNet link (or env-scoped PE) tied to this zone.
 * Derived from scopes + refs only.
 */
export function environmentsLinkedToHubZone(
  zone: ResourceInstance,
  resources: ResourceInstance[],
  environments: Environment[]
): Environment[] {
  const ids = new Set<string>();

  for (const link of vnetLinksToZone(zone.id, resources)) {
    const ownerId = resolveHubOwnerEnvironmentId(link, resources, environments);
    if (ownerId) ids.add(ownerId);
    const ls = normalizeScope(link.scope);
    if (ls.kind === "environment") ids.add(ls.environmentId);
  }

  // PEs that ref the zone also imply an Environment "using" it
  for (const e of collectDeps(resources)) {
    if (e.toId !== zone.id) continue;
    const from = resources.find((r) => r.id === e.fromId);
    if (!from) continue;
    const fs = normalizeScope(from.scope);
    if (fs.kind === "environment") ids.add(fs.environmentId);
    if (from.hubOwnerEnvironmentId) ids.add(from.hubOwnerEnvironmentId);
  }

  return environments.filter((env) => ids.has(env.id));
}

export function hubOwnerDisplayLabel(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  environments: Environment[]
): string | undefined {
  const env = resolveHubOwnerEnvironment(resource, resources, environments);
  if (!env) return undefined;
  return env.displayName || tierShortLabel(env);
}

/**
 * List / form / graph badge (or subtitle) for hub DNS + VNet link cards.
 * e.g. "VNet link · Shared hub · owned by Development"
 *      "Shared hub DNS · owned by Development"
 */
export function hubOwnershipBadgeText(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  environments: Environment[]
): string | undefined {
  const ownerLabel = hubOwnerDisplayLabel(resource, resources, environments);

  if (resource.type === HUB_VNET_LINK_TYPE) {
    const base =
      normalizeScope(resource.scope).kind === "shared"
        ? HUB_OWNERSHIP_COPY.vnetLinkSharedHub
        : `VNet link · ${scopeKindLabel(resource.scope, environments)}`;
    return ownerLabel
      ? `${base} · ${HUB_OWNERSHIP_COPY.ownedBy(ownerLabel)}`
      : base;
  }

  if (resource.type === HUB_DNS_ZONE_TYPE) {
    if (isSharedHubDnsZone(resource) || normalizeScope(resource.scope).kind === "shared") {
      const base = HUB_OWNERSHIP_COPY.sharedHubDns;
      return ownerLabel
        ? `${base} · ${HUB_OWNERSHIP_COPY.ownedBy(ownerLabel)}`
        : base;
    }
  }

  return undefined;
}

function scopeKindLabel(
  scope: ResourceScope | undefined,
  environments: Environment[]
): string {
  const s = normalizeScope(scope);
  if (s.kind === "shared") return "Shared";
  const env = environmentById(environments, s.environmentId);
  return env?.displayName ?? s.environmentId;
}

/** Short graph subtitle (under .tfName). */
export function hubOwnershipGraphSubtitle(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  environments: Environment[]
): string | undefined {
  if (!isHubDnsType(resource.type)) return undefined;
  const ownerLabel = hubOwnerDisplayLabel(resource, resources, environments);
  if (resource.type === HUB_VNET_LINK_TYPE) {
    return ownerLabel
      ? `Shared hub · ${HUB_OWNERSHIP_COPY.ownedBy(ownerLabel)}`
      : "Shared hub";
  }
  if (isSharedHubDnsZone(resource) || normalizeScope(resource.scope).kind === "shared") {
    return ownerLabel
      ? `Hub DNS · ${HUB_OWNERSHIP_COPY.ownedBy(ownerLabel)}`
      : "Hub DNS";
  }
  return undefined;
}

/**
 * Explicit reassign only — Prefer Existing / scope edits must not call this.
 */
export function reassignHubOwner(
  resource: ResourceInstance,
  newEnvironmentId: string
): ResourceInstance {
  if (!isHubDnsType(resource.type)) return resource;
  return { ...resource, hubOwnerEnvironmentId: newEnvironmentId };
}

/**
 * Active Environment reuses a shared hub zone it does not own.
 * Optional Environments-panel callout.
 */
export function sharedHubZonesReusedByActiveEnv(
  activeEnvironmentId: string,
  resources: ResourceInstance[],
  environments: Environment[]
): Array<{ zone: ResourceInstance; owner: Environment; linkedEnvs: Environment[] }> {
  const out: Array<{
    zone: ResourceInstance;
    owner: Environment;
    linkedEnvs: Environment[];
  }> = [];

  for (const zone of resources) {
    if (!isSharedHubDnsZone(zone) && !(zone.type === HUB_DNS_ZONE_TYPE && normalizeScope(zone.scope).kind === "shared")) {
      continue;
    }
    if (zone.type !== HUB_DNS_ZONE_TYPE) continue;

    const owner = resolveHubOwnerEnvironment(zone, resources, environments);
    if (!owner) continue;
    if (owner.id === activeEnvironmentId) continue;

    const linked = environmentsLinkedToHubZone(zone, resources, environments);
    const activeUses =
      linked.some((e) => e.id === activeEnvironmentId) ||
      // Shared zone is visible in every env view — "reuse" if another env owns it
      true;

    // Callout when active env is not owner (shared hub visible everywhere)
    if (activeUses) {
      out.push({ zone, owner, linkedEnvs: linked });
    }
  }

  return out;
}

export function linkedEnvCountBadge(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  environments: Environment[]
): string | undefined {
  if (resource.type === HUB_DNS_ZONE_TYPE) {
    const linked = environmentsLinkedToHubZone(resource, resources, environments);
    if (linked.length > 0) return HUB_OWNERSHIP_COPY.usedByEnvs(linked.length);
  }
  if (resource.type === HUB_VNET_LINK_TYPE) {
    const zoneRef =
      resource.values.private_dns_zone_name ??
      resource.existingValues.private_dns_zone_name;
    if (isReferenceValue(zoneRef)) {
      const zone = resources.find((r) => r.id === zoneRef.resourceId);
      if (zone) {
        const linked = environmentsLinkedToHubZone(zone, resources, environments);
        if (linked.length > 1) return HUB_OWNERSHIP_COPY.usedByEnvs(linked.length);
      }
    }
  }
  return undefined;
}
