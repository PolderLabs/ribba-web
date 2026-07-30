// Lazy Stripe-singleton voor het referral-programma (Connect: Express-partners,
// SEPA-incasso bij rijscholen). API-versie gepind — bump bewust, samen met de
// stripe-npm-major (zie stripe CHANGELOG voor breaking changes per versie).
//
// NB: de bestaande abonnements-billing (Mollie + Supabase edge functions)
// staat hier los van; dit is de eerste server-side Stripe-integratie in
// deze repo.

import Stripe from 'stripe';

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is niet gezet');
    }
    client = new Stripe(key, { apiVersion: '2026-06-24.dahlia' });
  }
  return client;
}
