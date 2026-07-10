// Marketplace-e-mails: outreach naar rijscholen bij een nieuwe inquiry en
// reply-notificaties bij nieuwe chatberichten. Zelfde huisstijl als
// lib/school-emails.ts, maar zonder logBillingEvent (dat vereist een
// drivingschool-uuid; marketplace werkt met integer cbr_rijscholen-ids).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://link.ribba.app';
const LOGO_URL = `${BASE_URL}/ribba-logo.png`;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Geanonimiseerde weergavenaam van de leerling: alleen de voornaam.
export function anonymizedFirstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] || 'Leerling';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

async function sendMail(to: string, subject: string, html: string, emailType: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn('marketplace-emails: RESEND_API_KEY not set, skipping', emailType, to);
    return false;
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
    const errText = await res.text().catch(() => '');
    console.error('marketplace-emails: send failed', emailType, res.status, errText.slice(0, 500));
    return false;
  }
  return true;
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
  footerHtml?: string;
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
        ${opts.footerHtml || ''}
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

function detailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 16px;font-size:13px;color:#64748B;width:160px;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:10px 16px;font-size:14px;color:#0F172A;font-weight:600">${escapeHtml(value)}</td>
    </tr>
  `;
}

export interface OutreachMailInput {
  to: string;
  rijschoolName: string;
  leerlingFullName: string; // wordt geanonimiseerd tot voornaam
  rijbewijsCategorie: string;
  schakeling: string | null;
  gewensteStartdatum: string | null; // ISO date
  bericht: string | null;
  chatToken: string;
  recipientId: string; // voor de app-deep-link /r/{recipient_id} (ribbaPro#139)
}

// Universal link die de Ribba app opent als die geïnstalleerd is; zonder app
// toont link.ribba.app/i|/r een download-fallback. Claimen via deze kale id
// kan alleen met e-mail-match (claim-RPC's), dus de link is geen bearer-token.
function appLinkBlock(path: string): string {
  return `
    <p style="margin:14px 0 0;font-size:13px;color:#64748B">
      Heb je de Ribba app? <a href="${BASE_URL}${path}" style="color:#2563EB;font-weight:600">Open dit gesprek in de app</a> voor push-meldingen bij elk bericht.
    </p>
  `;
}

// Outreach naar de rijschool: nieuwe aanvraag, geanonimiseerd (alleen
// voornaam, geen e-mail/telefoon — contact-reveal volgt pas na accepteren).
export async function sendRijschoolOutreachMail(input: OutreachMailInput): Promise<boolean> {
  const voornaam = anonymizedFirstName(input.leerlingFullName);
  const chatUrl = `${BASE_URL}/chat/${input.chatToken}`;

  const rows = [
    detailRow('Leerling', voornaam),
    detailRow('Rijbewijscategorie', input.rijbewijsCategorie),
    input.schakeling ? detailRow('Schakeling', input.schakeling) : '',
    input.gewensteStartdatum ? detailRow('Gewenste start', formatDate(input.gewensteStartdatum)) : '',
  ].join('');

  const berichtBlok = input.bericht
    ? `
      <p style="margin:16px 0 6px;font-size:13px;color:#64748B;font-weight:700">Bericht van ${escapeHtml(voornaam)}:</p>
      <p style="margin:0 0 8px;padding:12px 16px;background:#F0FDFA;border-radius:12px;font-size:14px;color:#0F172A">${escapeHtml(input.bericht)}</p>
    `
    : '';

  const html = wrap({
    pillLabel: 'Nieuwe aanvraag',
    pillBg: '#CCFBF1',
    pillColor: '#134E4A',
    title: `${voornaam} zoekt een rijschool en koos jou`,
    bodyHtml: `
      <p style="margin:0 0 12px">Beste ${escapeHtml(input.rijschoolName)},</p>
      <p style="margin:0 0 16px">Via <strong>ribba.app</strong> heeft een leerling een informatie-aanvraag naar jouw rijschool gestuurd. Reageer via de beveiligde chat — geen account of app nodig, e-mailverificatie is genoeg.</p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F8FAFC;border-radius:12px;margin:8px 0">
        ${rows}
      </table>
      ${berichtBlok}
      <p style="margin:16px 0 0;font-size:13px;color:#64748B">Contactgegevens van de leerling worden zichtbaar zodra je de aanvraag accepteert. Tot die tijd verloopt alle communicatie anoniem via Ribba.</p>
      ${appLinkBlock(`/r/${input.recipientId}`)}
    `,
    ctaLabel: 'Beantwoord de aanvraag',
    ctaHref: chatUrl,
    ctaColor: '#0D9488',
    footerHtml: `Je ontvangt dit bericht omdat een leerling jouw rijschool selecteerde op ribba.app.<br>`,
  });

  return sendMail(
    input.to,
    `Nieuwe rijles-aanvraag van ${voornaam} via Ribba`,
    html,
    'rijschool_outreach',
  );
}

export interface LeerlingBevestigingInput {
  to: string;
  leerlingFullName: string;
  schoolNames: string[];
}

// Bevestigingsmail naar de leerling direct na de submit: verwachtingen
// zetten ("rijscholen reageren meestal binnen 24 uur") en het eerste
// contactmoment — zo landt de latere reply-notificatie niet koud in spam.
export async function sendLeerlingBevestigingMail(input: LeerlingBevestigingInput): Promise<boolean> {
  const voornaam = anonymizedFirstName(input.leerlingFullName);
  const count = input.schoolNames.length;
  const lijst = input.schoolNames
    .map((n) => `<li style="margin:4px 0">${escapeHtml(n)}</li>`)
    .join('');

  const html = wrap({
    pillLabel: 'Aanvraag verzonden',
    pillBg: '#CCFBF1',
    pillColor: '#134E4A',
    title: `Je aanvraag is onderweg, ${voornaam}!`,
    bodyHtml: `
      <p style="margin:0 0 12px">We hebben je aanvraag doorgestuurd naar ${count === 1 ? 'deze rijschool' : `deze ${count} rijscholen`}:</p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#0F172A">${lijst}</ul>
      <p style="margin:0 0 12px">Rijscholen reageren meestal <strong>binnen 24 uur</strong>. Zodra een rijschool antwoordt, krijg je van ons een e-mail met een link naar de beveiligde chat — geen account of app nodig.</p>
      <p style="margin:0;font-size:13px;color:#64748B">Tip: houd ook je spam-map in de gaten, zodat je geen reactie mist.</p>
    `,
    footerHtml: `Je ontvangt dit bericht omdat je via ribba.app een informatie-aanvraag verstuurde.<br>`,
  });

  return sendMail(
    input.to,
    count === 1
      ? 'Je aanvraag is verstuurd — Ribba'
      : `Je aanvraag is verstuurd naar ${count} rijscholen — Ribba`,
    html,
    'leerling_bevestiging',
  );
}

export interface ReplyNotificationInput {
  to: string;
  senderName: string;     // geanonimiseerd: voornaam leerling of rijschoolnaam
  messageCount: number;
  preview: string;        // korte preview van het nieuwste bericht
  chatToken: string;      // token van de ontvangende kant → /chat/{token}
  appPath: string;        // universal link: /i/{inquiry_id} (leerling) of /r/{recipient_id} (rijschool)
}

// Reply-notificatie (issue ribba.app#44): de ontvanger heeft geen actieve
// push, dus e-mail met link naar de web-chat gate + app-download prompt.
// De chat-token van de ontvangende kant fungeert ook als opt-out-token.
export async function sendReplyNotificationMail(input: ReplyNotificationInput): Promise<boolean> {
  const chatUrl = `${BASE_URL}/chat/${input.chatToken}`;
  const optOutUrl = `${BASE_URL}/api/notifications/opt-out?token=${input.chatToken}`;
  const preview = input.preview.length > 120 ? `${input.preview.slice(0, 117)}…` : input.preview;
  const single = input.messageCount === 1;

  const html = wrap({
    pillLabel: single ? 'Nieuw bericht' : `${input.messageCount} nieuwe berichten`,
    pillBg: '#DBEAFE',
    pillColor: '#1E40AF',
    title: single
      ? `Je hebt een reactie van ${input.senderName}`
      : `Je hebt ${input.messageCount} nieuwe berichten van ${input.senderName}`,
    bodyHtml: `
      <p style="margin:0 0 8px;padding:12px 16px;background:#F8FAFC;border-radius:12px;font-size:14px;color:#0F172A;font-style:italic">“${escapeHtml(preview)}”</p>
      <p style="margin:16px 0 0;font-size:14px;color:#475569">Open de beveiligde chat om te antwoorden — geen account of app nodig, e-mailverificatie is genoeg.</p>
      <p style="margin:16px 0 0;font-size:14px;color:#475569"><strong>Tip:</strong> download de Ribba app om je berichten te volgen met push-meldingen, zonder browser-tab:</p>
      <p style="margin:12px 0 0">
        <a href="https://apps.apple.com/nl/app/ribba-rijles-planner/id6757161459" style="color:#2563EB;font-weight:600;font-size:14px">App Store</a>
        &nbsp;·&nbsp;
        <a href="https://play.google.com/store/apps/details?id=app.ribba.pro" style="color:#2563EB;font-weight:600;font-size:14px">Google Play</a>
      </p>
      ${appLinkBlock(input.appPath)}
    `,
    ctaLabel: 'Open de chat',
    ctaHref: chatUrl,
    ctaColor: '#2563EB',
    footerHtml: `<a href="${optOutUrl}" style="color:#94A3B8;text-decoration:underline">Geen e-mails meer over deze gesprekken</a><br>`,
  });

  return sendMail(
    input.to,
    single
      ? `Je hebt een reactie van ${input.senderName} — Ribba`
      : `${input.messageCount} nieuwe berichten van ${input.senderName} — Ribba`,
    html,
    'reply_notification',
  );
}
