// Contracttests gedreven door de GEDEELDE fixture-set (besluit B2,
// ribbaPro docs/design/2026-07-19_customer-sync-contract.md).
//
// Leidend exemplaar: ribbaPro supabase/functions/_shared/invoice-profile.ts.
// Dit exemplaar (lib/invoice-profile.ts) volgt. De checksum hieronder pint
// tests/invoice-profile.fixtures.json byte-voor-byte vast op dezelfde waarde
// als in de ribbaPro-testsuite. Fixtures wijzigen = beide kopieën én beide
// checksums bijwerken in dezelfde werkstroom — drift laat één van de twee
// suites hard falen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE_URL = new URL('./invoice-profile.fixtures.json', import.meta.url);
const FIXTURE_SHA256 = '6be1807dab584904667e726b3b0f4437ec5b93e67949efe6951561b27c7c11f5';

const raw = readFileSync(fileURLToPath(FIXTURE_URL));
const fixtures = JSON.parse(raw.toString('utf8'));

const { invoiceNameFor, invoiceAddressFor, InvoiceProfileError } =
  await import('../lib/invoice-profile.ts');

test('gedeelde fixtures: checksum identiek aan ribbaPro (driftbewaking)', () => {
  assert.equal(createHash('sha256').update(raw).digest('hex'), FIXTURE_SHA256);
  assert.equal(fixtures.version, 1);
  assert.equal(fixtures.invoiceNameFor.length, 10);
  assert.equal(fixtures.invoiceAddressFor.length, 9);
});

function run(fn, vector) {
  if (vector.expect.error !== undefined) {
    let thrown = null;
    try {
      fn(vector.school);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof InvoiceProfileError, `verwachtte InvoiceProfileError: ${vector.case}`);
    assert.equal(thrown.message, vector.expect.error);
  } else {
    assert.deepEqual(fn(vector.school), vector.expect.value);
  }
}

for (const v of fixtures.invoiceNameFor) {
  test(`invoiceNameFor — ${v.case}`, () => run(invoiceNameFor, v));
}
for (const v of fixtures.invoiceAddressFor) {
  test(`invoiceAddressFor — ${v.case}`, () => run(invoiceAddressFor, v));
}
