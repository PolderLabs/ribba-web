'use client';

// Supportportaal — inloggen (met verplichte tweefactor) en het scholenoverzicht.
//
// Dit portaal geeft toegang tot gegevens van álle rijscholen. Eén wachtwoord
// is daarvoor te weinig, dus tweefactor is geen instelling maar een
// voorwaarde: zonder geverifieerde tweede factor kom je hier niet voorbij het
// inlogscherm, en weigert de API het ook (die controleert de aal2-claim zelf).
//
// De pagina praat nooit rechtstreeks met de database. Alles loopt via
// /api/support/*, want alleen daar wordt gelogd.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import RibbaLogo from '../components/RibbaLogo';
import { getSupabase } from './client';
import { kiesFactorpad, type Factoroptie } from '@/lib/support-factorkeuze';

type Fase = 'laden' | 'login' | 'geen-toegang' | 'tweefactor-instellen' | 'tweefactor-kiezen' | 'tweefactor-invoeren' | 'portaal';

interface School {
  school_id: string;
  school_name: string;
  city: string | null;
  status: string | null;
  is_internal: boolean;
  created_at: string;
  registration_enabled: boolean;
  welcome_email_sent_at: string | null;
  instructeurs: number;
  leerlingen: number;
  lestypes: number;
  beschikbaarheid: number;
  pakketten: number;
  voertuigen: number;
  lessen: number;
  facturen: number;
  abonnement_status: string | null;
  cbr_koppeling: string | null;
  laatste_activiteit: string | null;
  onboarding_gereed: boolean;
}

function datum(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function dagenGeleden(iso: string | null): string {
  if (!iso) return 'nooit';
  const dagen = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dagen <= 0) return 'vandaag';
  if (dagen === 1) return 'gisteren';
  return `${dagen} dagen geleden`;
}

