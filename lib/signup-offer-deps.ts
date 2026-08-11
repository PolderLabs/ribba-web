// De echte bronnen achter `resolveSignupOffer` — op één plek.
//
// WAAROM APART. De resolver zelf mag geen Stripe-client bouwen en geen
// Supabase aanroepen: dan is hij niet te testen zonder een halve keten op te
// tuigen. Maar als elke route zijn eigen dependencies samenstelt, kunnen
// `/api/signup/offer` en `/api/signup/start` uit elkaar lopen — en dan toont
// het scherm iets anders dan Checkout krijgt. Precies wat we uitsluiten.
//
// Dus: één factory, door beide routes gebruikt.

import type Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';
import type { OfferDeps, PromoResolutie } from '@/lib/signup-offer';

/**
 * Slaat `validate_promo_code` aan.
 *
 * Die RPC geeft bewust geen reden terug — onbekend, inactief, verlopen en
 * uitgeput zien er identiek uit. Anders is dit een orakel waarmee je codes
 * kunt aftasten.
 *
 * Fail-closed: gaat de aanroep mis, dan is de code voor nu niet geldig. Een
 * databasestoring mag nooit per ongeluk een gratis half jaar uitdelen.
 */
async function valideerPromoViaDatabase(code: string): Promise<PromoResolutie> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await db.rpc('validate_promo_code', { p_code: code });
  if (error) {
    console.error('validate_promo_code error:', error);
    return { geldig: false };
  }

  const r = data as { valid?: boolean; code?: string; stripe_trial_interval?: string } | null;
  if (r?.valid !== true) return { geldig: false };

  // Zonder duur is de code betekenisloos voor het aanbod. Behandel hem dan
  // als ongeldig in plaats van als "geldig maar zonder effect": dat laatste
  // zou de klant een bevestiging geven zonder dat er iets verandert.
  const interval = typeof r.stripe_trial_interval === 'string' ? r.stripe_trial_interval : '';
  if (interval.trim() === '') return { geldig: false };

  return { geldig: true, code: r.code ?? code, interval };
}

/**
 * De dependencies waarmee beide signup-routes het aanbod resolven.
 *
 * `stripe` is de volledige client, niet alleen het stukje dat de resolver
 * nodig heeft: `start` maakt er daarna ook de Checkout Session mee. Zo wordt
 * er per verzoek één client gebouwd, en gebruiken resolutie en Checkout
 * gegarandeerd dezelfde configuratie en API-versie.
 */
export function maakOfferDeps(): OfferDeps & { stripe: Stripe } {
  return { stripe: getStripe(), valideerPromo: valideerPromoViaDatabase };
}
