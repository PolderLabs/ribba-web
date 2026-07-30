'use client';

import { useEffect } from 'react';

// De inschrijfpagina (/[slug]) is statisch/ISR — de ?ref-parameter wordt
// daarom volledig client-side gelezen (await searchParams in de server
// component zou de pagina dynamisch dwingen en gooit DYNAMIC_SERVER_USAGE
// tijdens ISR-rendering).

const CODE_PATTERN = /^[A-Za-z0-9]{4,16}$/;

export const REF_COOKIE = 'ribba_ref';
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export function readRefParam(): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('ref');
  return value && CODE_PATTERN.test(value) ? value.toUpperCase() : null;
}

export function readRefCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${REF_COOKIE}=`));
  const value = match ? decodeURIComponent(match.slice(REF_COOKIE.length + 1)) : null;
  return value && CODE_PATTERN.test(value) ? value : null;
}

// Zet de referral-cookie op basis van ?ref=CODE in de URL. Last-touch: de
// meest recente link wint (altijd overschrijven). Rendert niets.
export default function ReferralCapture() {
  useEffect(() => {
    const code = readRefParam();
    if (!code) return;
    document.cookie = `${REF_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=${THIRTY_DAYS_SECONDS}; SameSite=Lax`;
  }, []);
  return null;
}
