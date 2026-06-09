'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Preserve Supabase auth-reset flow: if tokens/errors are in the hash,
    // route to /reset before redirecting away.
    const hash = window.location.hash;
    if (hash && (hash.includes('access_token') || hash.includes('error='))) {
      router.replace('/reset' + hash);
      return;
    }
    window.location.replace('https://ribba.app');
  }, [router]);

  return null;
}
