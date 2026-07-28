'use client';

import { useState, FormEvent } from 'react';
import { isValidEmail } from '@/utils/validation';
import { StoreBadges } from '@/app/components/StoreBadges';
import { LEGAL_VERSIONS } from '@/lib/legal-versions';
import { trackTrialSignup } from '@/lib/gtag';
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
  const [errors, setErrors] = useState<FormErrors>({});
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
      const res = await fetch('/api/register-school', {
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
          kvk_number: normalizeBusinessRegister(form.kvk_number),
          btw_number: form.btw_number.trim() ? normalizeVat(form.btw_number) : '',
          password: form.password,
          password_confirm: form.password_confirm,
          legal_acceptances: {
            terms: LEGAL_VERSIONS.terms,
            privacy: LEGAL_VERSIONS.privacy,
            dpa: LEGAL_VERSIONS.dpa,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Er ging iets mis. Probeer het opnieuw.');
      }

      const data = await res.json().catch(() => null);
      // Google Ads trial-registratie-conversie: pas hier, ná een geslaagde
      // account-aanmaak. school_id als transaction_id voor dedupe.
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
          <a href="mailto:hallo@ribba.app" style={{ color: '#2563EB' }}>hallo@ribba.app</a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="form-grid">
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

      <div className="form-submit">
        <button type="submit" className="btn-primary" disabled={submitting} style={{ marginTop: 0 }}>
          {submitting ? (
            <>
              <span className="spinner" />
              Bezig met aanmaken...
            </>
          ) : (
            'Account aanmaken'
          )}
        </button>
      </div>
    </form>
  );
}
