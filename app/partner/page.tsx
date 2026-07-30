'use client';

// Partner-dashboard op link.ribba.app/partner: e-mail-OTP-login, per rijschool
// de referral-link, aanmeldingen met status en de commissie (verdiend + in
// behandeling). Stripe Express-onboarding start hiervandaan; na terugkeer
// (?onboarding=return) verversen we de accountstatus server-side.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import OtpGate from '@/components/chat/OtpGate';
import RibbaLogo from '@/app/components/RibbaLogo';
import { formatCentsForDisplay } from '@/lib/plan-pricing';
import { milestoneText, payoutStatusText, referralStatusText, rewardText } from '@/components/partner/labels';
import type { ReferralMilestone, ReferralPayoutStatus, ReferralStatus, RewardKind } from '@/lib/referral-types';

type MePayload = {
  partner: {
    email: string;
    display_name: string | null;
    payouts_enabled: boolean;
    stripe_onboarding_status: string;
    needs_onboarding: boolean;
  } | null;
  memberships: Array<{
    membership_id: string;
    code: string;
    status: 'active' | 'disabled';
    school_name: string | null;
    referral_url: string | null;
    counts: { registered: number; proefles: number; eerste_betaalde_les: number };
    earned_cents: number;
    pending_cents: number;
    referrals: Array<{ id: string; first_name: string; status: ReferralStatus; registered_at: string }>;
    payouts: Array<{
      id: string;
      milestone: ReferralMilestone;
      reward_kind: RewardKind;
      amount_cents: number | null;
      status: ReferralPayoutStatus;
      paid_at: string | null;
      created_at: string;
    }>;
  }>;
};

let browserClient: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PartnerDashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [me, setMe] = useState<MePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const loadMe = useCallback(async (activeSession: Session) => {
    setLoading(true);
    setError(null);
    try {
      // Terug van Stripe-onboarding? Eerst de accountstatus verversen zodat
      // payouts_enabled niet op de (tragere) webhook hoeft te wachten.
      const params = new URLSearchParams(window.location.search);
      if (params.get('onboarding') === 'return') {
        await fetch('/api/partner/stripe/status', {
          headers: { Authorization: `Bearer ${activeSession.access_token}` },
        }).catch(() => null);
        window.history.replaceState(null, '', '/partner');
      }

      const res = await fetch('/api/partner/me', {
        headers: { Authorization: `Bearer ${activeSession.access_token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Er ging iets mis.');
      }
      setMe(data as MePayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onbekende fout');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionChecked(true);
      if (session) void loadMe(session);
    });
  }, [loadMe]);

  async function startOnboarding() {
    if (!session) return;
    setOnboardBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/partner/stripe/onboard', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'Onboarding starten mislukt.');
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onbekende fout');
      setOnboardBusy(false);
    }
  }

  async function copyLink(url: string, membershipId: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(membershipId);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      /* clipboard geweigerd — de link staat toch al in beeld */
    }
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    setSession(null);
    setMe(null);
  }

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <RibbaLogo height={36} />
        </div>

        <p className="registration-pill">Referral-partner</p>
        <h1>Jouw partnerpagina</h1>

        {!sessionChecked ? null : !session ? (
          <>
            <p className="registration-description">
              Log in met het e-mailadres waarmee je meedoet aan een
              referral-programma.
            </p>
            <OtpGate
              supabase={getSupabase()}
              verifyLabel="Verifieer en log in"
              onVerified={(s) => {
                setSession(s);
                void loadMe(s);
              }}
            />
          </>
        ) : loading ? (
          <p className="registration-description">Laden…</p>
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : !me?.partner || me.memberships.length === 0 ? (
          <>
            <p className="registration-description">
              Je doet nog niet mee aan een referral-programma. Vraag je rijschool
              om hun uitnodigingslink (link.ribba.app/partner/join/…).
            </p>
            <button type="button" className="chat-link-button" onClick={() => { void signOut(); }}>
              Uitloggen
            </button>
          </>
        ) : (
          <>
            {me.partner.needs_onboarding && (
              <div className="alert alert-error" style={{ marginBottom: 20 }}>
                <strong>Rond je uitbetaalgegevens af</strong>
                <br />
                Er staat commissie voor je klaar, maar we kunnen pas uitbetalen als
                je je gegevens hebt geverifieerd bij Stripe (onze betaalpartner).
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={onboardBusy}
                    onClick={() => { void startOnboarding(); }}
                  >
                    {onboardBusy ? 'Bezig…' : 'Uitbetaalgegevens afronden'}
                  </button>
                </div>
              </div>
            )}

            {me.memberships.map((m) => (
              <div key={m.membership_id} style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 20, marginBottom: 4 }}>{m.school_name ?? 'Rijschool'}</h2>
                {m.status === 'disabled' ? (
                  <div className="alert alert-error">Je deelname aan dit programma is uitgeschakeld.</div>
                ) : (
                  m.referral_url && (
                    <>
                      <div className="form-group" style={{ marginTop: 8 }}>
                        <label>Jouw referral-link</label>
                        <input type="text" readOnly value={m.referral_url} onFocus={(e) => e.target.select()} />
                      </div>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => { void copyLink(m.referral_url!, m.membership_id); }}
                      >
                        {copiedCode === m.membership_id ? 'Gekopieerd ✓' : 'Kopieer link'}
                      </button>
                    </>
                  )
                )}

                <div style={{ display: 'flex', gap: 24, marginTop: 20, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#64748B' }}>Verdiend</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{formatCentsForDisplay(m.earned_cents)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#64748B' }}>In behandeling</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{formatCentsForDisplay(m.pending_cents)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#64748B' }}>Aanmeldingen</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>
                      {m.counts.registered + m.counts.proefles + m.counts.eerste_betaalde_les}
                    </div>
                  </div>
                </div>

                {m.referrals.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Jouw aanmeldingen</h3>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {m.referrals.map((r) => (
                        <li
                          key={r.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '10px 0',
                            borderBottom: '1px solid #E2E8F0',
                            fontSize: 14,
                          }}
                        >
                          <span>
                            <strong>{r.first_name}</strong>
                            <span style={{ color: '#94A3B8', marginLeft: 8 }}>{formatDate(r.registered_at)}</span>
                          </span>
                          <span style={{ color: '#475569' }}>{referralStatusText(r.status)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {m.payouts.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Jouw commissie</h3>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {m.payouts.map((p) => (
                        <li
                          key={p.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '10px 0',
                            borderBottom: '1px solid #E2E8F0',
                            fontSize: 14,
                          }}
                        >
                          <span>
                            <strong>
                              {rewardText({ milestone: p.milestone, reward_kind: p.reward_kind, amount_cents: p.amount_cents })}
                            </strong>
                            <span style={{ color: '#94A3B8', marginLeft: 8 }}>{milestoneText(p.milestone)}</span>
                          </span>
                          <span style={{ color: '#475569' }}>{payoutStatusText(p.status)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}

            <button type="button" className="chat-link-button" onClick={() => { void signOut(); }}>
              Uitloggen
            </button>
          </>
        )}

        <div className="divider" />
        <p className="footer-text">
          Vragen? Neem contact op met <a href="mailto:team@ribba.app">team@ribba.app</a>
        </p>
      </section>
    </main>
  );
}
