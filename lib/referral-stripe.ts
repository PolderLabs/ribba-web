// Gedeelde Stripe-Connect-helpers voor het referral-programma: gebruikt door
// /api/partner/stripe/status (UX-verversing) én /api/stripe-webhook
// (account.updated, het autoritatieve synchronisatiepad).

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StripeOnboardingStatus } from '@/lib/referral-types';

export function onboardingStatusFromAccount(account: Stripe.Account): StripeOnboardingStatus {
  if (account.payouts_enabled) return 'complete';
  if (account.requirements?.disabled_reason) return 'restricted';
  return 'pending';
}

// Schrijf de Stripe-accountstaat terug op de partner-rij.
export async function syncPartnerAccountState(
  supabase: SupabaseClient,
  partnerId: string,
  account: Stripe.Account,
): Promise<{ payouts_enabled: boolean; stripe_onboarding_status: StripeOnboardingStatus }> {
  const state = {
    payouts_enabled: account.payouts_enabled === true,
    stripe_onboarding_status: onboardingStatusFromAccount(account),
  };
  const { error } = await supabase
    .from('referral_partners')
    .update(state)
    .eq('id', partnerId);
  if (error) {
    console.error('referral-stripe: partner-sync mislukt', error.message);
  }
  return state;
}
