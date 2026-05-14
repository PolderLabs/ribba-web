'use client';

import { useState, useRef, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../../components/RibbaLogo';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type School = { id: string; name: string; registration_slug: string };

type MigrationResult = {
  total_events_seen: number;
  lessons_imported: number;
  lessons_skipped: number;
  lessons_failed: number;
  busy_slots_imported: number;
  busy_slots_failed: number;
  students_matched: number;
  students_unmatched: string[];
  credit_updated: number;
  credit_failed: number;
};

type Phase = 'login' | 'form' | 'migrating' | 'done' | 'error';
type Mode = 'lessons' | 'credit' | 'both';

export default function PlangoImportLessonsPage() {
  const [phase, setPhase] = useState<Phase>('login');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminCreds, setAdminCreds] = useState<{ email: string; password: string } | null>(null);

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [plangoSlug, setPlangoSlug] = useState('');
  const [plangoEmail, setPlangoEmail] = useState('');
  const [plangoPassword, setPlangoPassword] = useState('');

  const [mode, setMode] = useState<Mode>('both');
  const [monthsBack, setMonthsBack] = useState(18);
  const [monthsForward, setMonthsForward] = useState(6);

  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    if (adminEmail !== 'onderates86@gmail.com') {
      setLoginError('Geen toegang tot dit admin panel');
      return;
    }
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });
    if (error) {
      setLoginError('Ongeldige inloggegevens');
      return;
    }
    setAdminCreds({ email: adminEmail, password: adminPassword });
    const { data } = await supabase
      .from('drivingschools')
      .select('id, name, registration_slug')
      .order('name');
    setSchools(data ?? []);
    setPhase('form');
  }

  async function handleMigrate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSchool || !plangoSlug || !plangoEmail || !plangoPassword) return;
    if (!adminCreds) { setPhase('login'); return; }

    setPhase('migrating');
    setLogs(['Verbinding maken met Plango...']);
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/plango-import-lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: plangoSlug.trim(),
          email: plangoEmail.trim(),
          password: plangoPassword,
          drivingschool_id: selectedSchool,
          admin_email: adminCreds?.email,
          admin_password: adminCreds?.password,
          mode,
          months_back: monthsBack,
          months_forward: monthsForward,
        }),
      });

      const data = await res.json();
      const allLogs = [
        ...(data.logs ?? []),
        ...(data.debug ? ['── debug ──', ...data.debug] : []),
      ];
      if (allLogs.length > 0) setLogs(allLogs);

      if (data.success) {
        setResult(data.result);
        setPhase('done');
      } else {
        setErrorMsg(data.error ?? 'Onbekende fout');
        setPhase('error');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Netwerkfout');
      setPhase('error');
    }
  }

  function resetForm() {
    setPhase('login');
    setAdminCreds(null);
    setPlangoSlug('');
    setPlangoEmail('');
    setPlangoPassword('');
    setSelectedSchool('');
    setLogs([]);
    setResult(null);
    setErrorMsg('');
  }

  const selectedSchoolName = schools.find((s) => s.id === selectedSchool)?.name ?? '';

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <RibbaLogo height={32} />
          <div style={styles.badge}>Admin</div>
        </div>

        <h1 style={styles.title}>Plango → Ribba: Lessen & Tegoed</h1>
        <p style={styles.subtitle}>
          Migreer agenda-lessen en huidig tegoed van een Plango rijschool.
          <br />
          <strong>Let op:</strong> leerlingen moeten eerst zijn geïmporteerd via{' '}
          <a href="/admin/plango-import" style={{ color: '#5eead4' }}>de leerlingen migratie</a>.
        </p>

        {phase === 'login' && (
          <form onSubmit={handleAdminLogin} style={styles.form}>
            <label style={styles.label}>Ribba admin e-mail</label>
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="onderates86@gmail.com" required style={styles.input} />
            <label style={styles.label}>Wachtwoord</label>
            <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
              required style={styles.input} />
            {loginError && <p style={styles.errorText}>{loginError}</p>}
            <button type="submit" style={styles.btnPrimary}>Inloggen</button>
          </form>
        )}

        {phase === 'form' && (
          <form onSubmit={handleMigrate} style={styles.form}>
            <div style={styles.sectionTitle}>Doelrijschool (Ribba)</div>
            <label style={styles.label}>Rijschool</label>
            <select value={selectedSchool} onChange={(e) => setSelectedSchool(e.target.value)} required style={styles.input}>
              <option value="">— Kies rijschool —</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <div style={{ ...styles.sectionTitle, marginTop: 24 }}>Wat migreren?</div>
            <div style={styles.radioGroup}>
              <label style={styles.radioLabel}>
                <input type="radio" checked={mode === 'both'} onChange={() => setMode('both')} /> Lessen + tegoed
              </label>
              <label style={styles.radioLabel}>
                <input type="radio" checked={mode === 'lessons'} onChange={() => setMode('lessons')} /> Alleen lessen
              </label>
              <label style={styles.radioLabel}>
                <input type="radio" checked={mode === 'credit'} onChange={() => setMode('credit')} /> Alleen tegoed
              </label>
            </div>

            {(mode === 'lessons' || mode === 'both') && (
              <>
                <div style={{ ...styles.sectionTitle, marginTop: 24 }}>Periode lessen</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Maanden terug</label>
                    <input type="number" min={1} max={48} value={monthsBack}
                      onChange={(e) => setMonthsBack(parseInt(e.target.value, 10) || 18)}
                      style={styles.input} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Maanden vooruit</label>
                    <input type="number" min={1} max={24} value={monthsForward}
                      onChange={(e) => setMonthsForward(parseInt(e.target.value, 10) || 6)}
                      style={styles.input} />
                  </div>
                </div>
                <p style={styles.hint}>
                  Default: 18 mnd terug + 6 mnd vooruit dekt vrijwel alle actieve leerlingen.
                </p>
              </>
            )}

            <div style={{ ...styles.sectionTitle, marginTop: 24 }}>Plango inloggegevens</div>
            <label style={styles.label}>Plango slug</label>
            <div style={styles.inputGroup}>
              <span style={styles.inputPrefix}>https://</span>
              <input type="text" value={plangoSlug} onChange={(e) => setPlangoSlug(e.target.value)}
                placeholder="rijschool-naam" required
                style={{ ...styles.input, borderRadius: '0 8px 8px 0', borderLeft: 'none', flex: 1 }} />
              <span style={styles.inputSuffix}>.plangoapp.nl</span>
            </div>

            <label style={styles.label}>Gebruikersnaam</label>
            <input type="text" value={plangoEmail} onChange={(e) => setPlangoEmail(e.target.value)}
              required autoComplete="off" style={styles.input} />

            <label style={styles.label}>Wachtwoord</label>
            <input type="password" value={plangoPassword} onChange={(e) => setPlangoPassword(e.target.value)}
              required style={styles.input} />

            {selectedSchool && plangoSlug && (
              <div style={styles.previewBox}>
                <p style={styles.previewText}>
                  {mode === 'both' && 'Lessen én tegoed'}
                  {mode === 'lessons' && 'Alleen lessen'}
                  {mode === 'credit' && 'Alleen tegoed'}
                  {' '}van <strong>{plangoSlug}.plangoapp.nl</strong> worden gemigreerd naar{' '}
                  <strong>{selectedSchoolName}</strong>.
                </p>
                <p style={styles.previewWarning}>
                  ⚠️ Examens worden NIET geïmporteerd (gaan via CBR-koppeling). Lessen via leerlingnaam-match.
                  Privé-blokken vanaf vandaag → instructor agenda.
                </p>
              </div>
            )}

            <button type="submit" style={styles.btnPrimary}>Migratie starten →</button>
          </form>
        )}

        {(phase === 'migrating' || (phase === 'done' && logs.length > 0) || phase === 'error') && (
          <div style={styles.logsContainer}>
            <div style={styles.logsHeader}>
              {phase === 'migrating' && <div style={styles.spinner} />}
              <span style={styles.logsTitle}>
                {phase === 'migrating' ? 'Bezig...' : phase === 'done' ? 'Voltooid' : 'Fout'}
              </span>
            </div>
            <div style={styles.logsList}>
              {logs.map((log, i) => (
                <div key={i} style={{
                  ...styles.logLine,
                  color: log.startsWith('✗') ? '#ef4444' : log.startsWith('✓') ? '#10b981' : '#e2e8f0',
                }}>{log}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {phase === 'done' && result && (
          <div style={styles.resultContainer}>
            <div style={styles.resultGrid}>
              <div style={styles.statBox}>
                <div style={{ ...styles.statNumber, color: '#10b981' }}>{result.lessons_imported}</div>
                <div style={styles.statLabel}>Lessen</div>
              </div>
              <div style={styles.statBox}>
                <div style={{ ...styles.statNumber, color: '#0ea5e9' }}>{result.busy_slots_imported}</div>
                <div style={styles.statLabel}>Privé-blokken</div>
              </div>
              <div style={styles.statBox}>
                <div style={{ ...styles.statNumber, color: '#10b981' }}>{result.credit_updated}</div>
                <div style={styles.statLabel}>Tegoed</div>
              </div>
              <div style={styles.statBox}>
                <div style={{ ...styles.statNumber, color: '#94a3b8' }}>{result.students_matched}</div>
                <div style={styles.statLabel}>Gematcht</div>
              </div>
            </div>

            {result.students_unmatched.length > 0 && (
              <div style={styles.warningBox}>
                <strong>⚠️ Niet gematchte leerlingen ({result.students_unmatched.length}):</strong>
                <div style={{ marginTop: 8, fontSize: 12, color: '#fbbf24' }}>
                  {result.students_unmatched.join(', ')}
                </div>
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8, marginBottom: 0 }}>
                  Deze leerlingen bestaan in Plango maar niet in Ribba. Importeer ze eerst via
                  de leerlingen-migratie.
                </p>
              </div>
            )}

            <div style={styles.btnRow}>
              <button onClick={resetForm} style={styles.btnSecondary}>Nieuwe migratie</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div style={styles.errorBox}>
            <p style={styles.errorText}>{errorMsg}</p>
            <button onClick={resetForm} style={styles.btnSecondary}>Opnieuw proberen</button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px' },
  card: { background: '#1e293b', borderRadius: 20, padding: 36, width: '100%', maxWidth: 560, boxShadow: '0 4px 32px rgba(0,0,0,0.4)' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 },
  badge: { background: '#7c3aed', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.05em' },
  title: { fontSize: 22, fontWeight: 800, color: '#f1f5f9', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#94a3b8', marginBottom: 28, lineHeight: 1.5 },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginTop: 8 },
  input: { background: '#0f172a', border: '1.5px solid #334155', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#f1f5f9', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  inputGroup: { display: 'flex', alignItems: 'center', border: '1.5px solid #334155', borderRadius: 8, overflow: 'hidden' },
  inputPrefix: { background: '#0f172a', color: '#64748b', padding: '10px 10px', fontSize: 13, borderRight: '1px solid #334155', whiteSpace: 'nowrap' as const },
  inputSuffix: { background: '#0f172a', color: '#64748b', padding: '10px 10px', fontSize: 13, borderLeft: '1px solid #334155', whiteSpace: 'nowrap' as const },
  hint: { fontSize: 12, color: '#475569', marginTop: 2 },
  radioGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#e2e8f0', cursor: 'pointer' },
  previewBox: { background: '#0f172a', border: '1px solid #1e40af', borderRadius: 10, padding: 14, marginTop: 16 },
  previewText: { fontSize: 13, color: '#93c5fd', lineHeight: 1.6, margin: 0 },
  previewWarning: { fontSize: 12, color: '#fbbf24', marginTop: 8, marginBottom: 0 },
  warningBox: { background: '#1e1b04', border: '1px solid #92400e', borderRadius: 10, padding: 14, marginTop: 16 },
  btnPrimary: { marginTop: 20, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 20px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  btnSecondary: { background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnRow: { display: 'flex', gap: 10, marginTop: 20 },
  logsContainer: { background: '#0f172a', borderRadius: 12, padding: 16, marginTop: 16 },
  logsHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  logsTitle: { fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  spinner: { width: 14, height: 14, border: '2px solid #334155', borderTop: '2px solid #0d9488', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  logsList: { maxHeight: 280, overflowY: 'auto' as const, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 },
  logLine: { padding: '1px 0' },
  resultContainer: { marginTop: 20 },
  resultGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 },
  statBox: { background: '#0f172a', borderRadius: 10, padding: '14px 10px', textAlign: 'center' as const },
  statNumber: { fontSize: 28, fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 4 },
  errorBox: { background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 10, padding: 16, marginTop: 16 },
  errorText: { color: '#fca5a5', fontSize: 13, marginBottom: 12 },
};
