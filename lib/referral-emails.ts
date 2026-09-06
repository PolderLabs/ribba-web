// Referral-programma e-mails: partner-facing (welkom, referral aangemeld,
// milestone gehaald, payout bevestigd/uitbetaald, KYC-nudge) en één
// school-facing mail (incasso mislukt). Zelfde huisstijl als
// lib/school-emails.ts (Resend + inline HTML + billing_events-log).

import { logBillingEvent } from './billing-events';
import { formatCentsForDisplay } from './plan-pricing';
import { DOMAIN } from './domains';
import type { ReferralMilestone, RewardSnapshotItem } from './referral-types';

const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ACCOUNT_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || DOMAIN.account;
const PARTNER_PORTAL_URL = `${DOMAIN.referral}/partner`;
const LOGO_URL = `${ACCOUNT_BASE_URL}/ribba-logo.png`;

interface MailLogMeta {
  schoolId: string;
  emailType: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendMail(
  to: string,
  subject: string,
  html: string,
  logMeta: MailLogMeta,
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('referral-emails: RESEND_API_KEY not set, skipping', subject, to);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Ribba <noreply@ribba.app>',
      to,
      subject,
      html,
    }),
  });

  let resendId: string | null = null;
  let errText = '';
  if (res.ok) {
    try {
      const body = await res.json();
      if (body && typeof body === 'object' && 'id' in body) {
        resendId = (body as { id?: string }).id ?? null;
      }
    } catch {
      /* body parse-fail is niet fataal */
    }
  } else {
    errText = await res.text().catch(() => '');
    console.error('referral-emails: send failed', res.status, errText);
  }

  await logBillingEvent({
    school_id: logMeta.schoolId,
    event_type: res.ok ? 'email_sent' : 'email_failed',
    source: 'referral-emails',
    email_type: logMeta.emailType,
    recipient: to,
    resend_message_id: resendId,
    payload: res.ok
      ? { subject }
      : { status: res.status, error: errText.slice(0, 500), subject },
  });
}

interface WrapOpts {
  pillLabel: string;
  pillBg: string;
  pillColor: string;
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
  ctaColor?: string;
}

