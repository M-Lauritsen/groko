import assert from 'node:assert/strict';
import { RESOURCE_ASSISTANCE, MODULE_ASSISTANCE, APP_GUIDANCE } from '@/lib/help/assistance';

assert.ok(Object.keys(RESOURCE_ASSISTANCE).length > 0, 'Expected resource help metadata');
assert.ok(Object.keys(MODULE_ASSISTANCE).length > 0, 'Expected module help metadata');
assert.ok(APP_GUIDANCE.length > 0, 'Expected app-level guidance');
assert.ok(RESOURCE_ASSISTANCE.azurerm_resource_group, 'Expected Resource Group guidance');
assert.ok(MODULE_ASSISTANCE.networking, 'Expected networking module guidance');

console.log('assistance metadata ok');
