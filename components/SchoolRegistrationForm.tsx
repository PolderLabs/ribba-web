'use client';

import { useState, FormEvent } from 'react';
import { isValidPostalCode, normalizePostalCode } from '@/lib/validation';
import { isValidEmail, isValidPhone, isValidKVK, isValidIBAN } from '@/utils/validation';

type FormData = {
  school_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  postal_code: string;
  city: string;
  kvk_number: string;
  btw_number: string;
  iban: string;
  password: string;
  password_confirm: string;
  terms_accepted: boolean;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

export default function SchoolRegistrationForm() {
  const [form, setForm] = useState<FormData>({
    school_name: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    postal_code: '',
    city: '',
    kvk_number: '',
    btw_number: '',
    iban: '',
    password: '',
    password_confirm: '',
    terms_accepted: false,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');

  function validate(): FormErrors {
    const e: FormErrors = {};

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
    } else if (!isValidPhone(form.phone)) {
      e.phone = 'Ongeldig telefoonnummer (bijv. 0612345678)';
    }

    if (!form.address.trim()) e.address = 'Adres is verplicht';

    if (!form.postal_code.trim()) {
      e.postal_code = 'Postcode is verplicht';
    } else if (!isValidPostalCode(form.postal_code)) {
      e.postal_code = 'Ongeldige postcode (bijv. 1234AB)';
    }

    if (!form.city.trim()) e.city = 'Stad is verplicht';

    if (!form.kvk_number.trim()) {
      e.kvk_number = 'KVK-nummer is verplicht';
    } else if (!isValidKVK(form.kvk_number)) {
      e.kvk_number = 'KVK-nummer moet 8 cijfers zijn';
    }

    if (form.btw_number.trim() && !/^NL\d{9}B\d{2}$/.test(form.btw_number.replace(/\s/g, '').toUpperCase())) {
      e.btw_number = 'Ongeldig BTW-nummer (bijv. NL123456789B01)';
    }

    if (!form.iban.trim()) {
      e.iban = 'IBAN is verplicht';
    } else if (!isValidIBAN(form.iban)) {
      e.iban = 'Ongeldig IBAN';
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
      e.terms_accepted = 'Je moet akkoord gaan met de voorwaarden';
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
      const { terms_accepted: _, ...formData } = form;
      const res = await fetch('/api/register-school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          postal_code: normalizePostalCode(form.postal_code),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Er ging iets mis. Probeer het opnieuw.');
      }

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

  if (success) {
    return (
      <div style={{ textAlign: 'center', marginTop: 28 }}>
        <div className="alert alert-success">
          <strong>Account aangemaakt!</strong><br />
          Je kunt nu inloggen in de Ribba app.
        </div>
        <div className="store-badges" style={{ marginTop: 24 }}>
          <a href="https://apps.apple.com/app/ribba/id6741070498" className="store-badge" target="_blank" rel="noopener">
            🍎 App Store
          </a>
          <a href="https://play.google.com/store/apps/details?id=app.ribba.pro" className="store-badge" target="_blank" rel="noopener">
            ▶️ Google Play
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="form-grid">
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
            placeholder="0612345678"
            className={errors.phone ? 'error' : ''}
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
          />
          {errors.phone && <p className="form-error">{errors.phone}</p>}
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
            placeholder="1234AB"
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

        {/* KVK */}
        <div className="form-group">
          <label htmlFor="kvk_number">KVK-nummer</label>
          <input
            id="kvk_number"
            type="text"
            placeholder="12345678"
            maxLength={8}
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
            placeholder="NL123456789B01"
            className={errors.btw_number ? 'error' : ''}
            value={form.btw_number}
            onChange={(e) => handleChange('btw_number', e.target.value)}
          />
          {errors.btw_number && <p className="form-error">{errors.btw_number}</p>}
        </div>

        {/* IBAN */}
        <div className="form-group full-width">
          <label htmlFor="iban">IBAN</label>
          <input
            id="iban"
            type="text"
            placeholder="NL00ABNA0123456789"
            className={errors.iban ? 'error' : ''}
            value={form.iban}
            onChange={(e) => handleChange('iban', e.target.value)}
          />
          {errors.iban && <p className="form-error">{errors.iban}</p>}
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

      {/* Voorwaarden */}
      <div className="form-group full-width" style={{ marginTop: 8 }}>
        <label className="checkbox-label" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 14, color: '#44403C', lineHeight: 1.5 }}>
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
            style={{ marginTop: 3, width: 18, height: 18, accentColor: '#2563EB' }}
          />
          <span>
            Ik ga akkoord met de{' '}
            <a href="/voorwaarden" target="_blank" style={{ color: '#2563EB', fontWeight: 600 }}>
              Algemene Voorwaarden
            </a>{' '}
            en de{' '}
            <a href="/privacy" target="_blank" style={{ color: '#2563EB', fontWeight: 600 }}>
              Privacyverklaring
            </a>
          </span>
        </label>
        {errors.terms_accepted && <p className="form-error">{errors.terms_accepted}</p>}
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