function wrap(opts: WrapOpts): string {
  const cta = opts.ctaLabel && opts.ctaHref
    ? `
      <tr><td style="padding:24px 32px 8px 32px">
        <a href="${opts.ctaHref}" style="display:inline-block;background:${opts.ctaColor || '#2563EB'};color:#FFFFFF;padding:13px 24px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px">
          ${escapeHtml(opts.ctaLabel)}
        </a>
      </td></tr>
    `
    : '';

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F8FAFC;padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06)">

      <!-- Logo header -->
      <tr><td style="padding:32px 32px 8px 32px;text-align:left">
        <img src="${LOGO_URL}" alt="Ribba" width="96" style="display:block;height:auto;border:0;outline:none;text-decoration:none">
      </td></tr>

      <!-- Status pill + title -->
      <tr><td style="padding:24px 32px 8px 32px">
        <span style="display:inline-block;background:${opts.pillBg};color:${opts.pillColor};font-size:11px;font-weight:700;padding:6px 12px;border-radius:999px;letter-spacing:0.4px;text-transform:uppercase">${escapeHtml(opts.pillLabel)}</span>
        <h1 style="margin:14px 0 0 0;font-size:24px;font-weight:800;color:#0F172A;line-height:1.25">${escapeHtml(opts.title)}</h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:20px 32px 8px 32px;font-size:15px;line-height:1.6;color:#1E293B">
        ${opts.bodyHtml}
      </td></tr>

      ${cta}

      <!-- Footer -->
      <tr><td style="background:#F8FAFC;padding:18px 32px;margin-top:24px;font-size:12px;text-align:center;color:#94A3B8;border-top:1px solid #E2E8F0">
        Ribba B.V. · vragen?
        <a href="mailto:team@ribba.nl" style="color:#2563EB;text-decoration:none;font-weight:600">team@ribba.nl</a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>
  `.trim();
}

function milestoneLabel(milestone: ReferralMilestone): string {
  return milestone === 'proefles' ? 'proefles gehad' : 'eerste les betaald';
}

function rewardLabel(reward: RewardSnapshotItem): string {
  return reward.reward_kind === 'cash' && reward.amount_cents != null
    ? formatCentsForDisplay(reward.amount_cents)
    : 'een gratis les';
}

export async function sendPartnerWelcomeMail(params: {
  schoolId: string;
  partnerEmail: string;
  schoolName: string;
  referralUrl: string;
  rewards: RewardSnapshotItem[];
}): Promise<void> {
  const rewardRows = params.rewards
    .map(
      (r) => `
      <tr>
        <td style="padding:0 16px 14px 16px;font-size:13px;color:#64748B">${escapeHtml(milestoneLabel(r.milestone))}</td>
        <td style="padding:0 16px 14px 16px;font-size:14px;color:#0F172A;font-weight:600">${escapeHtml(rewardLabel(r))}</td>
      </tr>`,
    )
    .join('');

  const html = wrap({
    pillLabel: 'Referral-partner',
    pillBg: '#CCFBF1',
    pillColor: '#134E4A',
    title: `Je doet mee met het programma van ${params.schoolName}`,
    bodyHtml: `
      <p style="margin:0 0 16px">Welkom! Deel jouw persoonlijke link met vrienden of familie die rijles zoeken bij <strong>${escapeHtml(params.schoolName)}</strong>. Schrijft iemand zich via jouw link in, dan verdien jij de beloning zodra de milestone is gehaald én de rijschool die bevestigt.</p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F8FAFC;border-radius:12px;margin:16px 0">
        <tr>
          <td style="padding:14px 16px 6px 16px;font-size:13px;color:#64748B" colspan="2">Jouw referral-link</td>
        </tr>
        <tr>
          <td style="padding:0 16px 14px 16px;font-size:14px;color:#0F172A;font-weight:600;word-break:break-all" colspan="2"><a href="${params.referralUrl}" style="color:#2563EB">${escapeHtml(params.referralUrl)}</a></td>
        </tr>
        ${rewardRows}
      </table>
      <p style="margin:16px 0 8px;font-size:14px;color:#475569">Op je partnerpagina zie je al je aanmeldingen, hun status en je verdiende commissie.</p>
    `,
    ctaLabel: 'Open je partnerpagina',
    ctaHref: PARTNER_PORTAL_URL,
    ctaColor: '#0D9488',
  });
  await sendMail(params.partnerEmail, `Je referral-link voor ${params.schoolName}`, html, {
    schoolId: params.schoolId,
    emailType: 'referral_partner_welcome',
  });
}

export async function sendPartnerReferralRegisteredMail(params: {
  schoolId: string;
  partnerEmail: string;
  schoolName: string;
  referredFirstName: string;
}): Promise<void> {
  const html = wrap({
    pillLabel: 'Nieuwe aanmelding',
    pillBg: '#DBEAFE',
    pillColor: '#1E3A8A',
    title: `${params.referredFirstName} heeft zich aangemeld via jouw link`,
    bodyHtml: `
      <p style="margin:0 0 16px"><strong>${escapeHtml(params.referredFirstName)}</strong> heeft zich zojuist ingeschreven bij <strong>${escapeHtml(params.schoolName)}</strong> via jouw referral-link. 🎉</p>
      <p style="margin:0 0 8px;font-size:14px;color:#475569">Zodra de milestones (zoals de proefles of de eerste betaalde les) zijn gehaald en de rijschool ze bevestigt, zie je je commissie op je partnerpagina verschijnen.</p>
    `,
    ctaLabel: 'Bekijk je referrals',
    ctaHref: PARTNER_PORTAL_URL,
    ctaColor: '#0D9488',
  });
  await sendMail(params.partnerEmail, `Nieuwe aanmelding via jouw link bij ${params.schoolName}`, html, {
    schoolId: params.schoolId,
    emailType: 'referral_registered',
  });
}

export async function sendPartnerMilestoneMail(params: {
  schoolId: string;
  partnerEmail: string;
  schoolName: string;
  referredFirstName: string;
  milestone: ReferralMilestone;
  reward: RewardSnapshotItem;
}): Promise<void> {
  const html = wrap({
    pillLabel: 'Milestone gehaald',
    pillBg: '#FEF3C7',
    pillColor: '#92400E',
    title: `${params.referredFirstName} heeft de milestone "${milestoneLabel(params.milestone)}" gehaald`,
    bodyHtml: `
      <p style="margin:0 0 16px">Goed nieuws: <strong>${escapeHtml(params.referredFirstName)}</strong> heeft bij <strong>${escapeHtml(params.schoolName)}</strong> de milestone <strong>${escapeHtml(milestoneLabel(params.milestone))}</strong> bereikt.</p>
      <p style="margin:0 0 8px;font-size:14px;color:#475569">Jouw beloning van <strong>${escapeHtml(rewardLabel(params.reward))}</strong> staat klaar en wacht op bevestiging door de rijschool. Zodra die bevestigt, wordt de uitbetaling in gang gezet.</p>
    `,
    ctaLabel: 'Bekijk je commissie',
    ctaHref: PARTNER_PORTAL_URL,
    ctaColor: '#0D9488',
  });
  await sendMail(params.partnerEmail, `Commissie in aantocht: ${milestoneLabel(params.milestone)}`, html, {
    schoolId: params.schoolId,
    emailType: 'referral_milestone',
  });
}

export async function sendPartnerPayoutConfirmedMail(params: {
  schoolId: string;
  partnerEmail: string;
  schoolName: string;
  amountCents: number;
}): Promise<void> {
  const html = wrap({
    pillLabel: 'Uitbetaling onderweg',
    pillBg: '#CCFBF1',
    pillColor: '#134E4A',
    title: `${params.schoolName} heeft je uitbetaling bevestigd`,
    bodyHtml: `
      <p style="margin:0 0 16px">Je commissie van <strong>${formatCentsForDisplay(params.amountCents)}</strong> is bevestigd door <strong>${escapeHtml(params.schoolName)}</strong> en de betaling is in gang gezet.</p>
      <p style="margin:0 0 8px;font-size:14px;color:#475569">De betaling loopt via SEPA-incasso en duurt daardoor <strong>enkele werkdagen</strong>. Zodra het bedrag naar je rekening is overgemaakt, krijg je opnieuw een mailtje.</p>
    `,
    ctaLabel: 'Bekijk de status',
    ctaHref: PARTNER_PORTAL_URL,
    ctaColor: '#0D9488',
  });
  await sendMail(params.partnerEmail, `Je uitbetaling van ${formatCentsForDisplay(params.amountCents)} is onderweg`, html, {
    schoolId: params.schoolId,
    emailType: 'referral_payout_confirmed',
  });
}

export async function sendPartnerPayoutPaidMail(params: {
  schoolId: string;
  partnerEmail: string;
  schoolName: string;
  amountCents: number;
}): Promise<void> {
  const html = wrap({
    pillLabel: 'Uitbetaald',
    pillBg: '#DCFCE7',
    pillColor: '#14532D',
    title: `${formatCentsForDisplay(params.amountCents)} is naar je onderweg`,
    bodyHtml: `
      <p style="margin:0 0 16px">Je commissie van <strong>${formatCentsForDisplay(params.amountCents)}</strong> van <strong>${escapeHtml(params.schoolName)}</strong> is overgemaakt naar je uitbetaalrekening via Stripe. 💸</p>
      <p style="margin:0 0 8px;font-size:14px;color:#475569">Afhankelijk van je bank kan het nog 1–2 werkdagen duren voordat het bedrag zichtbaar is.</p>
    `,
    ctaLabel: 'Open je partnerpagina',
    ctaHref: PARTNER_PORTAL_URL,
    ctaColor: '#0D9488',
  });
  await sendMail(params.partnerEmail, `Uitbetaald: ${formatCentsForDisplay(params.amountCents)}`, html, {
    schoolId: params.schoolId,
    emailType: 'referral_payout_paid',
  });
}

export async function sendPartnerKycNudgeMail(params: {
  schoolId: string;
  partnerEmail: string;
  pendingAmountCents: number;
}): Promise<void> {
  const html = wrap({
    pillLabel: 'Actie nodig',
    pillBg: '#FEE2E2',
    pillColor: '#991B1B',
    title: 'Rond je uitbetaalgegevens af om je commissie te ontvangen',
    bodyHtml: `
      <p style="margin:0 0 16px">Er staat <strong>${formatCentsForDisplay(params.pendingAmountCents)}</strong> aan bevestigde commissie voor je klaar, maar we kunnen pas uitbetalen als je je uitbetaalgegevens hebt afgerond via Stripe (onze betaalpartner).</p>
      <p style="margin:0 0 8px;font-size:14px;color:#475569">Dit duurt een paar minuten: je vult je naam, geboortedatum en rekeningnummer in. Stripe verzorgt de verificatie — Ribba slaat deze gegevens zelf niet op.</p>
    `,
    ctaLabel: 'Uitbetaalgegevens afronden',
    ctaHref: PARTNER_PORTAL_URL,
    ctaColor: '#2563EB',
  });
  await sendMail(params.partnerEmail, 'Je commissie staat klaar — rond je uitbetaalgegevens af', html, {
    schoolId: params.schoolId,
    emailType: 'referral_kyc_nudge',
  });
}

// Interne alert naar team@ribba.nl (disputes/refunds op referral-incasso's:
// handmatige ops-actie nodig, bv. transfer-reversal).
export async function sendTeamReferralAlertMail(params: {
  schoolId: string;
  subject: string;
  lines: string[];
}): Promise<void> {
  const html = wrap({
    pillLabel: 'Referral ops-alert',
    pillBg: '#FEE2E2',
    pillColor: '#991B1B',
    title: params.subject,
    bodyHtml: params.lines
      .map((l) => `<p style="margin:0 0 8px;font-size:14px;color:#1E293B">${escapeHtml(l)}</p>`)
      .join(''),
  });
  await sendMail('team@ribba.nl', `[referral] ${params.subject}`, html, {
    schoolId: params.schoolId,
    emailType: 'referral_ops_alert',
  });
}

export async function sendSchoolChargeFailedMail(params: {
  schoolId: string;
  schoolEmail: string;
  schoolName: string;
  totalCents: number;
  reason: string | null;
}): Promise<void> {
  const html = wrap({
    pillLabel: 'Incasso mislukt',
    pillBg: '#FEE2E2',
    pillColor: '#991B1B',
    title: 'De incasso voor een referral-uitbetaling is mislukt',
    bodyHtml: `
      <p style="margin:0 0 16px">De SEPA-incasso van <strong>${formatCentsForDisplay(params.totalCents)}</strong> (commissie + servicekosten) voor een bevestigde referral-uitbetaling van <strong>${escapeHtml(params.schoolName)}</strong> is niet gelukt.</p>
      ${params.reason ? `<p style="margin:0 0 16px;font-size:14px;color:#475569">Reden: ${escapeHtml(params.reason)}</p>` : ''}
      <p style="margin:0 0 8px;font-size:14px;color:#475569">Controleer je betaalinstellingen en probeer de uitbetaling daarna opnieuw vanuit de Ribba-app (Referrals → Uitbetalingen).</p>
    `,
    ctaLabel: 'Betaalinstellingen controleren',
    ctaHref: `${ACCOUNT_BASE_URL}/mijn-ribba/referral/betaling`,
    ctaColor: '#2563EB',
  });
  await sendMail(params.schoolEmail, 'Incasso referral-uitbetaling mislukt', html, {
    schoolId: params.schoolId,
    emailType: 'referral_charge_failed',
  });
}
