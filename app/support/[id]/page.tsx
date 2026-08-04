'use client';

// Schooldetail — waar is deze rijschool blijven steken, en wat ging er mis?
//
// Het scholenoverzicht laat zien dát iemand stilstaat. Dit scherm beantwoordt
// de vervolgvraag. De onboardingstappen komen als lijst uit de database, dus
// een stap toevoegen is een migratie en geen wijziging hier.
//
// Niveau 0: bedrijfsgegevens van de rijschool wel, namen van instructeurs en
// leerlingen niet. Zie de niveaugrens in migratie 20260803160000.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useSupportToken } from '../client';

interface Stap {
  sleutel: string;
  label: string;
  wanneer: string | null;
  /** Los van `wanneer`: een stap kan gedaan zijn zonder betrouwbaar tijdstip. */
  gereed: boolean;
  blokkerend: boolean;
}

interface Instructeur {
  rol: string | null;
  status: string | null;
  toegevoegd: string | null;
  account_bevestigd: string | null;
  laatste_activiteit: string | null;
}

interface Detail {
  school: {
    id: string; naam: string; is_internal: boolean; status: string | null;
    aangemaakt: string; email: string | null; telefoon: string | null;
    adres: string | null; postcode: string | null; plaats: string | null;
    land: string | null; rechtsvorm: string | null; kvk: string | null;
    btw: string | null; iban_ingevuld: boolean; website: string | null;
    logo: boolean; registratie_slug: string | null; registratie_open: boolean;
    welkomstmail: string | null; plango_import: string | null;
    wizard: string | null; wizard_afgesloten: string | null;
  };
  instructeurs: Instructeur[];
  juridisch: { document: string; versie: string; wanneer: string }[];
  abonnement: { status: string; plan: string | null; gestart: string; loopt_tot: string | null } | null;
  cbr: {
    koppeling: string | null; connectie_status: string | null; laatste_fout: string | null;
    gewijzigd: string | null; laatste: string | null; laatste_geslaagd: string | null;
    runs_7d: number; mislukt_7d: number;
  } | null;
  aantallen: Record<string, number>;
  onboarding: Stap[];
}

interface Gebeurtenis {
  wanneer: string | null;
  bron: string;
  soort: string;
  ok: boolean;
  detail: string | null;
}

