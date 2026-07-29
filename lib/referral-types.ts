// Handgeschreven row-types voor de referral-tabellen
// (supabase/migrations/20260729000000_referral_program.sql).
// Het gedeelde Supabase-project is niet CLI-gelinkt vanuit deze repo, dus
// geen `supabase gen types` — houd dit bestand in sync met de migratie.

export type ReferralMilestone = 'proefles' | 'eerste_betaalde_les';

export type RewardKind = 'cash' | 'free_lesson';

export type ReferralProgramStatus = 'active' | 'paused';

export type SepaMandateStatus = 'none' | 'pending' | 'active' | 'failed';

export type StripeOnboardingStatus = 'none' | 'pending' | 'complete' | 'restricted';

export type ReferralStatus = 'registered' | 'proefles' | 'eerste_betaalde_les' | 'void';

export type ReferralPayoutStatus =
  | 'pending'    // milestone gehaald, wacht op bevestiging rijschool
  | 'confirmed'  // rijschool bevestigde → cron gaat incasseren
  | 'charging'   // SEPA-incasso loopt (asynchroon, 2–14 werkdagen)
  | 'charged'    // incasso geslaagd, transfer naar partner wordt aangemaakt
  | 'paid'       // partner uitbetaald (of free_lesson vervuld)
  | 'failed'     // incasso mislukt (retry via referral_retry_payout)
  | 'canceled';  // afgewezen door rijschool of geannuleerd (void/ops)

export interface ReferralProgramRow {
  id: string;
  drivingschool_id: string;
  status: ReferralProgramStatus;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  sepa_mandate_status: SepaMandateStatus;
  ribba_fee_cents: number;
  created_at: string;
  updated_at: string;
}

export interface ReferralProgramRewardRow {
  id: string;
  program_id: string;
  milestone: ReferralMilestone;
  reward_kind: RewardKind;
  amount_cents: number | null; // NULL ⟺ reward_kind 'free_lesson'
  created_at: string;
}

export interface ReferralPartnerRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: StripeOnboardingStatus;
  payouts_enabled: boolean;
  kyc_nudge_sent_at: string | null;
  created_at: string;
}

export interface ReferralPartnerMembershipRow {
  id: string;
  partner_id: string;
  drivingschool_id: string;
  code: string;
  status: 'active' | 'disabled';
  created_at: string;
}

// Eén element van referrals.reward_snapshot (kopie van de program-rewards op
// het moment van attributie — configwijziging raakt bestaande referrals niet).
export interface RewardSnapshotItem {
  milestone: ReferralMilestone;
  reward_kind: RewardKind;
  amount_cents: number | null;
}

export interface ReferralRow {
  id: string;
  membership_id: string;
  partner_id: string;
  drivingschool_id: string;
  student_id: string | null; // SET NULL bij verwijderde leerling; snapshots blijven
  referred_first_name: string;
  referred_email: string; // niet partner-leesbaar (column-grant); alleen service role
  status: ReferralStatus;
  registered_at: string;
  proefles_at: string | null;
  eerste_betaalde_les_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  reward_snapshot: RewardSnapshotItem[];
  created_at: string;
}

export interface ReferralPayoutRow {
  id: string;
  referral_id: string;
  membership_id: string;
  partner_id: string;
  drivingschool_id: string;
  milestone: ReferralMilestone;
  reward_kind: RewardKind;
  amount_cents: number | null; // NULL ⟺ reward_kind 'free_lesson'
  ribba_fee_cents: number; // snapshot van referral_programs.ribba_fee_cents bij aanmaak
  currency: string;
  status: ReferralPayoutStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  stripe_payment_intent_id: string | null;
  stripe_transfer_id: string | null;
  charged_at: string | null;
  paid_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  attempt_count: number;
  milestone_notified_at: string | null;
  created_at: string;
}

// Retour-shape van de anon-RPC referral_program_public(p_slug) — voedt de
// enrollmentpagina /partner/join/[slug]. Discriminated union op `found`.
export type ReferralProgramPublic =
  | { found: false }
  | {
      found: true;
      school_name: string;
      registration_slug: string;
      rewards: RewardSnapshotItem[];
    };
