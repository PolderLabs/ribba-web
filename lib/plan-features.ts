// Wat Basic en Premium functioneel mogen — fase 3B.3.
//
// DIT IS RIBBA-EIGENDOM. Een leerlingaantal is geen prijs en geen
// billingregel; het is de definitie van het product. Verandert Basic ooit van
// 30 naar 40 actieve leerlingen, dan is dat terecht een Ribba-wijziging.
//
// WAT HIER NIET HOORT: bedragen, valuta, gratis periodes. Die komen uit
// Stripe (zie lib/signup-offer.ts). De registratiekaart is een combinatie van
// beide bronnen — en juist daarom moeten ze in aparte modules staan, zodat
// niemand per ongeluk een prijs naast een limiet gaat hardcoderen.
//
// De getallen hieronder spiegelen de grenzen die de app en de edge functions
// al afdwingen (BASIC_MAX_STUDENTS / BASIC_MAX_INSTRUCTORS in ribbaPro).
// Ze zijn hier UITSLUITEND voor weergave: deze module verleent geen rechten
// en wordt door geen enkele poort geraadpleegd.

import type { SignupPlan } from '@/lib/signup-plan';

export type PlanFeatures = {
  naam: string;
  samenvatting: string;
  punten: string[];
};

export const PLAN_FEATURES: Record<SignupPlan, PlanFeatures> = {
  basic: {
    naam: 'Basic',
    samenvatting: 'Voor rijscholen met één instructeur.',
    punten: [
      'Maximaal 30 actieve leerlingen',
      '1 instructeur',
      'Agenda, leerlingbeheer en facturatie',
    ],
  },
  premium: {
    naam: 'Premium',
    samenvatting: 'Voor rijscholen met meerdere instructeurs.',
    punten: [
      'Onbeperkt actieve leerlingen',
      'Meerdere instructeurs',
      'Alles uit Basic, plus planning over instructeurs heen',
    ],
  },
};
