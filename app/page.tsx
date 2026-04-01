'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RibbaLogo from './components/RibbaLogo';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to /reset if Supabase auth params are in the hash (password reset flow)
    const hash = window.location.hash;
    if (hash && (hash.includes('access_token') || hash.includes('error='))) {
      router.replace('/reset' + hash);
    }
  }, [router]);

  return (
    <main className="page-wrapper">
      <div className="card">
        <div className="logo">
          <RibbaLogo height={36} />
        </div>
        <p className="pill">Rijschool software</p>
        <h1>Coming soon</h1>
        <p className="subtitle">
          We werken aan een volledig nieuwe Ribba website. Gebruik het menu voor
          wachtwoordresets en toekomstige portals.
        </p>
        <div className="divider" />
        <p className="footer-text">
          Vragen?{' '}
          <a href="mailto:hallo@ribba.app">hallo@ribba.app</a>
        </p>
      </div>
    </main>
  );
}
