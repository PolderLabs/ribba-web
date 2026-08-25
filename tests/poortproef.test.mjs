// TIJDELIJK — bewijst dat een rode interne check de merge blokkeert.
// Wordt in dezelfde PR weer verwijderd.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('bewust rood: de poort hoort dit tegen te houden', () => {
  assert.equal(1, 2, 'deze test faalt met opzet');
});
