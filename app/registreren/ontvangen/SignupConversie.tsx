'use client';

// De Google Ads-conversie voor een inschrijving.
//
// WAAROM HIER EN NIET OP HET FORMULIER. Op de oude route was het verzenden van
// het formulier hetzelfde moment als het ontstaan van het account, dus daar
// mocht de conversie vuren. Op de nieuwe route is dat niet meer zo: tussen het
// formulier en de machtiging zit de betaalpagina van Stripe, en wie daar
// wegklikt heeft zich niet ingeschreven. Zou de conversie op het formulier
// blijven staan, dan telt hij afhakers mee en stuurt hij het bod op verkeerde
// signalen.
//
// GEEN TRANSACTIE-ID. Op het formulier ging `school_id` mee zodat Google een
// herhaalde melding kon ontdubbelen. Die bestaat hier nog niet: de school
// ontstaat pas in de webhook, en deze pagina weet bewust niets van de uitkomst.
// Herlaadt iemand de pagina, dan kan er dus een dubbele conversie ontstaan.
// Dat is aanvaard: liever een kleine overtelling dan hier gaan raden naar een
// id, of deze pagina laten wachten op een activatie die asynchroon is.

import { useEffect } from 'react';
import { trackTrialSignup } from '@/lib/gtag';

export function SignupConversie() {
  useEffect(() => {
    trackTrialSignup();
  }, []);

  return null;
}
