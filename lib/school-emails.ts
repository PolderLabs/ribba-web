// School-facing e-mails: payment failures, suspension, trial reminder.
// Stuurt branded mails naar de rijschool zelf via Resend.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://ribba.app';

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

function wrap(title: string, accent: string, body: string): string {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
      <tr><td style="background:${accent};padding:24px 28px;color:#ffffff">
        <h1 style="margin:0;font-size:20px;font-weight:800">${title}</h1>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:15px;line-height:1.6;color:#1e293b">
        ${body}
      </td></tr>
      <tr><td style="background:#0f172a;color:#94a3b8;padding:14px 28px;font-size:11px;text-align:center">
        Ribba · vragen? <a href="mailto:hallo@ribba.app" style="color:#94a3b8">hallo@ribba.app</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
  `.trim();
}

export async function sendRecurringPaymentFailedMail(
  schoolEmail: string,
  schoolName: string,
  attempt: number,
): Promise<void> {
  const subject = `Incasso niet gelukt — controleer je rekening`;
  const html = wrap(
    'Incasso niet gelukt',
    '#ea580c',
    `
    <p>Beste ${escapeHtml(schoolName)},</p>
    <p>De automatische SEPA-incasso van je Ribba-abonnement is helaas niet gelukt
    (poging ${attempt} van 3). Vaak komt dit door onvoldoende saldo of een
    blokkade op de rekening.</p>
    <p><strong>Wat nu?</strong> We proberen het automatisch opnieuw. Zorg dat
    er voldoende saldo op je zakelijke rekening staat — anders wordt je
    abonnement na de derde mislukte poging opgeschort en verliezen je
    instructeurs toegang.</p>
    <p>Vragen of klopt er iets niet? Mail ons even op
    <a href="mailto:hallo@ribba.app" style="color:#2563EB">hallo@ribba.app</a>.</p>
    `,
  );
  await sendMail(schoolEmail, subject, html);
}

export async function sendSubscriptionSuspendedMail(
  schoolEmail: string,
  schoolName: string,
): Promise<void> {
  const subject = `Je Ribba-abonnement is opgeschort`;
  const html = wrap(
    'Je abonnement is opgeschort',
    '#7f1d1d',
    `
    <p>Beste ${escapeHtml(schoolName)},</p>
    <p>Na drie mislukte SEPA-incassopogingen hebben we je Ribba-abonnement
    moeten opschorten. Je instructeurs hebben hierdoor geen toegang meer
    tot betaalde functies.</p>
    <p>Wil je weer aan de slag? Activeer je abonnement opnieuw via:</p>
    <p style="margin:20px 0">
      <a href="${BASE_URL}/upgrade" style="display:inline-block;background:#2563EB;color:#ffffff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">
        Abonnement reactiveren →
      </a>
    </p>
    <p>Vragen? Mail ons op
    <a href="mailto:hallo@ribba.app" style="color:#2563EB">hallo@ribba.app</a>.</p>
    `,
  );
  await sendMail(schoolEmail, subject, html);
}

export async function sendTrialEndingReminderMail(
  schoolEmail: string,
  schoolName: string,
  daysLeft: number,
): Promise<void> {
  const subject =
    daysLeft <= 1
      ? `Je proefperiode loopt morgen af — kies een abonnement`
      : `Nog ${daysLeft} dagen proefperiode — kies een abonnement`;
  const urgency = daysLeft <= 1 ? '#dc2626' : '#2563EB';
  const html = wrap(
    daysLeft <= 1 ? 'Je proefperiode loopt morgen af' : `Nog ${daysLeft} dagen proefperiode`,
    urgency,
    `
    <p>Beste ${escapeHtml(schoolName)},</p>
    <p>Je gratis proefperiode van Ribba loopt ${daysLeft <= 1 ? 'morgen' : `over ${daysLeft} dagen`} af.
    Om je rijschool zonder onderbreking te blijven beheren, kies een abonnement
    en stel je SEPA-machtiging in.</p>
    <p style="margin:20px 0">
      <a href="${BASE_URL}/upgrade" style="display:inline-block;background:${urgency};color:#ffffff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">
        Kies een abonnement →
      </a>
    </p>
    <p style="background:#f8fafc;border-radius:10px;padding:14px 16px;font-size:14px;color:#475569">
      <strong>Basic — €25 / maand:</strong> 1 instructeur, tot 30 leerlingen.<br>
      <strong>Premium — €45 / maand:</strong> onbeperkt instructeurs &amp; leerlingen, CBR-koppeling, Moneybird.
    </p>
    <p>De eerste betaling gaat via iDEAL, daarna automatisch via SEPA-incasso.
    Opzeggen kan altijd.</p>
    `,
  );
  await sendMail(schoolEmail, subject, html);
}
