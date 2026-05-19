// Admin notification emails — verstuurd naar de Ribba beheerder bij belangrijke
// events: nieuwe rijschool, abonnement geactiveerd, abonnement opgezegd.
// Bevat altijd een summary van het totale aantal rijscholen + actieve abonnementen.

import { createClient } from '@supabase/supabase-js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'info@010rijbewijs.nl';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export type AdminEventType =
  | 'school_registered'
  | 'subscription_activated'
  | 'subscription_cancelled';

interface SchoolInfo {
  id?: string;
  name: string;
  email?: string | null;
  city?: string | null;
  billing_plan?: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchStats(): Promise<{
  total: number;
  active: number;
  premium: number;
  basic: number;
  trial: number;
  thisMonth: number;
}> {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await supabase
      .from('drivingschools')
      .select('id, status, billing_plan, is_trial, created_at');
    if (error || !data) return { total: 0, active: 0, premium: 0, basic: 0, trial: 0, thisMonth: 0 };

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    return {
      total: data.length,
      active: data.filter((s: any) => s.status === 'active').length,
      premium: data.filter((s: any) => s.billing_plan === 'premium' && !s.is_trial).length,
      basic: data.filter((s: any) => s.billing_plan === 'basic' && !s.is_trial).length,
      trial: data.filter((s: any) => s.is_trial === true).length,
      thisMonth: data.filter((s: any) => s.created_at && new Date(s.created_at) >= startOfMonth).length,
    };
  } catch (e) {
    console.error('admin-notifications: stats fetch failed', e);
    return { total: 0, active: 0, premium: 0, basic: 0, trial: 0, thisMonth: 0 };
  }
}

function eventLabel(type: AdminEventType): { emoji: string; subject: string; title: string; color: string } {
  switch (type) {
    case 'school_registered':
      return { emoji: '🎉', subject: 'Nieuwe rijschool aangemeld', title: 'Nieuwe rijschool', color: '#10b981' };
    case 'subscription_activated':
      return { emoji: '💰', subject: 'Abonnement geactiveerd', title: 'Abonnement geactiveerd', color: '#0d9488' };
    case 'subscription_cancelled':
      return { emoji: '⚠️', subject: 'Abonnement opgezegd', title: 'Abonnement opgezegd', color: '#f59e0b' };
  }
}

function buildHtml(type: AdminEventType, school: SchoolInfo, stats: Awaited<ReturnType<typeof fetchStats>>): string {
  const ev = eventLabel(type);
  const planLabel = school.billing_plan
    ? school.billing_plan.charAt(0).toUpperCase() + school.billing_plan.slice(1)
    : '—';

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
      <tr><td style="background:${ev.color};padding:24px 28px;color:#ffffff">
        <div style="font-size:30px;margin-bottom:8px">${ev.emoji}</div>
        <h1 style="margin:0;font-size:20px;font-weight:800">${ev.title}</h1>
      </td></tr>
      <tr><td style="padding:24px 28px">
        <h2 style="margin:0 0 12px 0;font-size:18px;font-weight:700">${escapeHtml(school.name)}</h2>
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:14px;color:#475569">
          ${school.email ? `<tr><td style="padding:4px 0"><strong>E-mail:</strong> ${escapeHtml(school.email)}</td></tr>` : ''}
          ${school.city ? `<tr><td style="padding:4px 0"><strong>Plaats:</strong> ${escapeHtml(school.city)}</td></tr>` : ''}
          ${school.billing_plan ? `<tr><td style="padding:4px 0"><strong>Plan:</strong> ${escapeHtml(planLabel)}</td></tr>` : ''}
        </table>
      </td></tr>
      <tr><td style="padding:8px 28px 24px 28px">
        <h3 style="margin:8px 0 12px 0;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Samenvatting</h3>
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f8fafc;border-radius:10px;padding:6px">
          <tr>
            <td style="padding:10px 14px;text-align:center;border-right:1px solid #e2e8f0">
              <div style="font-size:24px;font-weight:800;color:#0f172a">${stats.total}</div>
              <div style="font-size:11px;color:#64748b">Totaal</div>
            </td>
            <td style="padding:10px 14px;text-align:center;border-right:1px solid #e2e8f0">
              <div style="font-size:24px;font-weight:800;color:#10b981">${stats.active}</div>
              <div style="font-size:11px;color:#64748b">Actief</div>
            </td>
            <td style="padding:10px 14px;text-align:center">
              <div style="font-size:24px;font-weight:800;color:#3b82f6">${stats.thisMonth}</div>
              <div style="font-size:11px;color:#64748b">Deze maand</div>
            </td>
          </tr>
        </table>
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:10px;background:#f8fafc;border-radius:10px;padding:6px">
          <tr>
            <td style="padding:10px 14px;text-align:center;border-right:1px solid #e2e8f0">
              <div style="font-size:20px;font-weight:700;color:#0d9488">${stats.premium}</div>
              <div style="font-size:11px;color:#64748b">Premium</div>
            </td>
            <td style="padding:10px 14px;text-align:center;border-right:1px solid #e2e8f0">
              <div style="font-size:20px;font-weight:700;color:#6b7280">${stats.basic}</div>
              <div style="font-size:11px;color:#64748b">Basic</div>
            </td>
            <td style="padding:10px 14px;text-align:center">
              <div style="font-size:20px;font-weight:700;color:#f59e0b">${stats.trial}</div>
              <div style="font-size:11px;color:#64748b">Trial</div>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="background:#0f172a;color:#94a3b8;padding:14px 28px;font-size:11px;text-align:center">
        Automatisch verzonden door Ribba · ${new Date().toLocaleString('nl-NL')}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
  `.trim();
}

export async function sendAdminNotification(type: AdminEventType, school: SchoolInfo): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log('admin-notifications: RESEND_API_KEY not set, skipping', type, school.name);
    return;
  }
  try {
    const stats = await fetchStats();
    const ev = eventLabel(type);
    const html = buildHtml(type, school, stats);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Ribba <noreply@ribba.app>',
        to: ADMIN_EMAIL,
        subject: `${ev.emoji} ${ev.subject}: ${school.name}`,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('admin-notifications: send failed', res.status, errText);
    }
  } catch (e) {
    console.error('admin-notifications: unexpected error', e);
  }
}
