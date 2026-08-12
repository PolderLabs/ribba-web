'use client';

// De pagina waar Stripe naartoe stuurt na Checkout.
//
// Zij controleert wat zij beweert. Voorheen stond hier onvoorwaardelijk
// "Betaling geslaagd" met een automatische sprong naar de app na twee
// seconden; zie lib/activatie-status.ts voor waarom dat schade aanrichtte.
//
// De statuswaarheid komt uit /api/current-plan — dezelfde bron die /upgrade
// gebruikt. Deze pagina leidt niets zelf af en kent geen billingregels.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../../components/RibbaLogo';
import { APP_STORE_URL } from '@/lib/app-links';
import {
  bepaalActivatieState,
  magDoorsturen,
  type ActivatieState,
} from '@/lib/activatie-status';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Zelfde tweeregelige factory als in app/upgrade/page.tsx. Bewust niet
// geëxtraheerd: dat zou een werkende betaalpagina aanpassen voor een
// constructiedetail, niet voor een gedeelde waarheid.
function getSupabaseBrowser() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

/** Hoe vaak we Ribba vragen of het abonnement er al is. */
const POLL_INTERVAL_MS = 3000;
/**
 * Wanneer we stoppen met vragen. De tekst blijft daarna staan; bij een
 * incasso die dagen duurt is de bevestigingsmail het kanaal, niet deze pagina.
 */
const STOP_POLLEN_NA_MS = 10 * 60 * 1000;

type PlanAntwoord = { plan: string | null; isExpired: boolean };

function SuccessContent() {
  const [ingelogd, setIngelogd] = useState(true);
  const [planAntwoord, setPlanAntwoord] = useState<PlanAntwoord>({ plan: null, isExpired: false });
  const [secondenVerstreken, setSecondenVerstreken] = useState(0);
  // Pas in een effect vullen: de klok uitlezen tijdens render is onzuiver en
  // geeft bij een herrender een ander startpunt.
  const gestartOp = useRef<number | null>(null);

  // ── Statuswaarheid ophalen ────────────────────────────────────────────────
  // Zelfde route als /upgrade: sessie → /api/me voor school_id → /api/current-plan.
  const haalStatus = useCallback(async (): Promise<boolean> => {
    try {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setIngelogd(false);
        return false;
      }
      setIngelogd(true);

      const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
      if (!meRes.ok) return false;
      const me = await meRes.json();
      if (!me?.school_id) return false;

      const planRes = await fetch(`/api/current-plan?school_id=${me.school_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!planRes.ok) return false;
      const body = await planRes.json().catch(() => null);
      if (!body) return false;

      setPlanAntwoord({ plan: body.plan ?? null, isExpired: Boolean(body.isExpired) });
      return body.plan !== null && !body.isExpired;
    } catch {
      // Een mislukte peiling zegt niets over de betaling. Stil blijven en het
      // opnieuw proberen is hier het eerlijke gedrag; een foutmelding zou een
      // conclusie zijn die we niet kunnen onderbouwen.
      return false;
    }
  }, []);

  useEffect(() => {
    gestartOp.current ??= Date.now();
    let gestopt = false;
    let timer: ReturnType<typeof setTimeout>;

    const rondje = async () => {
      const klaar = await haalStatus();
      if (gestopt || klaar) return;
      if (Date.now() - (gestartOp.current ?? Date.now()) >= STOP_POLLEN_NA_MS) return;
      timer = setTimeout(rondje, POLL_INTERVAL_MS);
    };
    rondje();

    return () => {
      gestopt = true;
      clearTimeout(timer);
    };
  }, [haalStatus]);

  // Alleen om de tekst na de drempel om te zetten. Nadrukkelijk geen status.
  useEffect(() => {
    gestartOp.current ??= Date.now();
    const id = setInterval(
      () => setSecondenVerstreken(Math.floor((Date.now() - (gestartOp.current ?? Date.now())) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const state = bepaalActivatieState({
    ingelogd,
    plan: planAntwoord.plan,
    isExpired: planAntwoord.isExpired,
    secondenVerstreken,
  });

  return (
    <main className="page-wrapper">
      <div className="card">
        <div className="logo"><RibbaLogo height={36} /></div>
        <Inhoud state={state} plan={planAntwoord.plan} />
      </div>
    </main>
  );
}

function Inhoud({ state, plan }: { state: ActivatieState; plan: string | null }) {
  if (state === 'actief') {
    const planLabel = plan === 'premium' ? 'Ribba Premium' : 'Ribba Basic';
    return (
      <>
        <div className="payment-check">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="24" fill="#f0fdf4" />
            <path
              d="M16 24.5L21.5 30L32 19"
              stroke="#16a34a"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="pill pill-green">Actief</p>
        <h1>Abonnement actief</h1>
        <p className="subtitle">{planLabel} is nu beschikbaar.</p>

        {magDoorsturen(state) && (
          <a href="ribba://upgrade-success" className="btn-primary">
            Open Ribba
          </a>
        )}

        <div className="divider" />
        <p className="footer-text">
          App niet geïnstalleerd? <a href={APP_STORE_URL}>Download hier</a>
        </p>
      </>
    );
  }

  if (state === 'geen_sessie') {
    return (
      <>
        <h1>Je bestelling is ontvangen</h1>
        <p className="subtitle">Log in om de status van je abonnement te zien.</p>
        <Link href="/login" className="btn-primary">Inloggen</Link>
      </>
    );
  }

  if (state === 'duurt_langer') {
    return (
      <>
        <p className="pill pill-amber">Wordt verwerkt</p>
        <h1>Je betaling wordt nog verwerkt</h1>
        <p className="subtitle">
          Bij automatische incasso kan dit een paar dagen duren. Je krijgt een e-mail zodra je
          abonnement actief is. Je hoeft niets te doen.
        </p>
        {/* Bewust geen knop. Een weg terug naar /upgrade is precies hoe een
            tweede Checkout ontstaat, en de app is in deze toestand nog dicht. */}
      </>
    );
  }

  return (
    <>
      <p className="pill">Bezig</p>
      <h1>Je bestelling is ontvangen</h1>
      <p className="subtitle">We activeren je abonnement. Dit duurt meestal een paar seconden.</p>
    </>
  );
}

export default function UpgradeSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="page-wrapper">
          <div className="card">
            <div className="logo"><RibbaLogo height={36} /></div>
            <p className="subtitle">Laden…</p>
          </div>
        </main>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