function moment(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('nl-NL', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function datum(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SchoolDetailPagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { token, status } = useSupportToken();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [events, setEvents] = useState<Gebeurtenis[]>([]);
  const [fout, setFout] = useState('');

  useEffect(() => {
    if (!token) return;
    let afgebroken = false;
    (async () => {
      const res = await fetch(`/api/support/schools/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (afgebroken) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFout(body.error ?? 'Ophalen mislukt.');
        return;
      }
      const body = await res.json();
      setDetail(body.detail);
      setEvents(body.events ?? []);
    })();
    return () => { afgebroken = true; };
  }, [token, id]);

  if (status === 'geen-toegang') {
    return (
      <div style={s.pagina}>
        <p style={s.stil}>Je sessie is verlopen of mist de tweede factor.</p>
        <Link href="/support" style={s.terug}>Opnieuw inloggen</Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div style={s.pagina}>
        <Link href="/support" style={s.terug}>← Alle rijscholen</Link>
        <p style={s.stil}>{fout || 'Laden…'}</p>
      </div>
    );
  }

  const { school, onboarding } = detail;
  // De eerste stap die nog niet is gezet: daar is het gesprek over.
  const gestopt = onboarding.find((stap) => !stap.gereed);

  return (
    <div style={s.pagina}>
      <Link href="/support" style={s.terug}>← Alle rijscholen</Link>

      <div style={s.kop}>
        <h1 style={s.h1}>{school.naam}</h1>
        {school.is_internal && <span style={s.intern}>intern</span>}
        <span style={s.stil}>
          {school.plaats ?? '—'} · ingeschreven {datum(school.aangemaakt)}
        </span>
      </div>

      {gestopt && (
        <div style={s.signaal}>
          Eerstvolgende openstaande stap: <strong>{gestopt.label}</strong>
          {gestopt.blokkerend && ' — dit blokkeert het gebruik van de app'}
        </div>
      )}

      <div style={s.grid}>
        <section style={s.kaart}>
          <h2 style={s.h2}>Onboarding</h2>
          <ol style={s.stappen}>
            {onboarding.map((stap) => (
              <li key={stap.sleutel} style={s.stap}>
                <span style={stap.gereed ? s.bolOk : (stap.blokkerend ? s.bolBlok : s.bolLeeg)} />
                <span style={stap.gereed ? s.stapLabel : s.stapLabelOpen}>{stap.label}</span>
                <span style={s.stapDatum}>
                  {stap.wanneer ? moment(stap.wanneer) : (stap.gereed ? 'gedaan' : '—')}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section style={s.kaart}>
          <h2 style={s.h2}>Rijschool</h2>
          <dl style={s.lijst}>
            <Rij label="E-mail" waarde={school.email} />
            <Rij label="Telefoon" waarde={school.telefoon} />
            <Rij label="Adres" waarde={[school.adres, school.postcode, school.plaats].filter(Boolean).join(', ') || null} />
            <Rij label="Rechtsvorm" waarde={school.rechtsvorm} />
            <Rij label="KVK" waarde={school.kvk} />
            <Rij label="Btw" waarde={school.btw} />
            <Rij label="IBAN ingevuld" waarde={school.iban_ingevuld ? 'ja' : 'nee'} />
            <Rij label="Logo" waarde={school.logo ? 'ja' : 'nee'} />
            <Rij label="Website" waarde={school.website} />
            <Rij label="Aanmeldlink" waarde={school.registratie_slug} />
            <Rij label="Aanmelden open" waarde={school.registratie_open ? 'ja' : 'nee'} />
            <Rij label="Welkomstmail" waarde={school.welkomstmail ? moment(school.welkomstmail) : 'niet verstuurd'} />
            <Rij label="Plango-import" waarde={school.plango_import ? moment(school.plango_import) : 'nee'} />
            <Rij label="Setupwizard" waarde={
              school.wizard === 'completed' ? `afgerond · ${moment(school.wizard_afgesloten)}`
              : school.wizard === 'skipped' ? `overgeslagen · ${moment(school.wizard_afgesloten)}`
              : 'nog niet doorlopen'} />
            <Rij label="Abonnement" waarde={detail.abonnement
              ? `${detail.abonnement.status}${detail.abonnement.plan ? ` · ${detail.abonnement.plan}` : ''}`
              : 'geen'} />
          </dl>
        </section>

        <section style={s.kaart}>
          <h2 style={s.h2}>Instructeurs</h2>
          <p style={s.voetnoot}>
            Namen en e-mailadressen horen bij niveau 1 en staan hier bewust niet.
          </p>
          <table style={s.tabel}>
            <thead>
              <tr><th style={s.th}>Rol</th><th style={s.th}>Status</th>
                <th style={s.th}>Bevestigd</th><th style={s.th}>Laatst actief</th></tr>
            </thead>
            <tbody>
              {detail.instructeurs.map((i, n) => (
                <tr key={n}>
                  <td style={s.td}>{i.rol ?? '—'}</td>
                  <td style={s.td}>{i.status ?? '—'}</td>
                  <td style={s.td}>{i.account_bevestigd ? 'ja' : 'nee'}</td>
                  <td style={s.td}>{moment(i.laatste_activiteit)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ ...s.h2, marginTop: 24 }}>Juridisch</h2>
          <dl style={s.lijst}>
            {detail.juridisch.map((j) => (
              <Rij key={j.document} label={j.document} waarde={`${j.versie} · ${datum(j.wanneer)}`} />
            ))}
            {detail.juridisch.length === 0 && <Rij label="—" waarde="niets geaccepteerd" />}
          </dl>

          {detail.cbr && (
            <>
              <h2 style={{ ...s.h2, marginTop: 24 }}>CBR-synchronisatie</h2>
              {detail.cbr.koppeling === 'uit' && (
                <div style={s.signaalRood}>
                  Koppeling staat <strong>uit</strong> sinds {moment(detail.cbr.gewijzigd)}.
                  {detail.cbr.laatste_fout && <> Laatste fout: {detail.cbr.laatste_fout}</>}
                  {' '}De rijschool moet hem zelf weer aanzetten via Koppelingen.
                </div>
              )}
              <dl style={s.lijst}>
                <Rij label="Koppeling" waarde={detail.cbr.koppeling} />
                <Rij label="Laatste poging" waarde={moment(detail.cbr.laatste)} />
                <Rij label="Laatst geslaagd" waarde={moment(detail.cbr.laatste_geslaagd)} />
                <Rij label="Afgelopen 7 dagen"
                  waarde={`${detail.cbr.mislukt_7d} van ${detail.cbr.runs_7d} mislukt`} />
              </dl>
            </>
          )}
        </section>
      </div>

      <section style={{ ...s.kaart, marginTop: 20 }}>
        <h2 style={s.h2}>Gebeurtenissen</h2>
        <p style={s.voetnoot}>
          Facturatie, webhooks, CBR en SnelStart. Van de CBR-synchronisatie
          alleen de momenten waarop hij omsloeg — die draait elk uur.
        </p>
        <div style={s.tabelWrap}>
          <table style={s.tabel}>
            <thead>
              <tr><th style={s.th}>Wanneer</th><th style={s.th}>Bron</th>
                <th style={s.th}>Soort</th><th style={s.th}>Details</th></tr>
            </thead>
            <tbody>
              {events.map((e, n) => (
                <tr key={n} style={e.ok ? undefined : s.rijFout}>
                  <td style={s.td}>{moment(e.wanneer)}</td>
                  <td style={s.td}>{e.bron}</td>
                  <td style={s.td}>
                    {!e.ok && <span style={s.foutBadge}>fout</span>}
                    {e.soort}
                  </td>
                  <td style={s.tdDetail}>{e.detail ?? '—'}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td style={s.td} colSpan={4}>Geen gebeurtenissen vastgelegd.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Rij({ label, waarde }: { label: string; waarde: string | null }) {
  return (
    <>
      <dt style={s.dt}>{label}</dt>
      <dd style={s.dd}>{waarde ?? '—'}</dd>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  pagina: { minHeight: '100vh', background: '#F8FAFC', padding: 24 },
  terug: { fontSize: 13, color: '#2563EB', textDecoration: 'none' },
  kop: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', margin: '12px 0 16px' },
  h1: { fontSize: 24, fontWeight: 700, color: '#0F172A', margin: 0 },
  h2: { fontSize: 14, fontWeight: 700, color: '#0F172A', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: 0.4 },
  stil: { fontSize: 13, color: '#64748B' },
  voetnoot: { fontSize: 12, color: '#94A3B8', margin: '-6px 0 12px' },
  signaal: {
    background: '#FEF3C7', color: '#92400E', padding: '10px 14px',
    borderRadius: 10, fontSize: 14, marginBottom: 20,
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20,
  },
  kaart: {
    background: '#fff', borderRadius: 14, padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  stappen: { listStyle: 'none', padding: 0, margin: 0 },
  stap: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' },
  bolOk: { width: 9, height: 9, borderRadius: 999, background: '#16A34A', flexShrink: 0 },
  bolLeeg: { width: 9, height: 9, borderRadius: 999, background: '#CBD5E1', flexShrink: 0 },
  bolBlok: { width: 9, height: 9, borderRadius: 999, background: '#D97706', flexShrink: 0 },
  stapLabel: { fontSize: 14, color: '#0F172A', flex: 1 },
  stapLabelOpen: { fontSize: 14, color: '#94A3B8', flex: 1 },
  stapDatum: { fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' },
  lijst: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0, fontSize: 13 },
  dt: { color: '#64748B' },
  dd: { color: '#0F172A', margin: 0, wordBreak: 'break-word' },
  tabelWrap: { overflowX: 'auto' },
  tabel: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#64748B',
    textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
  },
  td: { padding: '8px 10px', borderBottom: '1px solid #F1F5F9', color: '#0F172A', whiteSpace: 'nowrap' },
  tdDetail: { padding: '8px 10px', borderBottom: '1px solid #F1F5F9', color: '#475569' },
  rijFout: { background: '#FEF2F2' },
  signaalRood: {
    background: '#FEF2F2', color: '#991B1B', padding: '10px 12px',
    borderRadius: 10, fontSize: 13, marginBottom: 12,
  },
  foutBadge: {
    background: '#FEE2E2', color: '#991B1B', padding: '1px 7px', borderRadius: 999,
    fontSize: 11, fontWeight: 600, marginRight: 8,
  },
  intern: {
    background: '#EEF2FF', color: '#3730A3', padding: '2px 9px',
    borderRadius: 999, fontSize: 11, fontWeight: 600,
  },
};
