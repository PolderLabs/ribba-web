// School-facing e-mails: subscription bevestiging, payment failures,
// suspension, trial reminder. Stuurt branded mails naar de rijschool zelf
// via Resend. Zelfde huisstijl als lib/admin-notifications.ts.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://link.ribba.app';
const LOGO_URL = `${BASE_URL}/ribba-logo.png`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('school-emails: RESEND_API_KEY not set, skipping', subject, to);
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
  if (!res.ok) {
    const errText = await res.text();
    console.error('school-emails: send failed', res.status, errText);
  }
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
        Ribba · vragen?
        <a href="mailto:hallo@ribba.app" style="color:#2563EB;text-decoration:none;font-weight:600">hallo@ribba.app</a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>
  `.trim();
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatPrice(amount: number): string {
  return `€${amount.toFixed(2).replace('.', ',')}`;
}

export async function sendSubscriptionActivatedMail(
  schoolEmail: string,
  schoolName: string,
  plan: 'basic' | 'premium',
  pricePerMonth: number,
  nextChargeDate: Date | string,
): Promise<void> {
  const planLabel = plan === 'premium' ? 'Premium' : 'Basic';
  const subject = `Welkom bij Ribba ${planLabel}!`;
  const html = wrap({
    pillLabel: 'Abonnement actief',
    pillBg: '#CCFBF1',
    pillColor: '#134E4A',
    title: `Bedankt voor je abonnement, ${schoolName}!`,
    bodyHtml: `
      <p style="margin:0 0 16px">Je <strong>Ribba ${escapeHtml(planLabel)}</strong>-abonnement is geactiveerd. Je hebt direct toegang tot alle functies van je gekozen plan.</p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F8FAFC;border-radius:12px;margin:16px 0">
        <tr>
          <td style="padding:14px 16px;font-size:13px;color:#64748B;width:160px">Plan</td>
          <td style="padding:14px 16px;font-size:14px;color:#0F172A;font-weight:600">${escapeHtml(planLabel)}</td>
        </tr>
        <tr>
          <td style="padding:0 16px 14px 16px;font-size:13px;color:#64748B">Maandbedrag</td>
          <td style="padding:0 16px 14px 16px;font-size:14px;color:#0F172A;font-weight:600">${formatPrice(pricePerMonth)} excl. BTW</td>
        </tr>
        <tr>
          <td style="padding:0 16px 14px 16px;font-size:13px;color:#64748B">Volgende incasso</td>
          <td style="padding:0 16px 14px 16px;font-size:14px;color:#0F172A;font-weight:600">${formatDate(nextChargeDate)}</td>
        </tr>
      </table>
      <p style="margin:16px 0 8px;font-size:14px;color:#475569">De volgende maandbedragen gaan automatisch via SEPA-incasso van je rekening. Opzeggen kan altijd via <a href="${BASE_URL}/upgrade" style="color:#2563EB;font-weight:600">jouw abonnementspagina</a>.</p>
    `,
    ctaLabel: 'Open je dashboard',
    ctaHref: `${BASE_URL}/upgrade`,
    ctaColor: '#0D9488',
  });
  await sendMail(schoolEmail, subject, html);
}

export async function sendRecurringPaymentFailedMail(
  schoolEmail: string,
  schoolName: string,
  attempt: number,
): Promise<void> {
  const subject = `Incasso niet gelukt — controleer je rekening`;
  const html = wrap({
    pillLabel: 'Betaling mislukt',
    pillBg: '#FFEDD5',
    pillColor: '#9A3412',
    title: 'Incasso niet gelukt',
    bodyHtml: `
      <p style="margin:0 0 12px">Beste ${escapeHtml(schoolName)},</p>
      <p style="margin:0 0 12px">De automatische SEPA-incasso van je Ribba-abonnement is helaas niet gelukt (poging ${attempt} van 3). Vaak komt dit door onvoldoende saldo of een blokkade op de rekening.</p>
      <p style="margin:0 0 12px"><strong>Wat nu?</strong> We proberen het automatisch opnieuw. Zorg dat er voldoende saldo op je zakelijke rekening staat — anders wordt je abonnement na de derde mislukte poging opgeschort en verliezen je instructeurs toegang.</p>
      <p style="margin:0">Vragen of klopt er iets niet? Mail ons even op <a href="mailto:hallo@ribba.app" style="color:#2563EB;font-weight:600">hallo@ribba.app</a>.</p>
    `,
  });
  await sendMail(schoolEmail, subject, html);
}

export async function sendSubscriptionSuspendedMail(
  schoolEmail: string,
  schoolName: string,
): Promise<void> {
  const subject = `Je Ribba-abonnement is opgeschort`;
  const html = wrap({
    pillLabel: 'Opgeschort',
    pillBg: '#FEE2E2',
    pillColor: '#7F1D1D',
    title: 'Je abonnement is opgeschort',
    bodyHtml: `
      <p style="margin:0 0 12px">Beste ${escapeHtml(schoolName)},</p>
      <p style="margin:0 0 12px">Na drie mislukte SEPA-incassopogingen hebben we je Ribba-abonnement moeten opschorten. Je instructeurs hebben hierdoor geen toegang meer tot betaalde functies.</p>
      <p style="margin:0">Wil je weer aan de slag? Activeer je abonnement opnieuw via de knop hieronder. Vragen? Mail <a href="mailto:hallo@ribba.app" style="color:#2563EB;font-weight:600">hallo@ribba.app</a>.</p>
    `,
    ctaLabel: 'Abonnement reactiveren',
    ctaHref: `${BASE_URL}/upgrade`,
    ctaColor: '#2563EB',
  });
  await sendMail(schoolEmail, subject, html);
}

export async function sendTrialEndingReminderMail(
  schoolEmail: string,
  schoolName: string,
  daysLeft: number,
): Promise<void> {
  const isUrgent = daysLeft <= 1;
  const subject = isUrgent
    ? `Je proefperiode loopt morgen af — kies een abonnement`
    : `Nog ${daysLeft} dagen proefperiode — kies een abonnement`;
  const html = wrap({
    pillLabel: isUrgent ? 'Loopt morgen af' : `Nog ${daysLeft} dagen`,
    pillBg: isUrgent ? '#FEE2E2' : '#DBEAFE',
    pillColor: isUrgent ? '#991B1B' : '#1E40AF',
    title: isUrgent ? 'Je proefperiode loopt morgen af' : `Nog ${daysLeft} dagen proefperiode`,
    bodyHtml: `
      <p style="margin:0 0 12px">Beste ${escapeHtml(schoolName)},</p>
      <p style="margin:0 0 16px">Je gratis proefperiode van Ribba loopt ${isUrgent ? 'morgen' : `over ${daysLeft} dagen`} af. Om je rijschool zonder onderbreking te blijven beheren, kies een abonnement en stel je SEPA-machtiging in.</p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F8FAFC;border-radius:12px;margin:16px 0">
        <tr>
          <td style="padding:14px 16px;font-size:14px;color:#0F172A">
            <strong>Basic — €25 / maand</strong><br>
            <span style="font-size:13px;color:#64748B">1 instructeur, tot 30 leerlingen</span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 16px 14px 16px;font-size:14px;color:#0F172A;border-top:1px solid #E2E8F0;padding-top:14px">
            <strong>Premium — €45 / maand</strong><br>
            <span style="font-size:13px;color:#64748B">Onbeperkt leerlingen, tot 5 instructeurs, alle koppelingen</span>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#64748B">De eerste betaling gaat via iDEAL, daarna automatisch via SEPA-incasso. Opzeggen kan altijd.</p>
    `,
    ctaLabel: 'Kies een abonnement',
    ctaHref: `${BASE_URL}/upgrade`,
    ctaColor: isUrgent ? '#DC2626' : '#2563EB',
  });
  await sendMail(schoolEmail, subject, html);
}
