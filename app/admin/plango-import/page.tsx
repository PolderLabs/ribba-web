'use client';

import { useState, useRef, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../../components/RibbaLogo';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type School = { id: string; name: string; registration_slug: string };

type StudentStatus = { name: string; status: 'imported' | 'skipped' | 'failed'; reason?: string };
type MigrationResult = {
  students_imported: number;
  students_skipped: number;
  students_failed: number;
  total_found: number;
  errors: string[];
  students: StudentStatus[];
};

type Phase = 'login' | 'form' | 'migrating' | 'done' | 'error';

export default function PlangoImportPage() {
  const [phase, setPhase] = useState<Phase>('login');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  // Stored after login, sent with every API call for server-side verification
  const [adminCreds, setAdminCreds] = useState<{ email: string; password: string } | null>(null);

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [plangoSlug, setPlangoSlug] = useState('');
  const [plangoEmail, setPlangoEmail] = useState('');
  const [plangoPassword, setPlangoPassword] = useState('');

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
    // Quick check client-side before hitting the server
    if (adminEmail !== 'onderates86@gmail.com') {
      setLoginError('Geen toegang tot dit admin panel');
      return;
    }
    // Verify credentials by trying to load schools — the API route will check them
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });
    if (error) {
      setLoginError('Ongeldige inloggegevens');
      return;
    }
    // Store credentials for use in API calls (server verifies them)
    setAdminCreds({ email: adminEmail, password: adminPassword });
    // Load schools
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

    setPhase('migrating');
    setLogs(['Verbinding maken met Plango...']);
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/plango-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: plangoSlug.trim(),
          email: plangoEmail.trim(),
          password: plangoPassword,
          drivingschool_id: selectedSchool,
          admin_email: adminCreds?.email,
          admin_password: adminCreds?.password,
        }),
      });

      const data = await res.json();

      // Show logs as they come in (all at once from non-streaming response)
      if (data.logs) setLogs(data.logs);

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
    setPhase('form');
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
        {/* Header */}
        <div style={styles.header}>
          <RibbaLogo height={32} />
          <div style={styles.badge}>Admin</div>
        </div>

        <h1 style={styles.title}>Plango → Ribba Migratie</h1>
        <p style={styles.subtitle}>
          Importeer leerlingen van een Plango rijschool naar Ribba.
        </p>

        {/* ── Step 1: Admin login ── */}
        {phase === 'login' && (
          <form onSubmit={handleAdminLogin} style={styles.form}>
            <label style={styles.label}>Ribba admin e-mail</label>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="onderates86@gmail.com"
              required
              style={styles.input}
            />
            <label style={styles.label}>Wachtwoord</label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
              style={styles.input}
            />
            {loginError && <p style={styles.errorText}>{loginError}</p>}
            <button type="submit" style={styles.btnPrimary}>Inloggen</button>
          </form>
        )}

        {/* ── Step 2: Migration form ── */}
        {phase === 'form' && (
          <form onSubmit={handleMigrate} style={styles.form}>
            <div style={styles.sectionTitle}>Doelrijschool (Ribba)</div>
            <label style={styles.label}>Rijschool</label>
            <select
              value={selectedSchool}
              onChange={(e) => setSelectedSchool(e.target.value)}
              required
              style={styles.input}
            >
              <option value="">— Kies rijschool —</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <div style={{ ...styles.sectionTitle, marginTop: 24 }}>Plango inloggegevens</div>
            <label style={styles.label}>Plango slug</label>
            <div style={styles.inputGroup}>
              <span style={styles.inputPrefix}>https://</span>
              <input
                type="text"
                value={plangoSlug}
                onChange={(e) => setPlangoSlug(e.target.value)}
                placeholder="rijschool-naam"
                required
                style={{ ...styles.input, borderRadius: '0 8px 8px 0', borderLeft: 'none', flex: 1 }}
              />
              <span style={styles.inputSuffix}>.plangoapp.nl</span>
            </div>
            <p style={styles.hint}>
              Vind de slug in de URL: <strong>{plangoSlug || 'rijschool-naam'}.plangoapp.nl</strong>
            </p>

            <label style={styles.label}>Gebruikersnaam (Plango account)</label>
            <input
              type="text"
              value={plangoEmail}
              onChange={(e) => setPlangoEmail(e.target.value)}
              placeholder="gebruikersnaam"
              required
              autoComplete="off"
              style={styles.input}
            />

            <label style={styles.label}>Wachtwoord (Plango account)</label>
            <input
              type="password"
              value={plangoPassword}
              onChange={(e) => setPlangoPassword(e.target.value)}
              required
              style={styles.input}
            />

            {selectedSchool && plangoSlug && (
              <div style={styles.previewBox}>
                <p style={styles.previewText}>
                  Leerlingen van <strong>{plangoSlug}.plangoapp.nl</strong> worden geïmporteerd naar{' '}
                  <strong>{selectedSchoolName}</strong> met status <em>Wachtlijst</em>.
                </p>
                <p style={styles.previewWarning}>
                  ⚠️ Bestaande actieve leerlingen (met app-account) worden overgeslagen.
                </p>
              </div>
            )}

            <button type="submit" style={styles.btnPrimary}>
              Migratie starten →
            </button>
          </form>
        )}

        {/* ── Step 3: Migrating ── */}
        {(phase === 'migrating' || (phase === 'done' && logs.length > 0) || phase === 'error') && (
          <div style={styles.logsContainer}>
            <div style={styles.logsHeader}>
              {phase === 'migrating' && <div style={styles.spinner} />}
              <span style={styles.logsTitle}>
                {phase === 'migrating' ? 'Bezig...' : phase === 'done' ? 'Voltooid' : 'Fout opgetreden'}
              </span>
            </div>
            <div style={styles.logsList}>
              {logs.map((log, i) => (
                <div key={i} style={{
                  ...styles.logLine,
                  color: log.startsWith('✗') ? '#ef4444' : log.startsWith('✓') ? '#10b981' : '#e2e8f0',
                }}>
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* ── Step 4: Result ── */}
        {phase === 'done' && result && (
          <div style={styles.resultContainer}>
            <div style={styles.resultGrid}>
              <div style={styles.statBox}>
                <div style={{ ...styles.statNumber, color: '#10b981' }}>{result.students_imported}</div>
                <div style={styles.statLabel}>Geïmporteerd</div>
              </div>
              <div style={styles.statBox}>
                <div style={{ ...styles.statNumber, color: '#f59e0b' }}>{result.students_skipped}</div>
                <div style={styles.statLabel}>Overgeslagen</div>
              </div>
              <div style={styles.statBox}>
                <div style={{ ...styles.statNumber, color: '#ef4444' }}>{result.students_failed}</div>
                <div style={styles.statLabel}>Mislukt</div>
              </div>
              <div style={styles.statBox}>
                <div style={{ ...styles.statNumber, color: '#94a3b8' }}>{result.total_found}</div>
                <div style={styles.statLabel}>Totaal gevonden</div>
              </div>
            </div>

            {/* Student list */}
            {result.students.length > 0 && (
              <div style={styles.studentList}>
                {result.students.map((s, i) => (
                  <div key={i} style={styles.studentRow}>
                    <span style={{
                      ...styles.statusDot,
                      background: s.status === 'imported' ? '#10b981' : s.status === 'skipped' ? '#f59e0b' : '#ef4444',
                    }} />
                    <span style={styles.studentName}>{s.name}</span>
                    {s.reason && <span style={styles.studentReason}>{s.reason}</span>}
                  </div>
                ))}
              </div>
            )}

            <div style={styles.btnRow}>
              <button onClick={resetForm} style={styles.btnSecondary}>
                Nieuwe migratie
              </button>
            </div>
          </div>
        )}

        {/* ── Error state ── */}
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

// ── Styles ────────────────────────────────────────────────────────────────────

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
    background: '#1e293b',
    borderRadius: 20,
    padding: 36,
    width: '100%',
    maxWidth: 560,
    boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  badge: {
    background: '#7c3aed',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 20,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  title: {
    fontSize: 22,
    fontWeight: 800,
    color: '#f1f5f9',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 28,
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#cbd5e1',
    marginTop: 8,
  },
  input: {
    background: '#0f172a',
    border: '1.5px solid #334155',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    color: '#f1f5f9',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  inputGroup: {
    display: 'flex',
    alignItems: 'center',
    border: '1.5px solid #334155',
    borderRadius: 8,
    overflow: 'hidden',
  },
  inputPrefix: {
    background: '#0f172a',
    color: '#64748b',
    padding: '10px 10px',
    fontSize: 13,
    borderRight: '1px solid #334155',
    whiteSpace: 'nowrap' as const,
  },
  inputSuffix: {
    background: '#0f172a',
    color: '#64748b',
    padding: '10px 10px',
    fontSize: 13,
    borderLeft: '1px solid #334155',
    whiteSpace: 'nowrap' as const,
  },
  hint: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  previewBox: {
    background: '#0f172a',
    border: '1px solid #1e40af',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
  },
  previewText: {
    fontSize: 13,
    color: '#93c5fd',
    lineHeight: 1.6,
    margin: 0,
  },
  previewWarning: {
    fontSize: 12,
    color: '#fbbf24',
    marginTop: 8,
    marginBottom: 0,
  },
  btnPrimary: {
    marginTop: 20,
    background: '#0d9488',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '13px 20px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  btnSecondary: {
    background: '#334155',
    color: '#e2e8f0',
    border: 'none',
    borderRadius: 10,
    padding: '11px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnRow: {
    display: 'flex',
    gap: 10,
    marginTop: 20,
  },
  logsContainer: {
    background: '#0f172a',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  logsHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  logsTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid #334155',
    borderTop: '2px solid #0d9488',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  logsList: {
    maxHeight: 280,
    overflowY: 'auto' as const,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 1.7,
  },
  logLine: {
    padding: '1px 0',
  },
  resultContainer: {
    marginTop: 20,
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 10,
    marginBottom: 20,
  },
  statBox: {
    background: '#0f172a',
    borderRadius: 10,
    padding: '14px 10px',
    textAlign: 'center' as const,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  studentList: {
    background: '#0f172a',
    borderRadius: 10,
    padding: 12,
    maxHeight: 260,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  studentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  studentName: {
    fontSize: 13,
    color: '#e2e8f0',
    fontWeight: 500,
  },
  studentReason: {
    fontSize: 11,
    color: '#64748b',
    marginLeft: 4,
  },
  errorBox: {
    background: '#450a0a',
    border: '1px solid #7f1d1d',
    borderRadius: 10,
    padding: 16,
    marginTop: 16,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    marginBottom: 12,
  },
};
