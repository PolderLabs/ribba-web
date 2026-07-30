// Gedeelde NL-labels voor de partner-portal (server- en client-safe).

import { formatCentsForDisplay } from '@/lib/plan-pricing';
import type {
  ReferralMilestone,
  ReferralPayoutStatus,
  ReferralStatus,
  RewardSnapshotItem,
} from '@/lib/referral-types';

export function milestoneText(milestone: ReferralMilestone): string {
  return milestone === 'proefles' ? 'proefles gehad' : 'eerste les betaald';
}

export function rewardText(reward: RewardSnapshotItem): string {
  return reward.reward_kind === 'cash' && reward.amount_cents != null
    ? formatCentsForDisplay(reward.amount_cents)
    : 'Een gratis les';
}

export function referralStatusText(status: ReferralStatus): string {
  switch (status) {
    case 'registered': return 'Aangemeld';
    case 'proefles': return 'Proefles gehad';
    case 'eerste_betaalde_les': return 'Eerste les betaald';
    case 'void': return 'Vervallen';
  }
}

// Partner-facing: een mislukte incasso is voor de partner gewoon nog
// "in behandeling" — het herstel loopt tussen Ribba en de rijschool.
export function payoutStatusText(status: ReferralPayoutStatus): string {
  switch (status) {
    case 'pending': return 'Wacht op bevestiging rijschool';
    case 'confirmed':
    case 'charging':
    case 'charged':
    case 'failed':
      return 'In behandeling';
    case 'paid': return 'Uitbetaald';
    case 'canceled': return 'Geannuleerd';
  }
}
