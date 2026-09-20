/**
 * Smoke tests: Shared-hub DNS ownership (Develops #2).
 */
import assert from "node:assert/strict";
import { defaultEnvironments, sharedScope, envScope } from "../src/lib/schema/environments";
import type { ResourceInstance } from "../src/lib/schema/types";
import {
  HUB_OWNERSHIP_COPY,
  hubOwnershipBadgeText,
  hubOwnershipGraphSubtitle,
  isSharedHubDnsZone,
  linkedEnvCountBadge,
  reassignHubOwner,
  resolveHubOwnerEnvironmentId,
  sharedHubZonesReusedByActiveEnv,
  vnetLinksToZone,
  withHubOwnerOnCreate,
  environmentsLinkedToHubZone,
} from "../src/lib/store/hub-dns-ownership";

console.log("Azure TF Builder — Shared-hub DNS ownership smoke test\n");

const envs = defaultEnvironments();

function zone(
  id: string,
  opts: Partial<ResourceInstance> = {}
): ResourceInstance {
  return {
    id,
    type: "azurerm_private_dns_zone",
    tfName: "hub",
    useExisting: true,
    values: { name: "privatelink.azurecr.io" },
    existingValues: { name: "privatelink.azurecr.io" },
    scope: sharedScope(),
    ...opts,
  };
}

function link(
  id: string,
  zoneId: string,
  opts: Partial<ResourceInstance> = {}
): ResourceInstance {
  return {
    id,
    type: "azurerm_private_dns_zone_virtual_network_link",
    tfName: "hub",
    useExisting: false,
    values: {
      name: "link-acr",
      private_dns_zone_name: { resourceId: zoneId, attr: "name" },
      virtual_network_id: { resourceId: "vnet1", attr: "id" },
    },
    existingValues: {},
    scope: sharedScope(),
    ...opts,
  };
}

{
  const z = withHubOwnerOnCreate(zone("z1"), "dev");
  assert.equal(z.hubOwnerEnvironmentId, "dev");
  const again = withHubOwnerOnCreate(z, "staging");
  assert.equal(
    again.hubOwnerEnvironmentId,
    "dev",
    "reuse / re-stamp must not transfer ownership"
  );
  console.log("✓ Create stamp + Prefer Existing / re-stamp never transfers");
}

{
  const z = zone("z1", { hubOwnerEnvironmentId: "dev" });
  const l = withHubOwnerOnCreate(link("l1", "z1"), "dev");
  const resources = [z, l];
  assert.equal(isSharedHubDnsZone(z), true);
  assert.equal(resolveHubOwnerEnvironmentId(z, resources, envs), "dev");
  assert.equal(resolveHubOwnerEnvironmentId(l, resources, envs), "dev");

  const badgeZ = hubOwnershipBadgeText(z, resources, envs)!;
  assert.match(badgeZ, /Shared hub DNS/);
  assert.match(badgeZ, /owned by Development/);

  const badgeL = hubOwnershipBadgeText(l, resources, envs)!;
  assert.equal(
    badgeL,
    "VNet link · Shared hub · owned by Development"
  );

  const sub = hubOwnershipGraphSubtitle(l, resources, envs)!;
  assert.match(sub, /Shared hub/);
  assert.match(sub, /owned by Development/);
  console.log("✓ Uxis badges: Shared hub DNS / VNet link · Shared hub · owned by {Environment}");
}

{
  const z = zone("z1", { hubOwnerEnvironmentId: "dev" });
  const lDev = withHubOwnerOnCreate(link("l1", "z1"), "dev");
  const lStg = withHubOwnerOnCreate(
    link("l2", "z1", { tfName: "hub_stg" }),
    "staging"
  );
  const resources = [z, lDev, lStg];
  assert.equal(vnetLinksToZone("z1", resources).length, 2);
  const linked = environmentsLinkedToHubZone(z, resources, envs);
  assert.equal(linked.length, 2);
  assert.equal(linkedEnvCountBadge(z, resources, envs), "used by 2 Environments");

  // Zone owner stays Dev after Staging adds a link
  assert.equal(resolveHubOwnerEnvironmentId(z, resources, envs), "dev");
  console.log("✓ Linked Environments derived from scopes + refs; reuse keeps zone owner");
}

{
  const z = zone("z1", { hubOwnerEnvironmentId: "dev" });
  const moved = reassignHubOwner(z, "staging");
  assert.equal(moved.hubOwnerEnvironmentId, "staging");
  assert.equal(z.hubOwnerEnvironmentId, "dev", "reassign returns new object");
  console.log("✓ Explicit reassign only moves ownership");
}

{
  assert.equal(HUB_OWNERSHIP_COPY.changeOwnerLabel, "Change owner…");
  assert.match(
    HUB_OWNERSHIP_COPY.reassignConfirm("Staging"),
    /Move hub ownership to Staging\?/
  );
  assert.match(
    HUB_OWNERSHIP_COPY.reassignConfirm("Staging"),
    /Other Environments keep using this zone/
  );
  console.log("✓ Uxis reassign confirm copy locked");
}

{
  const z = zone("z1", { hubOwnerEnvironmentId: "dev" });
  const resources = [z, withHubOwnerOnCreate(link("l1", "z1"), "dev")];
  const reuse = sharedHubZonesReusedByActiveEnv("staging", resources, envs);
  assert.equal(reuse.length, 1);
  assert.equal(reuse[0].owner.id, "dev");
  const none = sharedHubZonesReusedByActiveEnv("dev", resources, envs);
  assert.equal(none.length, 0);
  console.log("✓ Environments panel callout when active env reuses hub");
}

{
  // Fallback: env-scoped link without stamp → owner from scope
  const z = zone("z1");
  const l = link("l1", "z1", { scope: envScope("prod") });
  assert.equal(resolveHubOwnerEnvironmentId(l, [z, l], envs), "prod");
  // Zone derives owner from link
  assert.equal(resolveHubOwnerEnvironmentId(z, [z, l], envs), "prod");
  console.log("✓ Derive owner from Environment scopes + refs when unset");
}

console.log("\nAll hub-dns-ownership tests passed.");
