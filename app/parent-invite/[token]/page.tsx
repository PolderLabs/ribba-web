'use client';

import { useState, useEffect, FormEvent, use } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../../components/RibbaLogo';
import { AppStoreBadge, GooglePlayBadge } from '../../components/StoreBadges';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

type InviteInfo = {
  id: string;
  invite_email: string;
  invite_status: 'pending' | 'accepted' | 'declined' | 'expired';
  student: { first_name: string; last_name: string } | null;
  school: { name: string } | null;
};

type Phase =
  | 'loading'
  | 'invalid'
  | 'already_accepted'
  | 'pending'
  | 'submitting'
  | 'success';

export default function ParentInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [phase, setPhase] = useState<Phase>('loading');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      // Lookup the invite via the public-readable token (pending invites only per RLS)
      const { data, error } = await supabase
        .from('parent_links')
        .select('id, invite_email, invite_status, student:students(first_name,last_name), school:drivingschools(name)')
        .eq('invite_token', token)
        .maybeSingle();

      if (error || !data) {
        setPhase('invalid');
        return;
      }
      const info: InviteInfo = data as any;
      setInvite(info);
      if (info.invite_status === 'accepted') {
        setPhase('already_accepted');
      } else if (info.invite_status === 'declined' || info.invite_status === 'expired') {
        setPhase('invalid');
      } else {
        setPhase('pending');
      }
    })();
  }, [token]);

  const studentName = invite?.student
    ? `${invite.student.first_name} ${invite.student.last_name}`
    : 'de leerling';
  const schoolName = invite?.school?.name ?? 'de rijschool';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setErrorMsg(null);

    if (password.length < 6) {
      setErrorMsg('Wachtwoord moet minimaal 6 tekens zijn.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Wachtwoorden komen niet overeen.');
      return;
    }

    setPhase('submitting');
    const supabase = getSupabase();

    // Try signing in first (if account already exists)
    let userId: string | null = null;
    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
      email: invite.invite_email,
      password,
    });

    if (signIn?.user) {
      userId = signIn.user.id;
    } else if (signInErr) {
      // No existing account → create one
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email: invite.invite_email,
        password,
        options: { data: { role: 'parent' } },
      });
      if (signUpErr || !signUp.user) {
        setErrorMsg('Kon account niet aanmaken: ' + (signUpErr?.message ?? 'onbekende fout'));
        setPhase('pending');
        return;
      }
      userId = signUp.user.id;
    }

    if (!userId) {
      setErrorMsg('Onbekende fout bij inloggen / registreren.');
      setPhase('pending');
      return;
    }

    // Mark invite as accepted + link parent_user_id
    const { error: updateErr } = await supabase
      .from('parent_links')
      .update({
        parent_user_id: userId,
        invite_status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invite.id);

    if (updateErr) {
      setErrorMsg('Account is aangemaakt maar koppeling mislukt: ' + updateErr.message);
      setPhase('pending');
      return;
    }

    setPhase('success');
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <RibbaLogo height={32} />
        </div>

        {phase === 'loading' && (
          <p style={styles.statusText}>Uitnodiging laden...</p>
        )}

        {phase === 'invalid' && (
          <div style={styles.center}>
            <div style={{ ...styles.iconCircle, background: '#fee2e2' }}>
              <span style={{ fontSize: 32 }}>⚠️</span>
            </div>
            <h1 style={styles.title}>Uitnodiging niet geldig</h1>
            <p style={styles.subtitle}>
              Deze uitnodigingslink is verlopen, ingetrokken of bestaat niet meer.
              Vraag de rijschool om een nieuwe uitnodiging.
            </p>
          </div>
        )}

        {phase === 'already_accepted' && (
          <div style={styles.center}>
            <div style={{ ...styles.iconCircle, background: '#d1fae5' }}>
              <span style={{ fontSize: 32 }}>✅</span>
            </div>
            <h1 style={styles.title}>Al geaccepteerd</h1>
            <p style={styles.subtitle}>
              Je hebt deze uitnodiging al geaccepteerd. Open de Ribba app om de gegevens
              van {studentName} te bekijken.
            </p>
            <AppLinks />
          </div>
        )}

        {phase === 'pending' && invite && (
          <>
            <div style={styles.center}>
              <h1 style={styles.title}>Uitnodiging accepteren</h1>
              <p style={styles.subtitle}>
                <strong>{schoolName}</strong> heeft je uitgenodigd om de rijlessen van{' '}
                <strong>{studentName}</strong> te volgen via de Ribba app.
              </p>
            </div>

            <div style={styles.permsBox}>
              <strong style={styles.permsTitle}>Je krijgt toegang tot:</strong>
              <ul style={styles.permsList}>
                <li>📅 Geplande en gevolgde rijlessen</li>
                <li>📈 Voortgang en leskaart</li>
                <li>🧾 Facturen — incl. direct betalen via iDEAL</li>
              </ul>
            </div>

            <form onSubmit={handleSubmit} style={styles.form}>
              <label style={styles.label}>E-mail</label>
              <input
                type="email"
                value={invite.invite_email}
                disabled
                style={{ ...styles.input, background: '#f1f5f9', color: '#64748b' }}
              />

              <label style={styles.label}>Wachtwoord (min. 6 tekens)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                style={styles.input}
                autoComplete="new-password"
              />

              <label style={styles.label}>Wachtwoord bevestigen</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                style={styles.input}
                autoComplete="new-password"
              />

              {errorMsg && (
                <div style={styles.errorBox}>{errorMsg}</div>
              )}

              <button type="submit" style={styles.btnPrimary}>
                Account aanmaken & accepteren
              </button>

              <p style={styles.fineprint}>
                Heb je al een Ribba-account met dit e-mailadres? Vul je bestaande wachtwoord in
                om de koppeling te maken.
              </p>
            </form>
          </>
        )}

        {phase === 'submitting' && (
          <p style={styles.statusText}>Account aanmaken & koppelen...</p>
        )}

        {phase === 'success' && (
          <div style={styles.center}>
            <div style={{ ...styles.iconCircle, background: '#d1fae5' }}>
              <span style={{ fontSize: 32 }}>🎉</span>
            </div>
            <h1 style={styles.title}>Gelukt!</h1>
            <p style={styles.subtitle}>
              Je bent gekoppeld aan {studentName}. Download nu de Ribba app om verder te gaan.
            </p>
            <AppLinks />
          </div>
        )}
      </div>
    </div>
  );
}

