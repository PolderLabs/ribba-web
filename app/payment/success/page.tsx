'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

function PaymentContent() {
  const searchParams = useSearchParams();
  const invoice = searchParams.get('invoice');

  useEffect(() => {
    if (invoice) {
      window.location.href = `ribba://payment?invoice=${encodeURIComponent(invoice)}`;
    }
  }, [invoice]);

  const appDeepLink = invoice
    ? `ribba://payment?invoice=${encodeURIComponent(invoice)}`
    : 'ribba://payment';

  return (
    <main className="page-wrapper">
      <div className="card">
        <div className="logo">
          <div className="logo-icon">R</div>
          Ribba
        </div>

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

        <p className="pill pill-green">Betaling geslaagd</p>

        <h1>Betaling ontvangen</h1>
        <p className="subtitle">
          Je betaling is verwerkt. Ga terug naar de Ribba app om de bevestiging te zien.
        </p>

        <a href={appDeepLink} className="btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          Open Ribba app
        </a>

        <div className="divider" />

        <p className="footer-text">
          App niet geïnstalleerd?{' '}
          <a href="https://apps.apple.com/app/ribba/id6744055023">Download hier</a>
        </p>
      </div>
    </main>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="page-wrapper">
          <div className="card">
            <div className="logo">
              <div className="logo-icon">R</div>
              Ribba
            </div>
            <p className="subtitle">Laden...</p>
          </div>
        </main>
      }
    >
      <PaymentContent />
    </Suspense>
  );
}
