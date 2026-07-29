'use client';

import { useEffect } from 'react';

const CODE_PATTERN = /^[A-Za-z0-9]{4,16}$/;

export const REF_COOKIE = 'ribba_ref';
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export function readRefCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${REF_COOKIE}=`));
  const value = match ? decodeURIComponent(match.slice(REF_COOKIE.length + 1)) : null;
  return value && CODE_PATTERN.test(value) ? value : null;
}

// Zet de referral-cookie op basis van ?ref=CODE. Last-touch: de meest recente
// link wint (altijd overschrijven). Rendert niets.
export default function ReferralCapture({ code }: { code?: string }) {
  useEffect(() => {
    if (!code || !CODE_PATTERN.test(code)) return;
    document.cookie = `${REF_COOKIE}=${encodeURIComponent(code.toUpperCase())}; path=/; max-age=${THIRTY_DAYS_SECONDS}; SameSite=Lax`;
  }, [code]);
  return null;
}
