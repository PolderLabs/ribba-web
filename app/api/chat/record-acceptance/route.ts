// Legt de privacy-acceptatie vast op het moment van web-acceptatie: de
// bezoeker verifieert zijn e-mail (OTP) en betreedt de web-chat. De
// privacyverklaring dekt deze marketplace-chatflow (incl. IP + user-agent),
// dus registreren we hier een append-only legal_acceptances-rij mét IP +
// user-agent (audit — webacceptatie).
//
// Fire-and-forget vanuit de client: legal-logging mag de chat-entry nooit
// blokkeren. IP/user-agent zijn hier (Next API route) betrouwbaar beschikbaar,
// anders dan in de SECURITY DEFINER claim-RPC's.

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/marketplace-db';
import { recordLegalAcceptances, extractIpAddress, extractUserAgent } from '@/lib/legal-acceptances';
import { LEGAL_VERSIONS } from '@/lib/legal-versions';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const jwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }

  try {
    const supabase = getServiceClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    const user = userData?.user;
    if (userError || !user) {
      return NextResponse.json({ error: 'Sessie ongeldig.' }, { status: 401 });
    }

    await recordLegalAcceptances(supabase, [
      {
        user_id: user.id,
        school_id: null,
        document_type: 'privacy',
        document_version: LEGAL_VERSIONS.privacy,
        ip_address: extractIpAddress(request),
        user_agent: extractUserAgent(request),
      },
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    // Nooit gooien richting de client — dit is non-blocking legal-logging.
    console.error('chat/record-acceptance error:', error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
