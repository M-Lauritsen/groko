import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";

const { chromium } = await import(process.env.GROKO_BROWSER_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
const screenshotDirectory = join(tmpdir(), "groko-import-review");
await mkdir(screenshotDirectory, { recursive: true });

const incomplete = `resource "azurerm_resource_group" "draft" {
  name = var.unresolved_name
  location = "westeurope"
}`;
const network = `resource "azurerm_resource_group" "group" {
  name = "rg-review-dev"
  location = "westeurope"
}
resource "azurerm_virtual_network" "network" {
  name = "vnet-review"
  resource_group_name = azurerm_resource_group.group.name
  location = azurerm_resource_group.group.location
  address_space = ["10.0.0.0/16"]
}`;

const compatibility = `resource "azurerm_resource_group" "group" {
  name = "rg-review"
  location = "westeurope"
}
resource "azurerm_container_registry" "registry" {
  name = "reviewregistry"
  resource_group_name = azurerm_resource_group.group.name
  location = azurerm_resource_group.group.location
  sku = "Basic"
  admin_enabled = false
}
resource "azurerm_user_assigned_identity" "identity" {
  name = "identity-review"
  resource_group_name = azurerm_resource_group.group.name
  location = azurerm_resource_group.group.location
}
resource "azurerm_role_assignment" "access" {
  scope = azurerm_resource_group.group.id
  role_definition_name = "Reader"
  principal_id = azurerm_user_assigned_identity.identity.principal_id
}
resource "azurerm_log_analytics_workspace" "logs" {
  name = "logs-review"
  resource_group_name = azurerm_resource_group.group.name
  location = azurerm_resource_group.group.location
  retention_in_days = 30
}`;

async function upload(page, source, profile) {
  if (page.viewportSize().width < 640) {
    await page.getByRole("tab", { name: "1. Environment", exact: true }).click();
    await page.getByRole("tab", { name: "Project setup", exact: true }).click();
  } else {
    await page.getByRole("banner").getByRole("button", { name: "Import existing", exact: true }).click();
  }
  await page.locator('input[type="file"]').last().setInputFiles({
    name: Buffer.isBuffer(source) ? "review.zip" : "review.tf",
    mimeType: Buffer.isBuffer(source) ? "application/zip" : "text/plain",
    buffer: Buffer.from(source),
  });
  if (profile) {
    await page.getByLabel("Root variable profile").selectOption(profile);
    await page.getByRole("button", { name: "Review mapping", exact: true }).click();
  }
  await page.getByRole("button", { name: /^Continue \(/ }).waitFor();
}

async function assertFocused(locator) {
  assert.equal(await locator.evaluate((element) => element === document.activeElement), true);
}

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.goto(process.env.GROKO_URL || "http://localhost:3100");
    const proceed = page.getByRole("button", { name: /^Continue \(/ });
    const editor = page.locator('section[id^="import-editor-"]');
    const undo = page.locator('header button[aria-label="Undo"]');
    assert.equal(await undo.isDisabled(), true);

    await upload(page, incomplete);
    assert.equal(await proceed.isDisabled(), true);
    await page.getByRole("button", { name: "Edit Resource Group draft", exact: true }).click();
    await assertFocused(editor.getByRole("heading"));
    const name = editor.getByLabel("Name", { exact: false });
    assert.equal(await name.getAttribute("aria-invalid"), "true");
    await name.fill("rg-corrected");
    assert.equal(await name.getAttribute("aria-invalid"), "false");
    assert.equal(await proceed.isEnabled(), true);
    await editor.getByLabel("Tags").pressSequentially("Team=platform\nPurpose=review");
    await page.screenshot({ path: join(screenshotDirectory, `editor-${viewport.width}.png`), fullPage: true });
    if (viewport.width >= 640) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    }
    const editorBox = await editor.boundingBox();
    assert.ok(editorBox && editorBox.x >= 0 && editorBox.x + editorBox.width <= viewport.width);
    await name.press("Escape");
    assert.equal(await editor.count(), 0);
    await assertFocused(page.getByRole("button", { name: "Edit Resource Group rg-corrected", exact: true }));
    await page.getByRole("button", { name: "Edit Resource Group rg-corrected", exact: true }).click();
    assert.equal(await editor.getByLabel("Tags").inputValue(), "Team=platform\nPurpose=review");
    await editor.getByRole("button", { name: "Done" }).click();
    await proceed.click();
    await assertFocused(page.getByRole("heading", { name: "Import 1 resource?" }));
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await undo.isDisabled(), true, "cancelled draft must not write project history");

    await upload(page, incomplete);
    assert.equal(await proceed.isDisabled(), true, "cancel discards corrected values");
    await page.getByRole("button", { name: "Edit Resource Group draft", exact: true }).click();
    await editor.getByLabel("Name", { exact: false }).fill("rg-live-only");
    await proceed.click();
    await page.getByRole("button", { name: "Replace all", exact: true }).click();
    assert.equal(await undo.isEnabled(), true);
    await upload(page, network);
    assert.equal(await proceed.isDisabled(), true, "scope-dropped references remain explicit missing fields");
    const networkRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: /^Edit Virtual Network / }) });
    const groupRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Edit Resource Group rg-review-dev", exact: true }) });
    await networkRow.getByLabel(/^Scope for/).selectOption("dev");
    assert.equal(await proceed.isDisabled(), true, "scope correction alone cannot invent dropped references");
    await networkRow.getByRole("button", { name: /^Edit / }).click();
    await editor.getByRole("heading").press("Control+z");
    assert.equal(await undo.isEnabled(), true, "draft keyboard shortcuts must not undo the live project");
    await networkRow.getByLabel(/^Scope for/).press("Escape");
    assert.equal(await editor.count(), 0, "Escape from row controls closes the editor, not the import");
    await assertFocused(networkRow.getByRole("button", { name: /^Edit / }));
    await networkRow.getByRole("button", { name: /^Edit / }).click();
    const groupPicker = editor.getByLabel("Resource Group", { exact: false });
    assert.doesNotMatch(await groupPicker.innerText(), /rg-live-only/, "reference choices must exclude live project resources");
    const groupId = await groupPicker.locator("option").last().getAttribute("value");
    assert.ok(groupId);
    await groupPicker.selectOption(groupId);
    assert.equal(await proceed.isDisabled(), true, "remaining missing reference must still block");
    await editor.getByLabel("Location", { exact: false }).selectOption(groupId);
    assert.equal(await proceed.isEnabled(), true, "explicit valid reference corrections enable Continue");
    const address = editor.getByLabel("Address Space", { exact: false });
    await address.fill("");
    assert.equal(await proceed.isDisabled(), true);
    await address.pressSequentially("10.0.0.0/16, 10.1.0.0/16");
    assert.equal(await proceed.isEnabled(), true);
    await editor.getByRole("button", { name: "Done" }).click();

    await groupRow.getByLabel(/^Scope for/).selectOption("prod");
    assert.equal(await proceed.isDisabled(), true, "invalid preserved references block Continue");
    await networkRow.getByRole("button", { name: /^Edit / }).click();
    assert.equal(await editor.getByLabel("Resource Group", { exact: false }).getAttribute("aria-invalid"), "true");
    assert.equal(await editor.getByLabel("Resource Group", { exact: false }).locator("option").count(), 1);
    await editor.getByRole("button", { name: "Done" }).click();
    await groupRow.getByLabel(/^Scope for/).selectOption("dev");
    assert.equal(await proceed.isEnabled(), true, "preserved original references recover after a compatible scope change");

    await networkRow.getByRole("radio", { name: "Existing", exact: true }).press("Space");
    await networkRow.getByRole("button", { name: /^Edit / }).click();
    assert.equal(await editor.getByLabel("Address Space", { exact: false }).count(), 0);
    await editor.getByRole("button", { name: "Enter lookup value" }).click();
    const lookup = editor.getByLabel("Resource Group", { exact: false });
    assert.equal(await proceed.isDisabled(), true);
    await lookup.fill("rg-existing-lookup");
    await editor.getByLabel("Name", { exact: false }).fill("vnet-existing");
    assert.equal(await proceed.isEnabled(), true);
    await editor.getByRole("button", { name: "Done" }).click();
    await networkRow.getByRole("radio", { name: "Create", exact: true }).press("Space");
    await networkRow.getByRole("button", { name: /^Edit / }).click();
    assert.equal(await editor.getByLabel("Name", { exact: false }).inputValue(), "vnet-review");
    assert.equal(await editor.getByLabel("Address Space", { exact: false }).inputValue(), "10.0.0.0/16, 10.1.0.0/16");
    await networkRow.getByRole("button", { name: /^Deselect / }).click();
    assert.equal(await editor.count(), 0);
    await assertFocused(page.getByRole("button", { name: "Reselect", exact: true }));
    await page.getByRole("button", { name: "Reselect", exact: true }).click();
    await networkRow.getByRole("button", { name: /^Edit / }).click();
    assert.equal(await editor.getByLabel("Address Space", { exact: false }).inputValue(), "10.0.0.0/16, 10.1.0.0/16");
    await editor.getByRole("button", { name: "Done" }).click();
    await groupRow.getByRole("button", { name: /^Deselect / }).click();
    assert.equal(await proceed.isDisabled(), true, "deselected reference targets block Continue");
    await page.getByRole("button", { name: "Reselect", exact: true }).click();
    assert.equal(await proceed.isEnabled(), true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("tab", { name: "1. Environment", exact: true }).focus();
    await page.keyboard.press("Control+z");
    assert.equal(await undo.isDisabled(), true, "draft edits and cancellation add no history after the single live commit");
    assert.equal(await page.getByText("rg-live-only", { exact: true }).count(), 0);

    await upload(page, compatibility);
    assert.equal(await proceed.isEnabled(), true);
    await page.getByRole("button", { name: "Edit Role Assignment access", exact: true }).click();
    const role = editor.getByLabel("Role", { exact: false });
    await role.selectOption("AcrPull");
    assert.equal(await proceed.isDisabled(), true, "incompatible role and scope must block Continue");
    assert.equal(await role.getAttribute("aria-invalid"), "true");
    const registryOption = editor.getByLabel("Scope", { exact: false }).locator("option").filter({ hasText: "reviewregistry" });
    await editor.getByLabel("Scope", { exact: false }).selectOption(await registryOption.getAttribute("value"));
    assert.equal(await proceed.isEnabled(), true, "choosing a compatible reference resolves the error");
    assert.equal(await role.getAttribute("aria-invalid"), "false");
    await editor.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Edit Container Registry (ACR) reviewregistry", exact: true }).click();
    await editor.getByLabel("Admin user enabled", { exact: false }).check();
    await editor.getByLabel("SKU", { exact: false }).selectOption("Premium");
    await editor.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Edit Container Registry (ACR) reviewregistry", exact: true }).click();
    assert.equal(await editor.getByLabel("Admin user enabled", { exact: false }).isChecked(), true);
    assert.equal(await editor.getByLabel("SKU", { exact: false }).inputValue(), "Premium");
    await editor.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Edit Log Analytics Workspace logs-review", exact: true }).click();
    await editor.getByLabel("Retention (days)").fill("45");
    await editor.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Edit Log Analytics Workspace logs-review", exact: true }).click();
    assert.equal(await editor.getByLabel("Retention (days)").inputValue(), "45");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    const profiles = new JSZip();
    profiles.file("main.tf", incomplete);
    profiles.file("alpha.tfvars", 'unresolved_name = "rg-alpha"');
    profiles.file("beta.tfvars", 'unresolved_name = "rg-beta"');
    const profileUpload = await profiles.generateAsync({ type: "nodebuffer" });
    await upload(page, profileUpload, "alpha.tfvars");
    await page.getByRole("button", { name: "Edit Resource Group rg-alpha", exact: true }).click();
    await editor.getByLabel("Name", { exact: false }).fill("rg-session-only");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await upload(page, profileUpload, "beta.tfvars");
    assert.equal(await editor.count(), 0, "profile remapping must clear editor selection");
    await page.getByRole("button", { name: "Edit Resource Group rg-beta", exact: true }).click();
    assert.equal(await editor.getByLabel("Name", { exact: false }).inputValue(), "rg-beta");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    const template = new JSZip();
    template.file("main.tf", 'module "template" { source = "./modules/network" for_each = { first = {} } }');
    template.file("modules/network/main.tf", network.replace('"rg-review-dev"', "each.value.name"));
    await upload(page, await template.generateAsync({ type: "nodebuffer" }));
    assert.equal(await proceed.isEnabled(), true, "for_each templates still permit explicitly deferred missing fields");
    const templateGroupRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: /^Edit Resource Group / }) });
    await templateGroupRow.getByLabel(/^Scope for/).selectOption("prod");
    assert.equal(await proceed.isDisabled(), true, "for_each templates never bypass invalid references");
    await templateGroupRow.getByLabel(/^Scope for/).selectOption("shared");
    assert.equal(await proceed.isEnabled(), true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.deepEqual(runtimeErrors, []);
    await page.close();
    console.log(`Import correction, compatibility, typed fields, scope, lookup modes, cancellation, history, focus and layout passed at ${viewport.width}px`);
  }
  console.log(`Screenshots: ${screenshotDirectory}`);
} finally {
  await browser.close();
}