function AppLinks() {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 20 }}>
      <AppStoreBadge height={48} />
      <GooglePlayBadge height={48} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0f172a',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '40px 16px',
  },
  card: {
    background: '#ffffff',
    borderRadius: 20,
    padding: 32,
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
  },
  header: { display: 'flex', justifyContent: 'center', marginBottom: 20 },
  center: { textAlign: 'center' as const },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    margin: '0 auto 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' },
  subtitle: { fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 16px 0' },
  statusText: { textAlign: 'center' as const, color: '#64748b', padding: '32px 0' },
  permsBox: {
    background: '#f8fafc',
    borderRadius: 12,
    padding: '14px 18px',
    margin: '16px 0',
  },
  permsTitle: { fontSize: 13, color: '#0f172a' },
  permsList: { margin: '8px 0 0 0', paddingLeft: 20, color: '#475569', fontSize: 13, lineHeight: 1.8 },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 8 },
  input: {
    border: '1.5px solid #cbd5e1',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 15,
    color: '#0f172a',
    outline: 'none',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#b91c1c',
    fontSize: 13,
    marginTop: 12,
  },
  btnPrimary: {
    marginTop: 16,
    background: '#0D9488',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '13px 20px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  fineprint: { fontSize: 11, color: '#94a3b8', textAlign: 'center' as const, margin: '12px 0 0 0', lineHeight: 1.6 },
};
