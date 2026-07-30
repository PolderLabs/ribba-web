// Zoekt een bestaand sepa_debit-mandaat van de school dat het
// referral-programma kan adopteren. Alle scholen betalen hun abonnement via
// Stripe (school_subscriptions.stripe_customer_id); wie via SEPA betaalt
// heeft daar al een actief mandaat hangen.
//
// Twee valkuilen die deze resolutie expliciet afdekt (beide live vastgesteld):
//   1. school_id is NIET uniek in school_subscriptions — een school kan
//      meerdere (historische) subscription-rijen hebben. We proberen de
//      actieve subscription eerst, daarna de nieuwste.
//   2. de tabel bevat een mix van live- en test-mode customer-ids; test-ids
//      bestaan niet op het live-account. Elke kandidaat wordt daarom tegen de
//      live Stripe API geprobeerd en resource_missing wordt overgeslagen.

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AdoptableMandate {
  customerId: string;
  paymentMethodId: string;
  last4: string | null;
}

export async function findAdoptableBillingMandate(
  supabase: SupabaseClient,
  stripe: Stripe,
  schoolId: string,
): Promise<AdoptableMandate | null> {
  const { data: subs } = await supabase
    .from('school_subscriptions')
    .select('stripe_customer_id, stripe_status, created_at')
    .eq('school_id', schoolId)
    .not('stripe_customer_id', 'is', null)
    .order('created_at', { ascending: false });

  // Actieve subscription eerst; sort is stabiel, dus binnen de groepen blijft
  // nieuwste-eerst behouden.
  const ordered = [...(subs ?? [])].sort(
    (a, b) => Number(b.stripe_status === 'active') - Number(a.stripe_status === 'active'),
  );

  const seen = new Set<string>();
  for (const sub of ordered) {
    const customerId = sub.stripe_customer_id as string;
    if (seen.has(customerId)) continue;
    seen.add(customerId);

    try {
      const pms = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'sepa_debit',
        limit: 1,
      });
      const pm = pms.data[0];
      if (pm) {
        return {
          customerId,
          paymentMethodId: pm.id,
          last4: pm.sepa_debit?.last4 ?? null,
        };
      }
    } catch (e) {
      // Test-mode-id of verwijderde customer → volgende kandidaat.
      const code = (e as { code?: string })?.code;
      if (code === 'resource_missing') continue;
      throw e;
    }
  }
  return null;
}
