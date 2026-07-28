import type { Metadata } from 'next';
import { getServiceClient } from '@/lib/marketplace-db';
import { DOMAIN } from '@/lib/domains';

const BASE_URL = DOMAIN.chat;
// App Store ID van de Ribba app (zelfde app als lib/app-links.ts).
const APPLE_APP_ID = process.env.NEXT_PUBLIC_APPLE_APP_ID || '6757161459';

// De app registreert universal links op /i/{inquiry_id} (leerling) en
// /r/{recipient_id} (rijschool), NIET op /chat/{token}. Voor de iOS smart
// banner resolven we het token daarom server-side naar de juiste id-link,
// zodat "Open in de app" in het juiste gesprek landt i.p.v. het startscherm.
async function resolveAppArgument(token: string): Promise<string | undefined> {
  try {
    const { data } = await getServiceClient().rpc('get_chat_context', { p_token: token });
    if (!data?.found) return undefined;
    return data.role === 'rijschool'
      ? `${BASE_URL}/r/${data.recipient_id}`
      : `${BASE_URL}/i/${data.inquiry_id}`;
  } catch {
    return undefined;
  }
}

// Smart app banners (issue ribba.app#43) — bewust alleen in deze layout zodat
// planner- en vergelijker-pagina's ze niet tonen:
// - iOS Safari: apple-itunes-app meta met app-argument deep-link naar het gesprek
// - Android Chrome: install banner via het chat-specifieke web manifest
export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params;
  const appArgument = await resolveAppArgument(token);
  return {
    title: 'Chat — Ribba',
    description: 'Beveiligde, geanonimiseerde chat tussen leerling en rijschool via Ribba.',
    robots: { index: false, follow: false },
    itunes: {
      appId: APPLE_APP_ID,
      ...(appArgument ? { appArgument } : {}),
    },
    manifest: '/chat-manifest.webmanifest',
  };
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
