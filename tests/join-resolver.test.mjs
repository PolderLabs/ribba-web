// De beslissing achter /join/[code].
//
// Aanleiding (13 aug 2026): de route zocht uitnodigingen op met
// `code.toUpperCase()`, terwijl de app persoonlijke codes met
// `Math.random().toString(36)` maakt — kleine letters. Elke persoonlijke
// uitnodiging liep daardoor op "Link verlopen", vanaf de dag dat de route
// bestond (24 feb 2026). Zes maanden, ongemerkt, omdat schoollinks wél werkten
// en een telefoon mét de app de URL afvangt vóór de webpagina.
//
// De eerste test hieronder is de test die dat had moeten vangen. De rest
// bewaakt dat de reparatie niets anders heeft opengezet — met name geval 8:
// een school die inschrijving uitzet, moet dicht blijven, en `resolve_invite`
// toetst dat veld niet.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bepaalJoinUitkomst } from '../lib/join-resolver.ts';

const geen = { school: null, resolved: null, invite: null };

const persoonlijkeWeergave = {
  is_multi_use: false,
  drivingschools: { registration_slug: 'rijschool-het-zwaantje', name: 'Rijschool Het Zwaantje' },
};

const schoolWeergave = {
  is_multi_use: true,
  drivingschools: { registration_slug: 'rijschool-het-zwaantje', name: 'Rijschool Het Zwaantje' },
};

describe('bepaalJoinUitkomst', () => {
  test('1. persoonlijke code in kleine letters wordt geaccepteerd — DE REGRESSIE', () => {
    // Exact de vorm die createInvitationLink() produceert.
    const code = 'catu8xmpcnousfpul3r63a';
    const uitkomst = bepaalJoinUitkomst({
      ...geen,
      resolved: { code },
      invite: persoonlijkeWeergave,
    });

    assert.equal(uitkomst.soort, 'persoonlijk');
    assert.equal(uitkomst.code, code);
    assert.equal(uitkomst.schoolNaam, 'Rijschool Het Zwaantje');
  });

  test('2. de canonieke code wordt doorgegeven, niet de invoer van de bezoeker', () => {
    // resolve_invite krijgt hoofdletters binnen en geeft de opgeslagen vorm
    // terug. De deeplink moet die opgeslagen vorm dragen, anders faalt de app
    // alsnog op precies dezelfde manier als het web zes maanden deed.
    const uitkomst = bepaalJoinUitkomst({
      ...geen,
      resolved: { code: 'catu8xmpcnousfpul3r63a' },
      invite: persoonlijkeWeergave,
    });

    assert.equal(uitkomst.code, 'catu8xmpcnousfpul3r63a');
  });

  test('3. registratie-slug van een open school stuurt door', () => {
    const uitkomst = bepaalJoinUitkomst({
      ...geen,
      school: { registration_slug: 'rijschool-nielsen', registration_enabled: true },
    });

    assert.deepEqual(uitkomst, { soort: 'redirect', slug: 'rijschool-nielsen' });
  });

  test('4. multi-use schoolcode stuurt door naar het inschrijfformulier', () => {
    const uitkomst = bepaalJoinUitkomst({
      ...geen,
      resolved: { code: 'S4X7PUB3J3MP' },
      invite: schoolWeergave,
    });

    assert.deepEqual(uitkomst, { soort: 'redirect', slug: 'rijschool-het-zwaantje' });
  });

  test('5. verlopen code: resolve_invite geeft niets, dus verlopen', () => {
    assert.equal(bepaalJoinUitkomst(geen).soort, 'verlopen');
  });

  test('6. gebruikte persoonlijke code levert hetzelfde eindpunt op', () => {
    // resolve_invite filtert `used` zelf weg. Voor de bezoeker is het
    // resultaat identiek aan onbekend — dat onderscheid geven we bewust niet
    // prijs, net zomin als vóór deze wijziging.
    assert.equal(bepaalJoinUitkomst(geen).soort, 'verlopen');
  });

  test('7. onbekende code', () => {
    assert.equal(bepaalJoinUitkomst(geen).soort, 'verlopen');
  });

  test('8. school met inschrijving uit blijft dicht', () => {
    // De poort die niet mag wegvallen. resolve_invite toetst `status` maar
    // niet `registration_enabled`; zou deze invoer doorvallen naar de RPC, dan
    // kwam de multi-use code terug en stond de inschrijving weer open.
    const uitkomst = bepaalJoinUitkomst({
      school: { registration_slug: 'rijschool-nielsen', registration_enabled: false },
      resolved: { code: 'AGMXXXXXXXXX' },
      invite: schoolWeergave,
    });

    assert.equal(uitkomst.soort, 'verlopen');
  });

  test('9. weergavegegevens weg tussen twee reads in → geen halve pagina', () => {
    const uitkomst = bepaalJoinUitkomst({
      ...geen,
      resolved: { code: 'catu8xmpcnousfpul3r63a' },
      invite: null,
    });

    assert.equal(uitkomst.soort, 'verlopen');
  });

  test('10. persoonlijke uitnodiging zonder gekoppelde school valt terug op neutrale tekst', () => {
    const uitkomst = bepaalJoinUitkomst({
      ...geen,
      resolved: { code: 'catu8xmpcnousfpul3r63a' },
      invite: { is_multi_use: false, drivingschools: null },
    });

    assert.equal(uitkomst.soort, 'persoonlijk');
    assert.equal(uitkomst.schoolNaam, 'je rijschool');
  });

  test('11. multi-use zonder slug wordt niet als redirect behandeld', () => {
    // Zonder slug is er geen formulier om heen te sturen; dan is de
    // "open in de app"-pagina het beste wat we kunnen bieden.
    const uitkomst = bepaalJoinUitkomst({
      ...geen,
      resolved: { code: 'S4X7PUB3J3MP' },
      invite: { is_multi_use: true, drivingschools: null },
    });

    assert.equal(uitkomst.soort, 'persoonlijk');
  });
});