export default function SupportPage() {
  const [fase, setFase] = useState<Fase>('laden');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [code, setCode] = useState('');

  const [qr, setQr] = useState('');
  const [geheim, setGeheim] = useState('');
  const [factorId, setFactorId] = useState('');
  const [factorOpties, setFactorOpties] = useState<Factoroptie[]>([]);

  const [scholen, setScholen] = useState<School[]>([]);
  const [toonIntern, setToonIntern] = useState(false);

  // Mag dit account aan de support-tweefactor beginnen? Uitsluitend de server
  // beantwoordt dat; hier wordt niets over rollen geraden. Alles behalve een
  // expliciete `true` telt als nee — een netwerkfout of een kapotte lookup mag
  // niemand naar de QR-code leiden.
  const isSupportmedewerker = useCallback(async (accessToken: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/support/eligibility', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return false;
      const body = await res.json();
      return body?.eligible === true;
    } catch {
      return false;
    }
  }, []);

  // Waar staat de gebruiker: uitgelogd, geen supportmedewerker, tweede factor
  // nog niet ingesteld, tweede factor nog niet gebruikt, of binnen? Bewust
  // zonder setState, zodat zowel het opstarten als een handeling hem kan
  // gebruiken.
  const bepaalFase = useCallback(async (): Promise<{ fase: Fase; factorId?: string; opties?: Factoroptie[] }> => {
    const { data: { session } } = await getSupabase().auth.getSession();
    if (!session) return { fase: 'login' };

    const { data: aal } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2') return { fase: 'portaal' };

    // Vóór álles wat met factoren te maken heeft. Een gewone leerling of
    // instructeur die hier belandt, kreeg eerder eerst een QR-code en pas
    // daarna te horen dat hij geen support is — met een achtergelaten factor
    // die zijn eigen wachtwoordreset raakt. Zie app/api/support/eligibility.
    if (!(await isSupportmedewerker(session.access_token))) {
      return { fase: 'geen-toegang' };
    }

    // Welke factor? Die vraag staat in lib/support-factorkeuze.ts, zodat hij
    // toetsbaar is zonder browser. Bij twee factoren kiest de gebruiker zelf —
    // anders zou een reservefactor onbereikbaar zijn en dus waardeloos.
    const { data: factors } = await getSupabase().auth.mfa.listFactors();
    const pad = kiesFactorpad(factors?.all);
    if (pad.soort === 'instellen') return { fase: 'tweefactor-instellen' };
    if (pad.soort === 'invoeren') return { fase: 'tweefactor-invoeren', factorId: pad.factorId };
    return { fase: 'tweefactor-kiezen', opties: pad.opties };
  }, [isSupportmedewerker]);

  // Vraagt Supabase om een nieuwe TOTP-factor en toont de QR-code.
  const startInstellen = useCallback(async () => {
    // Ruim halverwege afgebroken pogingen op, anders stapelen die zich op.
    const { data: bestaand } = await getSupabase().auth.mfa.listFactors();
    for (const f of bestaand?.all ?? []) {
      if (f.status === 'unverified') await getSupabase().auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await getSupabase().auth.mfa.enroll({ factorType: 'totp' });
    if (error || !data) { setFout('Instellen van tweefactor mislukt.'); return; }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setGeheim(data.totp.secret);
  }, []);

  const naarFase = useCallback(async (uitkomst: { fase: Fase; factorId?: string; opties?: Factoroptie[] }) => {
    // Bij een keuzescherm bewust de vorige factor wissen. Anders zou een
    // herlading de eerder gekozen factor laten staan en zou een verkeerde
    // uitdaging kunnen vertrekken zonder dat de gebruiker dat ziet.
    setFactorId(uitkomst.factorId ?? '');
    setFactorOpties(uitkomst.opties ?? []);
    setFase(uitkomst.fase);
    if (uitkomst.fase === 'tweefactor-instellen') await startInstellen();
  }, [startInstellen]);

  useEffect(() => {
    let afgebroken = false;
    (async () => {
      const uitkomst = await bepaalFase();
      if (!afgebroken) await naarFase(uitkomst);
    })();
    return () => { afgebroken = true; };
  }, [bepaalFase, naarFase]);

  const inloggen = async (e: React.FormEvent) => {
    e.preventDefault();
    setFout(''); setBezig(true);
    const { error } = await getSupabase().auth.signInWithPassword({ email, password: wachtwoord });
    if (error) { setBezig(false); setFout('Inloggen mislukt.'); return; }
    setWachtwoord('');
    await naarFase(await bepaalFase());
    setBezig(false);
  };

  const codeControleren = async (e: React.FormEvent) => {
    e.preventDefault();
    setFout(''); setBezig(true);
    const { data: challenge, error: challengeError } =
      await getSupabase().auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setBezig(false); setFout('Kon geen verificatie starten.'); return;
    }
    const { error } = await getSupabase().auth.mfa.verify({
      factorId, challengeId: challenge.id, code: code.trim(),
    });
    setBezig(false);
    if (error) { setFout('Code klopt niet. Probeer de volgende.'); return; }
    setCode(''); setQr(''); setGeheim('');
    await naarFase(await bepaalFase());
  };

  const uitloggen = async () => {
    await getSupabase().auth.signOut();
    setScholen([]);
    setFase('login');
  };

  // Scholen ophalen zodra we binnen zijn.
  useEffect(() => {
    if (fase !== 'portaal') return;
    let afgebroken = false;
    (async () => {
      setFout('');
      const { data: { session } } = await getSupabase().auth.getSession();
      if (!session) { setFase('login'); return; }
      const res = await fetch(`/api/support/schools${toonIntern ? '?intern=1' : ''}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (afgebroken) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFout(body.error ?? 'Ophalen mislukt.');
        return;
      }
      const body = await res.json();
      setScholen(body.schools ?? []);
    })();
    return () => { afgebroken = true; };
  }, [fase, toonIntern]);

  if (fase === 'laden') {
    return <div style={s.container}><p style={s.stil}>Even geduld…</p></div>;
  }

  if (fase === 'login') {
    return (
      <div style={s.container}>
        <div style={s.kaart}>
          <RibbaLogo height={32} />
          <h1 style={s.h1}>Support</h1>
          <p style={s.stil}>Alleen voor medewerkers van Ribba.</p>
          <form onSubmit={inloggen}>
            <input style={s.input} type="email" placeholder="E-mailadres" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            <input style={s.input} type="password" placeholder="Wachtwoord" value={wachtwoord}
              onChange={(e) => setWachtwoord(e.target.value)} autoComplete="current-password" required />
            {fout && <p style={s.fout}>{fout}</p>}
            <button style={s.knop} type="submit" disabled={bezig}>
              {bezig ? 'Bezig…' : 'Inloggen'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Ingelogd, maar geen supportmedewerker. Bewust vóór elke factorhandeling:
  // wie hier belandt heeft een gewoon Ribba-account en hoort geen tweede factor
  // aan dat account over te houden. Geen QR, geen enroll.
  if (fase === 'geen-toegang') {
    return (
      <div style={s.container}>
        <div style={s.kaart}>
          <RibbaLogo height={32} />
          <h1 style={s.h1}>Geen toegang</h1>
          <p style={s.stil}>
            Dit portaal is alleen voor medewerkers van Ribba. Je bent ingelogd,
            maar dit account heeft er geen toegang toe. Er is niets aan je account
            gewijzigd.
          </p>
          <p style={s.stil}>
            Wil je naar je eigen omgeving? Ga naar <Link href="/mijn-ribba">mijn.ribba.app</Link>.
          </p>
          <button style={s.knop} type="button" onClick={uitloggen}>Uitloggen</button>
        </div>
      </div>
    );
  }

  // Twee of meer geverifieerde factoren: de gebruiker kiest zelf. Bewust geen
  // automatische terugval — een reservefactor bewaar je juist apart, dus het
  // portaal mag er nooit ongevraagd eentje uitdagen. Alleen namen, nooit id's.
  if (fase === 'tweefactor-kiezen') {
    return (
      <div style={s.container}>
        <div style={s.kaart}>
          <h1 style={s.h1}>Kies je verificatiemethode</h1>
          <p style={s.stil}>
            Er staan meerdere authenticators op dit account. Kies degene die je bij
            de hand hebt.
          </p>
          {factorOpties.map((optie) => (
            <button
              key={optie.id}
              style={s.knop}
              type="button"
              onClick={() => {
                setFout('');
                setCode('');
                setFactorId(optie.id);
                setFase('tweefactor-invoeren');
              }}
            >
              {optie.naam}
            </button>
          ))}
          <button style={s.knop} type="button" onClick={uitloggen}>Uitloggen</button>
        </div>
      </div>
    );
  }

  if (fase === 'tweefactor-instellen') {
    return (
      <div style={s.container}>
        <div style={s.kaart}>
          <h1 style={s.h1}>Tweefactor instellen</h1>
          <p style={s.stil}>
            Dit portaal toont gegevens van alle rijscholen. Daarom is een tweede
            factor verplicht. Scan de code met je authenticator-app.
          </p>
          {/* De QR komt als data-URI uit Supabase; next/image heeft daar niets
              te optimaliseren en zou hem alleen door een loader duwen. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="QR-code voor de authenticator-app" style={s.qr} />}
          {geheim && (
            <p style={s.geheim}>
              Lukt scannen niet? Voer deze sleutel handmatig in:<br /><code>{geheim}</code>
            </p>
          )}
          <form onSubmit={codeControleren}>
            <input style={s.input} inputMode="numeric" placeholder="6-cijferige code"
              value={code} onChange={(e) => setCode(e.target.value)} required />
            {fout && <p style={s.fout}>{fout}</p>}
            <button style={s.knop} type="submit" disabled={bezig || !factorId}>
              {bezig ? 'Bezig…' : 'Bevestigen'}
            </button>
          </form>
          <button style={s.tekstknop} onClick={uitloggen}>Uitloggen</button>
        </div>
      </div>
    );
  }

  if (fase === 'tweefactor-invoeren') {
    return (
      <div style={s.container}>
        <div style={s.kaart}>
          <h1 style={s.h1}>Tweefactor</h1>
          <p style={s.stil}>Voer de code uit je authenticator-app in.</p>
          <form onSubmit={codeControleren}>
            <input style={s.input} inputMode="numeric" placeholder="6-cijferige code"
              value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            {fout && <p style={s.fout}>{fout}</p>}
            <button style={s.knop} type="submit" disabled={bezig}>
              {bezig ? 'Bezig…' : 'Verder'}
            </button>
          </form>
          <button style={s.tekstknop} onClick={uitloggen}>Uitloggen</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.pagina}>
      <header style={s.header}>
        <div style={s.headerLinks}>
          <RibbaLogo height={26} />
          <span style={s.headerTitel}>Support</span>
        </div>
        <button style={s.tekstknop} onClick={uitloggen}>Uitloggen</button>
      </header>

      <div style={s.balk}>
        <p style={s.uitleg}>
          Niveau 0 — gegevens van de rijschool en aantallen. Geen gegevens van
          leerlingen. Elke keer dat je dit scherm opent, wordt dat vastgelegd.
        </p>
        <label style={s.vinkje}>
          <input type="checkbox" checked={toonIntern}
            onChange={(e) => setToonIntern(e.target.checked)} />
          Toon testscholen
        </label>
      </div>

      {fout && <p style={s.fout}>{fout}</p>}

      <div style={s.tabelWrap}>
        <table style={s.tabel}>
          <thead>
            <tr>
              <th style={s.th}>Rijschool</th>
              <th style={s.th}>Ingeschreven</th>
              <th style={s.th}>Laatst actief</th>
              <th style={s.thNum}>Instr.</th>
              <th style={s.thNum}>Leerl.</th>
              <th style={s.thNum}>Lestypes</th>
              <th style={s.thNum}>Beschikb.</th>
              <th style={s.thNum}>Lessen</th>
              <th style={s.th}>Abonnement</th>
              <th style={s.th} title="Alleen getoond als de koppeling is ingericht">CBR</th>
              <th style={s.th} title="Minstens één ingeschakeld lestype">Lesklaar</th>
            </tr>
          </thead>
          <tbody>
            {scholen.map((school) => (
              <tr key={school.school_id}>
                <td style={s.td}>
                  <Link href={`/support/${school.school_id}`} style={s.schoolLink}>
                    {school.school_name}
                  </Link>
                  {school.is_internal && <span style={s.intern}>intern</span>}
                  {school.city && <span style={s.stad}> · {school.city}</span>}
                </td>
                <td style={s.td}>{datum(school.created_at)}</td>
                <td style={s.td}>{dagenGeleden(school.laatste_activiteit)}</td>
                <td style={s.tdNum}>{school.instructeurs}</td>
                <td style={s.tdNum}>{school.leerlingen}</td>
                <td style={s.tdNum}>{school.lestypes}</td>
                <td style={s.tdNum}>{school.beschikbaarheid}</td>
                <td style={s.tdNum}>{school.lessen}</td>
                <td style={s.td}>{school.abonnement_status ?? '—'}</td>
                <td style={s.td}>
                  {school.cbr_koppeling === 'uit'
                    ? <span style={s.badgeFout}>uit</span>
                    : (school.cbr_koppeling ?? '—')}
                </td>
                <td style={s.td}>
                  <span style={school.onboarding_gereed ? s.badgeOk : s.badgeLet}>
                    {school.onboarding_gereed ? 'ja' : 'nee'}
                  </span>
                </td>
              </tr>
            ))}
            {scholen.length === 0 && !fout && (
              <tr><td style={s.td} colSpan={10}>Geen rijscholen gevonden.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#F8FAFC', padding: 24,
  },
  kaart: {
    background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 400,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 4,
  },
  pagina: { minHeight: '100vh', background: '#F8FAFC', padding: 24 },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, flexWrap: 'wrap', gap: 12,
  },
  headerLinks: { display: 'flex', alignItems: 'center', gap: 12 },
  headerTitel: { fontSize: 18, fontWeight: 600, color: '#0F172A' },
  h1: { fontSize: 22, fontWeight: 700, color: '#0F172A', margin: '12px 0 4px' },
  uitleg: { fontSize: 13, color: '#64748B', margin: 0, maxWidth: 720 },
  balk: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, flexWrap: 'wrap', margin: '0 0 20px',
  },
  vinkje: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
    color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  intern: {
    marginLeft: 8, background: '#EEF2FF', color: '#3730A3', padding: '1px 8px',
    borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
  },
  stil: { fontSize: 14, color: '#64748B', margin: '0 0 16px' },
  input: {
    width: '100%', padding: '12px 14px', border: '1px solid #E2E8F0', borderRadius: 10,
    fontSize: 15, marginTop: 10, boxSizing: 'border-box',
  },
  knop: {
    width: '100%', marginTop: 14, padding: '12px 16px', border: 'none', borderRadius: 10,
    background: '#2563EB', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
  tekstknop: {
    marginTop: 14, background: 'none', border: 'none', color: '#64748B',
    fontSize: 14, cursor: 'pointer', padding: 0, textAlign: 'left',
  },
  fout: { color: '#B91C1C', fontSize: 14, marginTop: 12 },
  qr: { width: 200, height: 200, alignSelf: 'center', margin: '8px 0' },
  geheim: { fontSize: 12, color: '#64748B', wordBreak: 'break-all', margin: '0 0 8px' },
  tabelWrap: {
    overflowX: 'auto', background: '#fff', borderRadius: 14,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  tabel: { width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 900 },
  th: {
    textAlign: 'left', padding: '12px 14px', fontSize: 12, fontWeight: 600,
    color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.4,
    borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
  },
  thNum: {
    textAlign: 'right', padding: '12px 14px', fontSize: 12, fontWeight: 600,
    color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.4,
    borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
  },
  td: { padding: '12px 14px', borderBottom: '1px solid #F1F5F9', color: '#0F172A' },
  tdNum: {
    padding: '12px 14px', borderBottom: '1px solid #F1F5F9',
    color: '#0F172A', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  },
  stad: { color: '#64748B', fontWeight: 400 },
  schoolLink: { color: '#0F172A', fontWeight: 700, textDecoration: 'none' },
  badgeOk: {
    background: '#DCFCE7', color: '#166534', padding: '2px 10px',
    borderRadius: 999, fontSize: 12, fontWeight: 600,
  },
  badgeFout: {
    background: '#FEE2E2', color: '#991B1B', padding: '2px 10px',
    borderRadius: 999, fontSize: 12, fontWeight: 600,
  },
  badgeLet: {
    background: '#FEF3C7', color: '#92400E', padding: '2px 10px',
    borderRadius: 999, fontSize: 12, fontWeight: 600,
  },
};
