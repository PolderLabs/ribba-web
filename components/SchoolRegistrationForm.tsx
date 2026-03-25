'use client';

import { useState, useCallback, useRef, FormEvent } from 'react';
import { isValidPostalCode, normalizePostalCode } from '@/lib/validation';
import { isValidEmail, isValidPhone, isValidKVK, isValidIBAN } from '@/utils/validation';

type KvkResult = {
  name: string;
  kvk_number: string;
  address: string;
  postal_code: string;
  city: string;
} | null;

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
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');
  const [kvkLooking, setKvkLooking] = useState(false);
  const [kvkResult, setKvkResult] = useState<KvkResult>(null);
  const [kvkNotFound, setKvkNotFound] = useState(false);
  const kvkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lookupKvk = useCallback(async (kvk: string) => {
    const cleaned = kvk.replace(/\s/g, '');
    if (cleaned.length !== 8 || !/^\d{8}$/.test(cleaned)) {
      setKvkResult(null);
      setKvkNotFound(false);
      return;
    }

    setKvkLooking(true);
    setKvkNotFound(false);
    try {
      const res = await fetch(`/api/kvk-lookup?kvk=${cleaned}`);
      const data = await res.json();
      if (data.found && data.company) {
        setKvkResult(data.company);
      } else {
        setKvkResult(null);
        setKvkNotFound(true);
      }
    } catch {
      setKvkResult(null);
    } finally {
      setKvkLooking(false);
    }
  }, []);

  const handleKvkChange = useCallback((value: string) => {
    handleChange('kvk_number', value);
    setKvkResult(null);
    setKvkNotFound(false);

    if (kvkTimeout.current) clearTimeout(kvkTimeout.current);
    const cleaned = value.replace(/\s/g, '');
    if (cleaned.length === 8 && /^\d{8}$/.test(cleaned)) {
      kvkTimeout.current = setTimeout(() => lookupKvk(value), 300);
    }
  }, [lookupKvk]);

  const applyKvkResult = useCallback(() => {
    if (!kvkResult) return;
    setForm((prev) => ({
      ...prev,
      school_name: kvkResult.name || prev.school_name,
      address: kvkResult.address || prev.address,
      postal_code: kvkResult.postal_code || prev.postal_code,
      city: kvkResult.city || prev.city,
    }));
    // Clear any related errors
    setErrors((prev) => {
      const next = { ...prev };
      delete next.school_name;
      delete next.address;
      delete next.postal_code;
      delete next.city;
      return next;
    });
  }, [kvkResult]);

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

    // BTW is optional
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
      const res = await fetch('/api/register-school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
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
        {/* KVK */}
        <div className="form-group full-width">
          <label htmlFor="kvk_number">KVK-nummer</label>
          <div style={{ position: 'relative' }}>
            <input
              id="kvk_number"
              type="text"
              placeholder="12345678"
              maxLength={8}
              className={errors.kvk_number ? 'error' : ''}
              value={form.kvk_number}
              onChange={(e) => handleKvkChange(e.target.value)}
            />
            {kvkLooking && (
              <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(37,99,235,0.2)', borderTopColor: '#2563EB' }} />
              </div>
            )}
          </div>
          {errors.kvk_number && <p className="form-error">{errors.kvk_number}</p>}
          {kvkNotFound && !errors.kvk_number && (
            <p style={{ fontSize: 12, color: '#D97706', marginTop: 4 }}>Bedrijf niet gevonden. Vul de gegevens handmatig in.</p>
          )}
          {kvkResult && (
            <button
              type="button"
              onClick={applyKvkResult}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
                padding: '10px 14px',
                background: '#EFF6FF',
                border: '1.5px solid #BFDBFE',
                borderRadius: 10,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                fontSize: 13,
                color: '#1C1917',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#DBEAFE')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#EFF6FF')}
            >
              <span style={{ fontSize: 16 }}>🏢</span>
              <span>
                <strong>{kvkResult.name}</strong><br />
                <span style={{ fontSize: 12, color: '#57534E' }}>
                  {[kvkResult.address, kvkResult.postal_code, kvkResult.city].filter(Boolean).join(', ')}
                </span>
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2563EB', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Overnemen →
              </span>
            </button>
          )}
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
