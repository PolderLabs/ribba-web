'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
// De actiecode is zichtbaar zodra — en alleen zodra — de route hem kan
// honoreren. Afgeleid, niet los instelbaar. Zie lib/signup-funnel.ts.
import {
  ACTIEVE_SIGNUP_ROUTE,
  aanbodVereistVoorInschrijven,
  promoBeschikbaar,
  verzendknopLabel,
  wachtwoordBijInschrijven,
} from '@/lib/signup-funnel';

// Het aanbod komt SERVER-SIDE uit Stripe, niet uit een lijst in deze
// component. Een wijziging van €25 → €30 of van 1 → 3 maanden gratis moet
// zichtbaar worden zonder codewijziging. Zou de prijs hier staan, dan hadden
// we dezelfde dubbele waarheid als een price-id-mapping — alleen in
// marketingtekst, waar hij nog moeilijker te vinden is.
//
// DEZE COMPONENT REKENT NIETS. Bedragen, btw, "vandaag €0", de zin
// "6 maanden gratis" en de datum van de eerste incasso komen alle vijf van de
// server. Hier stond eerder een `gratisPeriode(dagen)` die uit `30` de tekst
// "1 maand gratis" maakte — dat was een tweede plek waar het aanbod ontstond,
// en hij zou stilzwijgend gaan liegen zodra de duur een echte kalendermaand
// werd in plaats van 30 dagen.
//
// ÉÉN AANBOD, GEEN KEUZE. Sinds 16 aug start iedereen op Premium; wisselen
// naar Basic kan daarna in de app. Er staan hier dus geen vergelijkingskaarten
// meer — die keuze vlak vóór een machtiging leverde alleen twijfel op, en de
// prijs die telt is toch pas na de gratis periode aan de orde.
type Aanbod = {
  bedragen: {
    nettoCenten: number;
    btwCenten: number;
    brutoCenten: number;
    btwTariefPercent: number;
    valuta: string;
    interval: string;
  };
  /** 0 tijdens een gratis periode. Hoort visueel het prominentst. */
  vandaagVerschuldigdCenten: number;
  /** Het standaardaanbod. null zodra een actie het overneemt. */
  trial: { tekst: string; eersteIncassoISO: string } | null;
  /** Een actie. Sluit `trial` uit. `tekst` komt van de server. */
  korting: { code: string; tekst: string } | null;
};

function bedrag(centen: number, valuta: string): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: valuta })
    .format(centen / 100);
}

function datum(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(iso));
}
import { isValidEmail } from '@/utils/validation';
import { StoreBadges } from '@/app/components/StoreBadges';
import { LEGAL_VERSIONS } from '@/lib/legal-versions';
import { trackTrialSignup } from '@/lib/gtag';
import { readSignupAttribution } from '@/lib/signup-attribution';
import {
  COUNTRY_PROFILES,
  ENABLED_COUNTRY_CODES,
  LEGAL_FORMS,
  getCountryProfile,
  isValidBusinessRegisterFor,
  isValidPhoneFor,
  isValidPostcodeFor,
  isValidVatFor,
  normalizeBusinessRegister,
  normalizePostcode,
  normalizeVat,
  type LegalForm,
} from '@/lib/country-profile';

type FormData = {
  legal_form: LegalForm | '';
  country_code: string;
  school_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  postal_code: string;
  city: string;
  // BV-blok
  legal_name: string;
  billing_differs: boolean;
  billing_address: string;
  billing_postal_code: string;
  billing_city: string;
  kvk_number: string;
  btw_number: string;
  password: string;
  password_confirm: string;
  terms_accepted: boolean;
  privacy_accepted: boolean;
  dpa_accepted: boolean;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  cursor: 'pointer',
  fontSize: 14,
  color: '#44403C',
  lineHeight: 1.5,
};

const checkboxInputStyle: React.CSSProperties = {
  marginTop: 3,
  width: 18,
  height: 18,
  accentColor: '#2563EB',
};

