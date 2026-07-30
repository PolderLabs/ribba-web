'use client';

import { useState, FormEvent } from 'react';
import { isValidPostalCode, normalizePostalCode } from '@/lib/validation';
import { isMinimumAge, isValidEmail, isValidInternationalPhone } from '@/utils/validation';
import { readRefCookie, readRefParam } from '@/components/ReferralCapture';

type Props = {
  schoolId: string;
  schoolName: string;
};

const LICENSE_TYPES = [
  { value: 'B', label: 'B – Auto' },
  { value: 'A', label: 'A – Motor' },
  { value: 'A1', label: 'A1 – Lichte motor' },
  { value: 'A2', label: 'A2 – Middelzware motor' },
  { value: 'AM', label: 'AM – Bromfiets / Scooter' },
];

type FormData = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  postal_code: string;
  city: string;
  license_type: string;
  date_of_birth: string;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

export default function RegistrationForm({ schoolId, schoolName }: Props) {
  const [form, setForm] = useState<FormData>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    postal_code: '',
    city: '',
    license_type: 'B',
    date_of_birth: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');

  function validate(): FormErrors {
    const e: FormErrors = {};

    if (!form.first_name.trim()) e.first_name = 'Voornaam is verplicht';
    if (!form.last_name.trim()) e.last_name = 'Achternaam is verplicht';

    if (!form.email.trim()) {
      e.email = 'E-mailadres is verplicht';
    } else if (!isValidEmail(form.email)) {
      e.email = 'Ongeldig e-mailadres';
    }

    if (!form.phone.trim()) {
      e.phone = 'Telefoonnummer is verplicht';
    } else if (!isValidInternationalPhone(form.phone)) {
      e.phone = 'Ongeldig telefoonnummer (bijv. 0612345678 of +49123456789)';
    }

    if (!form.address.trim()) e.address = 'Adres is verplicht';

    if (!form.postal_code.trim()) {
      e.postal_code = 'Postcode is verplicht';
    } else if (!isValidPostalCode(form.postal_code)) {
      e.postal_code = 'Ongeldige postcode (bijv. 1234AB)';
    }

    if (!form.city.trim()) e.city = 'Stad is verplicht';

    if (!form.license_type) e.license_type = 'Kies een rijbewijscategorie';

    if (!form.date_of_birth) {
      e.date_of_birth = 'Geboortedatum is verplicht';
    } else if (!isMinimumAge(form.date_of_birth, 16)) {
      e.date_of_birth = 'Je moet minimaal 16 jaar oud zijn';
    }

    // Geen consent-validatie hier — de juridische consent wordt door de Ribba app
    // afgedwongen bij de eerste login van de leerling (blokkerende modal met
    // per-school documenten). Zie docs/handoff in ribbaPro.

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
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          postal_code: normalizePostalCode(form.postal_code),
          drivingschool_id: schoolId,
          // Last-touch attributie: URL-param wint van de cookie (30 dagen).
          // Client-side gelezen — de pagina zelf blijft statisch/ISR.
          ref_code: readRefParam() ?? readRefCookie(),
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
          <strong>Inschrijving ontvangen!</strong>
          <br />
          Je ontvangt een bevestigingsmail op <strong>{form.email}</strong>.
          {schoolName} neemt binnenkort contact met je op.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="form-grid">
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
            placeholder="jan@voorbeeld.nl"
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
            placeholder="0612345678 of +49 151 23456789"
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
            placeholder="Amsterdam"
            className={errors.city ? 'error' : ''}
            value={form.city}
            onChange={(e) => handleChange('city', e.target.value)}
          />
          {errors.city && <p className="form-error">{errors.city}</p>}
        </div>

        {/* Rijbewijscategorie */}
        <div className="form-group">
          <label htmlFor="license_type">Rijbewijscategorie</label>
          <select
            id="license_type"
            className={errors.license_type ? 'error' : ''}
            value={form.license_type}
            onChange={(e) => handleChange('license_type', e.target.value)}
          >
            {LICENSE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {errors.license_type && <p className="form-error">{errors.license_type}</p>}
        </div>

        {/* Geboortedatum */}
        <div className="form-group">
          <label htmlFor="date_of_birth">Geboortedatum</label>
          <input
            id="date_of_birth"
            type="date"
            className={errors.date_of_birth ? 'error' : ''}
            value={form.date_of_birth}
            onChange={(e) => handleChange('date_of_birth', e.target.value)}
          />
          {errors.date_of_birth && <p className="form-error">{errors.date_of_birth}</p>}
        </div>
      </div>

      {/*
        Geen juridische checkboxes hier — de leerling-consent wordt door de
        Ribba app afgedwongen bij de eerste login (blokkerende modal met
        per-school documenten). Zie docs/handoff in ribbaPro.
      */}

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
              Bezig met inschrijven...
            </>
          ) : (
            'Inschrijven'
          )}
        </button>
      </div>
    </form>
  );
}
