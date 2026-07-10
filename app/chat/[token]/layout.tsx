import type { Metadata } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://link.ribba.app';
// App Store ID van de Ribba app (zelfde app als lib/app-links.ts).
const APPLE_APP_ID = process.env.NEXT_PUBLIC_APPLE_APP_ID || '6757161459';

// Smart app banners (issue ribba.app#43) — bewust alleen in deze layout zodat
// planner- en vergelijker-pagina's ze niet tonen:
// - iOS Safari: apple-itunes-app meta met app-argument deep-link naar deze chat
// - Android Chrome: install banner via het chat-specifieke web manifest
export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params;
  return {
    title: 'Chat — Ribba',
    description: 'Beveiligde, geanonimiseerde chat tussen leerling en rijschool via Ribba.',
    robots: { index: false, follow: false },
    itunes: {
      appId: APPLE_APP_ID,
      appArgument: `${BASE_URL}/chat/${token}`,
    },
    manifest: '/chat-manifest.webmanifest',
  };
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