export default function SchoolRegistrationForm() {
  const [form, setForm] = useState<FormData>({
    legal_form: '',
    country_code: 'NL',
    school_name: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    postal_code: '',
    city: '',
    legal_name: '',
    billing_differs: false,
    billing_address: '',
    billing_postal_code: '',
    billing_city: '',
    kvk_number: '',
    btw_number: '',
    password: '',
    password_confirm: '',
    terms_accepted: false,
    privacy_accepted: false,
    dpa_accepted: false,
  });
  const [aanbod, setAanbod] = useState<Aanbod | null>(null);
  const [aanbodFout, setAanbodFout] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // ── Actiecode ────────────────────────────────────────────────────────────
  // Wat de code doet met het aanbod bepaalt de SERVER, met dezelfde resolver
  // die Checkout straks voedt. Deze component stuurt alleen de tekst op en
  // toont wat er terugkomt. Hier wordt niets afgeleid uit "STARTGRATIS" en
  // niets uitgerekend — anders ontstaat er weer een tweede plek waar een
  // aanbod ontstaat, en die gaat een keer afwijken van wat er geïncasseerd
  // wordt.
  const [codeInvoer, setCodeInvoer] = useState('');
  /** De code die de server heeft geaccepteerd. Alleen deze telt. */
  const [codeToegepast, setCodeToegepast] = useState<string | null>(null);
  const [codeGeweigerd, setCodeGeweigerd] = useState(false);
  const [codeBezig, setCodeBezig] = useState(false);

  const haalAanbod = useCallback(async (codeInput: string | null) => {
    // Zolang de oude submitroute draait, wordt er geen code meegestuurd — ook
    // niet als er er op een of andere manier toch een in de state komt. Het
    // getoonde aanbod is dan gegarandeerd het aanbod dat wordt uitgevoerd.
    const code = promoBeschikbaar ? codeInput : null;
    setCodeBezig(true);
    try {
      const url = code ? `/api/signup/offer?code=${encodeURIComponent(code)}` : '/api/signup/offer';
      const d = await (await fetch(url)).json();
      if (d?.beschikbaar && d.bedragen) {
        setAanbod({
          bedragen: d.bedragen,
          vandaagVerschuldigdCenten: d.vandaagVerschuldigdCenten,
          trial: d.trial ?? null,
          korting: d.korting ?? null,
        });
        setAanbodFout(false);
        setCodeToegepast(d.promoToegepast ?? null);
        setCodeGeweigerd(Boolean(d.promoGeweigerd));
      } else {
        setAanbodFout(true);
      }
    } catch {
      setAanbodFout(true);
    } finally {
      setCodeBezig(false);
    }
  }, []);

  useEffect(() => { void haalAanbod(null); }, [haalAanbod]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');

  // Het profiel stuurt labels, placeholders en validatie. Fallback op NL kan
  // hier niet stil misgaan: de picker biedt uitsluitend enabled landen aan en
  // de server valideert het land opnieuw.
  const profile = getCountryProfile(form.country_code) ?? COUNTRY_PROFILES.NL;
  const isBv = form.legal_form === 'bv';

  function validate(): FormErrors {
    const e: FormErrors = {};

    if (!form.legal_form) e.legal_form = 'Kies de bedrijfsvorm van je rijschool';
    if (!getCountryProfile(form.country_code)) e.country_code = 'Kies een land';

    if (!form.school_name.trim()) e.school_name = 'Naam rijschool is verplicht';
    if (!form.first_name.trim()) e.first_name = 'Voornaam is verplicht';
    if (!form.last_name.trim()) e.last_name = 'Achternaam is verplicht';

    if (!form.email.trim()) {
      e.email = 'E-mailadres is verplicht';
    } else if (!isValidEmail(form.email)) {
      e.email = 'Ongeldig e-mailadres';
    }

    if (!form.phone.trim()) {
      e.phone = 'Telefoonnummer is verplicht';
    } else if (!isValidPhoneFor(profile, form.phone)) {
      e.phone = profile.phone.errorHint;
    }

    if (!form.address.trim()) e.address = 'Adres is verplicht';

    if (!form.postal_code.trim()) {
      e.postal_code = 'Postcode is verplicht';
    } else if (!isValidPostcodeFor(profile, form.postal_code)) {
      e.postal_code = profile.postcode.errorHint;
    }

    if (!form.city.trim()) e.city = 'Stad is verplicht';

    if (isBv) {
      if (!form.legal_name.trim()) {
        e.legal_name = 'Statutaire naam is verplicht voor een BV';
      }
      if (form.billing_differs) {
        if (!form.billing_address.trim()) e.billing_address = 'Vestigingsadres is verplicht';
        if (!form.billing_postal_code.trim()) {
          e.billing_postal_code = 'Postcode is verplicht';
        } else if (!isValidPostcodeFor(profile, form.billing_postal_code)) {
          e.billing_postal_code = profile.postcode.errorHint;
        }
        if (!form.billing_city.trim()) e.billing_city = 'Plaats is verplicht';
      }
    }

    if (!form.kvk_number.trim()) {
      e.kvk_number = `${profile.businessRegister.label} is verplicht`;
    } else if (!isValidBusinessRegisterFor(profile, form.kvk_number)) {
      e.kvk_number = profile.businessRegister.errorHint;
    }

    if (form.btw_number.trim() && !isValidVatFor(profile, form.btw_number)) {
      e.btw_number = `Ongeldig BTW-nummer (bijv. ${profile.vat.placeholder})`;
    }

    // Alleen de oude route maakt het account meteen aan en heeft dus een
    // wachtwoord nodig. Zie lib/signup-funnel.ts.
    if (wachtwoordBijInschrijven) {
      if (!form.password) {
        e.password = 'Wachtwoord is verplicht';
      } else if (form.password.length < 8) {
        e.password = 'Wachtwoord moet minimaal 8 tekens zijn';
      }

      if (!form.password_confirm) {
        e.password_confirm = 'Bevestig je wachtwoord';
      } else if (form.password !== form.password_confirm) {
        e.password_confirm = 'Wachtwoorden komen niet overeen';
      }
    }

    if (!form.terms_accepted) {
      e.terms_accepted = 'Je moet akkoord gaan met de Algemene Voorwaarden';
    }
    if (!form.privacy_accepted) {
      e.privacy_accepted = 'Je moet de Privacyverklaring bevestigen';
    }
    if (!form.dpa_accepted) {
      e.dpa_accepted = 'Je moet akkoord gaan met de Verwerkersovereenkomst';
    }

    return e;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError('');

    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);

    try {
      const useBilling = isBv && form.billing_differs;
      const res = await fetch(ACTIEVE_SIGNUP_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_form: form.legal_form,
          country_code: form.country_code,
          school_name: form.school_name,
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          phone: form.phone,
          address: form.address,
          postal_code: normalizePostcode(form.postal_code),
          city: form.city,
          legal_name: isBv ? form.legal_name : null,
          billing_address: useBilling ? form.billing_address : null,
          billing_postal_code: useBilling ? normalizePostcode(form.billing_postal_code) : null,
          billing_city: useBilling ? form.billing_city : null,
          // Alleen wanneer de route hem ook kan honoreren, en alleen de code
          // die de SERVER heeft geaccepteerd. Een geweigerde code gaat niet
          // mee; de server valideert straks toch opnieuw.
          ...(promoBeschikbaar && codeToegepast ? { promo_code: codeToegepast } : {}),
          kvk_number: normalizeBusinessRegister(form.kvk_number),
          btw_number: form.btw_number.trim() ? normalizeVat(form.btw_number) : '',
          // De nieuwe route kent geen wachtwoord; meesturen zou het stil
          // laten vallen en de indruk wekken dat het iets doet.
          ...(wachtwoordBijInschrijven
            ? { password: form.password, password_confirm: form.password_confirm }
            : {}),
          legal_acceptances: {
            terms: LEGAL_VERSIONS.terms,
            privacy: LEGAL_VERSIONS.privacy,
            dpa: LEGAL_VERSIONS.dpa,
          },
          // Herkomst (utm/referrer/landing), first-touch uit localStorage.
          attribution: readSignupAttribution(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Er ging iets mis. Probeer het opnieuw.');
      }

      const data = await res.json().catch(() => null);

      // ── De nieuwe route eindigt bij Stripe, niet hier ────────────────────
      //
      // Zij maakt geen account maar een Checkout-sessie, en geeft een
      // `checkoutUrl` terug. Wie hier een successcherm zou tonen, laat iemand
      // achter met "gelukt!" terwijl er nooit een machtiging is afgegeven en
      // er dus nooit een rijschool ontstaat.
      //
      // Bewust géén `setSubmitting(false)` vóór de sprong: de knop blijft in
      // de bezig-staat tot de browser weg navigeert. Anders lijkt het formulier
      // klaar terwijl er een redirect onderweg is, en klikt iemand nog een keer.
      if (typeof data?.checkoutUrl === 'string' && data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      // De oude route maakt het account wél meteen aan en meldt succes.
      // Google Ads-conversie hoort daar: op de nieuwe route zou hij afhakers
      // meetellen, want daar is het formulier verzenden nog geen inschrijving.
      // Die conversie verhuist naar /registreren/ontvangen.
      trackTrialSignup(data?.school_id ?? undefined);
      setSuccess(true);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Onbekende fout');
    } finally {
      setSubmitting(false);
    }
  }

  function handleChange(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function handleLegalFormChange(value: LegalForm | '') {
    setForm((prev) => ({
      ...prev,
      legal_form: value,
      // Weg van BV → BV-velden leegmaken zodat er nooit halfslachtige
      // BV-data in de payload kan belanden.
      ...(value !== 'bv'
        ? { legal_name: '', billing_differs: false, billing_address: '', billing_postal_code: '', billing_city: '' }
        : {}),
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.legal_form;
      delete next.legal_name;
      delete next.billing_address;
      delete next.billing_postal_code;
      delete next.billing_city;
      return next;
    });
  }

  if (success) {
    return (
      <div style={{ textAlign: 'center', marginTop: 28 }}>
        <div className="alert alert-success">
          <strong>Bijna klaar! 📬</strong><br />
          We hebben je een e-mail gestuurd. Klik op de link in de mail om je account te bevestigen.
          Daarna kun je inloggen in de Ribba app.
        </div>
        <div style={{ marginTop: 24 }}>
          <StoreBadges />
        </div>
        <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 16 }}>
          Geen mail ontvangen? Check je spam-folder of mail ons op{' '}
          <a href="mailto:team@ribba.app" style={{ color: '#2563EB' }}>team@ribba.app</a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="form-grid">
        {/* Je abonnement — geen keuze meer, één aanbod. */}
        <fieldset className="form-group full-width" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ padding: 0, marginBottom: 6, fontWeight: 600 }}>Je abonnement</legend>

          {aanbodFout && (
            <p style={{ margin: 0, fontSize: 14, color: '#B45309', lineHeight: 1.5 }}>
              We kunnen het actuele aanbod nu niet ophalen. Probeer het later opnieuw of mail{' '}
              <a href="mailto:team@ribba.app">team@ribba.app</a>.
            </p>
          )}
          {!aanbod && !aanbodFout && (
            <p style={{ margin: 0, fontSize: 14, color: '#78716C' }}>Aanbod ophalen…</p>
          )}

          {aanbod && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: '#57534E', lineHeight: 1.5 }}>
                Je start met Ribba Premium. Wisselen naar Basic kan later altijd
                in de app — ook tijdens de gratis periode.
              </p>

              {/* Actiecode. Bewust bóven de kaarten: je ziet meteen wat hij
                  doet. Verschijnt pas wanneer het formulier naar de nieuwe
                  funnel post — zie lib/signup-funnel.ts. */}
              {promoBeschikbaar && (
              <div style={{ marginBottom: 14 }}>
                {codeToegepast ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    background: '#F0FDF4', border: '1px solid #BBF7D0',
                    borderRadius: 8, padding: '10px 12px',
                  }}>
                    <span style={{ fontSize: 14, color: '#15803D', fontWeight: 600 }}>
                      Code {codeToegepast} toegepast
                    </span>
                    <button
                      type="button"
                      onClick={() => { setCodeInvoer(''); void haalAanbod(null); }}
                      style={{
                        marginLeft: 'auto', background: 'none', border: 0, padding: 0,
                        fontSize: 13, color: '#57534E', textDecoration: 'underline', cursor: 'pointer',
                      }}
                    >
                      Verwijderen
                    </button>
                  </div>
                ) : (
                  <>
                    <label htmlFor="promo_code" style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>
                      Actiecode <span style={{ color: '#78716C' }}>(optioneel)</span>
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        id="promo_code"
                        type="text"
                        value={codeInvoer}
                        autoComplete="off"
                        // BEWUST GEEN VOORBEELDCODE. Hier stond
                        // "Bijvoorbeeld STARTGRATIS", en daarmee gaf de
                        // inschrijfpagina de lopende campagne weg aan iedere
                        // bezoeker. Een actiecode is gericht: hij hoort bij de
                        // rijscholen die je ermee wilt binnenhalen, niet bij
                        // wie toevallig het formulier opent.
                        placeholder=""
                        onChange={(e) => { setCodeInvoer(e.target.value); setCodeGeweigerd(false); }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          // Anders verstuurt Enter het hele formulier.
                          e.preventDefault();
                          if (codeInvoer.trim()) void haalAanbod(codeInvoer.trim());
                        }}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <button
                        type="button"
                        disabled={codeBezig || !codeInvoer.trim()}
                        onClick={() => void haalAanbod(codeInvoer.trim())}
                        style={{
                          padding: '0 16px', borderRadius: 8, border: '1px solid #D6D3D1',
                          background: '#FFFFFF', fontSize: 14, fontWeight: 600,
                          cursor: codeBezig || !codeInvoer.trim() ? 'default' : 'pointer',
                          opacity: codeBezig || !codeInvoer.trim() ? 0.5 : 1, whiteSpace: 'nowrap',
                        }}
                      >
                        {codeBezig ? 'Bezig…' : 'Toepassen'}
                      </button>
                    </div>
                  </>
                )}

                {codeGeweigerd && (
                  // Nooit stil terugvallen: wie een code intypt moet horen dát
                  // hij niet geldt, én wat er dan wél geldt. Doorgaan mag —
                  // een verkeerd getypte code hoort niemand tegen te houden.
                  <p style={{ margin: '8px 0 0', fontSize: 14, color: '#B91C1C', lineHeight: 1.5 }}>
                    Deze code is niet geldig, verlopen of al gebruikt.{' '}
                    <span style={{ color: '#57534E' }}>
                      {aanbod.trial
                        ? `Het standaardaanbod geldt: ${aanbod.trial.tekst}.`
                        : 'Het standaardaanbod geldt.'}
                      {' '}Je kunt gewoon doorgaan.
                    </span>
                  </p>
                )}
              </div>
              )}
              {/* Eén samenvatting, geen keuzekaarten. Wat er staat komt van
                  de server: de zin over de gratis periode, de bedragen en het
                  bedrag van vandaag. Deze component rekent niets. */}
              <div style={{
                border: '1px solid #E7E5E4', background: '#FFFFFF',
                borderRadius: 10, padding: '12px 14px',
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <span style={{ flex: 1 }}>
                  <strong style={{ display: 'block' }}>Ribba Premium</strong>

                  {/* Mét einddatum, bewust. Stripe's eigen betaalpagina rekent
                      de kop altijd om naar dagen — "183 dagen gratis" waar wij
                      "6 maanden" zeggen. De datum is het herkenningspunt dat op
                      beide schermen gelijk is. */}
                  {aanbod.trial && (
                    <span style={{ display: 'block', fontSize: 14, color: '#15803D', fontWeight: 600 }}>
                      {aanbod.trial.tekst}, tot {datum(aanbod.trial.eersteIncassoISO)}
                    </span>
                  )}
                  {/* Bij een actie komt de zin van de server: die weet of het
                      100% is of een gedeeltelijke korting, en hoe lang. */}
                  {aanbod.korting && (
                    <span style={{ display: 'block', fontSize: 14, color: '#15803D', fontWeight: 600 }}>
                      {aanbod.korting.tekst}
                    </span>
                  )}

                  {/* Netto prominent: dat is de commerciële prijs die we
                      communiceren, en de rijschool is btw-plichtig. */}
                  <span style={{ display: 'block', fontSize: 14, color: '#57534E' }}>
                    {aanbod.trial || aanbod.korting ? 'Daarna ' : ''}
                    {bedrag(aanbod.bedragen.nettoCenten, aanbod.bedragen.valuta)} per maand excl. btw
                  </span>
                  {/* Bruto eronder, zodat niemand bij Checkout schrikt. */}
                  <span style={{ display: 'block', fontSize: 13, color: '#78716C' }}>
                    {bedrag(aanbod.bedragen.brutoCenten, aanbod.bedragen.valuta)} incl. btw
                  </span>
                </span>
                <span style={{
                  fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap',
                  color: aanbod.vandaagVerschuldigdCenten === 0 ? '#15803D' : '#57534E',
                }}>
                  {aanbod.vandaagVerschuldigdCenten === 0
                    ? 'Vandaag €0'
                    : `Vandaag ${bedrag(aanbod.vandaagVerschuldigdCenten, aanbod.bedragen.valuta)}`}
                </span>
              </div>
            </>
          )}
        </fieldset>

        {/* Bedrijfsvorm */}
        <div className="form-group full-width">
          <label htmlFor="legal_form">Bedrijfsvorm</label>
          <select
            id="legal_form"
            className={errors.legal_form ? 'error' : ''}
            value={form.legal_form}
            onChange={(e) => handleLegalFormChange(e.target.value as LegalForm | '')}
          >
            <option value="" disabled>
              Kies bedrijfsvorm
            </option>
            {LEGAL_FORMS.map((lf) => (
              <option key={lf.value} value={lf.value}>
                {lf.label}
              </option>
            ))}
          </select>
          {errors.legal_form && <p className="form-error">{errors.legal_form}</p>}
        </div>

        {/* Land */}
        <div className="form-group full-width">
          <label htmlFor="country_code">Land</label>
          <select
            id="country_code"
            className={errors.country_code ? 'error' : ''}
            value={form.country_code}
            onChange={(e) => handleChange('country_code', e.target.value)}
          >
            {ENABLED_COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {COUNTRY_PROFILES[code]?.label ?? code}
              </option>
            ))}
          </select>
          {errors.country_code && <p className="form-error">{errors.country_code}</p>}
        </div>

        {/* Naam rijschool */}
        <div className="form-group full-width">
          <label htmlFor="school_name">Naam rijschool</label>
          <input
            id="school_name"
            type="text"
            placeholder="Rijschool Voorbeeld"
            className={errors.school_name ? 'error' : ''}
            value={form.school_name}
            onChange={(e) => handleChange('school_name', e.target.value)}
          />
          {errors.school_name && <p className="form-error">{errors.school_name}</p>}
        </div>

        {/* Adres */}
        <div className="form-group full-width">
          <label htmlFor="address">Adres</label>
          <input
            id="address"
            type="text"
            placeholder="Keizersgracht 123"
            className={errors.address ? 'error' : ''}
            value={form.address}
            onChange={(e) => handleChange('address', e.target.value)}
          />
          {errors.address && <p className="form-error">{errors.address}</p>}
        </div>

        {/* Postcode */}
        <div className="form-group">
          <label htmlFor="postal_code">Postcode</label>
          <input
            id="postal_code"
            type="text"
            placeholder={profile.postcode.placeholder}
            className={errors.postal_code ? 'error' : ''}
            value={form.postal_code}
            onChange={(e) => handleChange('postal_code', e.target.value)}
          />
          {errors.postal_code && <p className="form-error">{errors.postal_code}</p>}
        </div>

        {/* Stad */}
        <div className="form-group">
          <label htmlFor="city">Stad</label>
          <input
            id="city"
            type="text"
            placeholder="Rotterdam"
            className={errors.city ? 'error' : ''}
            value={form.city}
            onChange={(e) => handleChange('city', e.target.value)}
          />
          {errors.city && <p className="form-error">{errors.city}</p>}
        </div>

        {/* Email */}
        <div className="form-group full-width">
          <label htmlFor="email">E-mailadres</label>
          <input
            id="email"
            type="email"
            placeholder="info@jouwrijschool.nl"
            className={errors.email ? 'error' : ''}
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
          />
          {errors.email && <p className="form-error">{errors.email}</p>}
        </div>

        {/* Telefoon */}
        <div className="form-group full-width">
          <label htmlFor="phone">Telefoonnummer</label>
          <input
            id="phone"
            type="tel"
            placeholder={profile.phone.placeholder}
            className={errors.phone ? 'error' : ''}
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
          />
          {errors.phone && <p className="form-error">{errors.phone}</p>}
        </div>

        {/* BV-blok: statutaire naam + optioneel afwijkend vestigingsadres */}
        {isBv && (
          <>
            <div className="form-group full-width">
              <label htmlFor="legal_name">Statutaire naam (zoals ingeschreven bij de KvK)</label>
              <input
                id="legal_name"
                type="text"
                placeholder="Voorbeeld Holding B.V."
                className={errors.legal_name ? 'error' : ''}
                value={form.legal_name}
                onChange={(e) => handleChange('legal_name', e.target.value)}
              />
              {errors.legal_name && <p className="form-error">{errors.legal_name}</p>}
              <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>
                Deze naam komt op je facturen te staan.
              </p>
            </div>

            <div className="form-group full-width">
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={form.billing_differs}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setForm((prev) => ({
                      ...prev,
                      billing_differs: checked,
                      ...(checked ? {} : { billing_address: '', billing_postal_code: '', billing_city: '' }),
                    }));
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.billing_address;
                      delete next.billing_postal_code;
                      delete next.billing_city;
                      return next;
                    });
                  }}
                  style={checkboxInputStyle}
                />
                <span>Het vestigingsadres van de BV wijkt af van het rijschooladres</span>
              </label>
            </div>

            {form.billing_differs && (
              <>
                <div className="form-group full-width">
                  <label htmlFor="billing_address">Vestigingsadres BV</label>
                  <input
                    id="billing_address"
                    type="text"
                    placeholder="Herengracht 1"
                    className={errors.billing_address ? 'error' : ''}
                    value={form.billing_address}
                    onChange={(e) => handleChange('billing_address', e.target.value)}
                  />
                  {errors.billing_address && <p className="form-error">{errors.billing_address}</p>}
                </div>
                <div className="form-group">
                  <label htmlFor="billing_postal_code">Postcode</label>
                  <input
                    id="billing_postal_code"
                    type="text"
                    placeholder={profile.postcode.placeholder}
                    className={errors.billing_postal_code ? 'error' : ''}
                    value={form.billing_postal_code}
                    onChange={(e) => handleChange('billing_postal_code', e.target.value)}
                  />
                  {errors.billing_postal_code && <p className="form-error">{errors.billing_postal_code}</p>}
                </div>
                <div className="form-group">
                  <label htmlFor="billing_city">Plaats</label>
                  <input
                    id="billing_city"
                    type="text"
                    placeholder="Amsterdam"
                    className={errors.billing_city ? 'error' : ''}
                    value={form.billing_city}
                    onChange={(e) => handleChange('billing_city', e.target.value)}
                  />
                  {errors.billing_city && <p className="form-error">{errors.billing_city}</p>}
                </div>
              </>
            )}
          </>
        )}

        {/* Handelsregister (KvK/KBO — label volgt het land) */}
        <div className="form-group">
          <label htmlFor="kvk_number">{profile.businessRegister.label}</label>
          <input
            id="kvk_number"
            type="text"
            placeholder={profile.businessRegister.placeholder}
            className={errors.kvk_number ? 'error' : ''}
            value={form.kvk_number}
            onChange={(e) => handleChange('kvk_number', e.target.value)}
          />
          {errors.kvk_number && <p className="form-error">{errors.kvk_number}</p>}
        </div>

        {/* BTW */}
        <div className="form-group">
          <label htmlFor="btw_number">BTW-nummer (optioneel)</label>
          <input
            id="btw_number"
            type="text"
            placeholder={profile.vat.placeholder}
            className={errors.btw_number ? 'error' : ''}
            value={form.btw_number}
            onChange={(e) => handleChange('btw_number', e.target.value)}
          />
          {errors.btw_number && <p className="form-error">{errors.btw_number}</p>}
        </div>

        {/* Voornaam */}
        <div className="form-group">
          <label htmlFor="first_name">Voornaam</label>
          <input
            id="first_name"
            type="text"
            placeholder="Jan"
            className={errors.first_name ? 'error' : ''}
            value={form.first_name}
            onChange={(e) => handleChange('first_name', e.target.value)}
          />
          {errors.first_name && <p className="form-error">{errors.first_name}</p>}
        </div>

        {/* Achternaam */}
        <div className="form-group">
          <label htmlFor="last_name">Achternaam</label>
          <input
            id="last_name"
            type="text"
            placeholder="de Vries"
            className={errors.last_name ? 'error' : ''}
            value={form.last_name}
            onChange={(e) => handleChange('last_name', e.target.value)}
          />
          {errors.last_name && <p className="form-error">{errors.last_name}</p>}
        </div>

        {/* Wachtwoord — alleen bij de oude route, die het account meteen
            aanmaakt. Bij de nieuwe route ontstaat het account pas ná de
            betaling en kiest de rijschool zelf een wachtwoord via de mail. */}
        {wachtwoordBijInschrijven ? (
          <>
          {/* Wachtwoord */}
          <div className="form-group">
            <label htmlFor="password">Wachtwoord</label>
            <input
              id="password"
              type="password"
              placeholder="Minimaal 8 tekens"
              className={errors.password ? 'error' : ''}
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
            />
            {errors.password && <p className="form-error">{errors.password}</p>}
          </div>

          {/* Bevestig wachtwoord */}
          <div className="form-group">
            <label htmlFor="password_confirm">Bevestig wachtwoord</label>
            <input
              id="password_confirm"
              type="password"
              placeholder="Herhaal wachtwoord"
              className={errors.password_confirm ? 'error' : ''}
              value={form.password_confirm}
              onChange={(e) => handleChange('password_confirm', e.target.value)}
            />
            {errors.password_confirm && <p className="form-error">{errors.password_confirm}</p>}
          </div>
          </>
        ) : (
          <div className="form-group full-width">
            <p style={{
              margin: 0, fontSize: 14, color: '#57534E', lineHeight: 1.5,
              background: '#F8FAFC', border: '1px solid #E7E5E4',
              borderRadius: 10, padding: '12px 14px',
            }}>
              <strong>Je kiest straks zelf een wachtwoord.</strong> Zodra je
              inschrijving rond is, sturen we je een e-mail met een link om er
              een in te stellen.
            </p>
          </div>
        )}
      </div>

      {/* Legal acceptances — 3 aparte checkboxes voor juridische traceerbaarheid */}
      <div className="form-group full-width" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Algemene Voorwaarden */}
        <div>
          <label className="checkbox-label" style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={form.terms_accepted}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, terms_accepted: e.target.checked }));
                if (errors.terms_accepted) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.terms_accepted;
                    return next;
                  });
                }
              }}
              style={checkboxInputStyle}
            />
            <span>
              Ik ga akkoord met de{' '}
              <a href="https://ribba.app/voorwaarden" target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', fontWeight: 600 }}>
                Algemene Voorwaarden
              </a>
            </span>
          </label>
          {errors.terms_accepted && <p className="form-error">{errors.terms_accepted}</p>}
        </div>

        {/* Privacyverklaring */}
        <div>
          <label className="checkbox-label" style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={form.privacy_accepted}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, privacy_accepted: e.target.checked }));
                if (errors.privacy_accepted) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.privacy_accepted;
                    return next;
                  });
                }
              }}
              style={checkboxInputStyle}
            />
            <span>
              Ik heb de{' '}
              <a href="https://ribba.app/privacybeleid" target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', fontWeight: 600 }}>
                Privacyverklaring
              </a>{' '}
              gelezen
            </span>
          </label>
          {errors.privacy_accepted && <p className="form-error">{errors.privacy_accepted}</p>}
        </div>

        {/* Verwerkersovereenkomst (DPA) */}
        <div>
          <label className="checkbox-label" style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={form.dpa_accepted}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, dpa_accepted: e.target.checked }));
                if (errors.dpa_accepted) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.dpa_accepted;
                    return next;
                  });
                }
              }}
              style={checkboxInputStyle}
            />
            <span>
              Ik ga akkoord met de{' '}
              <a href="/verwerkersovereenkomst" target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', fontWeight: 600 }}>
                Verwerkersovereenkomst
              </a>{' '}
              tussen Ribba en mijn rijschool
            </span>
          </label>
          {errors.dpa_accepted && <p className="form-error">{errors.dpa_accepted}</p>}
        </div>
      </div>

      {serverError && (
        <div className="alert alert-error" style={{ marginTop: 20 }}>
          {serverError}
        </div>
      )}

      {/* Kan het aanbod niet worden opgehaald, dan kan de inschrijving ook
          niet slagen: de route weigert dan met dezelfde reden. Hier stoppen is
          eerlijker dan iemand adres, KVK-nummer en drie akkoorden laten
          invullen om hem daarna alsnog af te wijzen.

          Alleen op de nieuwe route. De oude raakt Stripe niet aan — daar zou
          deze melding liegen én de knop onnodig blokkeren. */}
      {aanbodVereistVoorInschrijven && aanbodFout && (
        <div className="alert alert-error" style={{ marginTop: 20 }}>
          Inschrijven lukt nu niet — we kunnen het actuele aanbod niet ophalen.
          Probeer het later opnieuw of mail <a href="mailto:team@ribba.app">team@ribba.app</a>.
        </div>
      )}

      {serverError && (
        <div className="alert alert-error" style={{ marginTop: 20 }}>
          {serverError}
        </div>
      )}

      <div className="form-submit">
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting || (aanbodVereistVoorInschrijven && (aanbodFout || !aanbod))}
          style={{ marginTop: 0 }}
        >
          {submitting ? (
            <>
              <span className="spinner" />
              Bezig…
            </>
          ) : (
            verzendknopLabel
          )}
        </button>
      </div>
    </form>
  );
}
