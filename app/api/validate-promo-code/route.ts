import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { extractIpAddress } from '@/lib/legal-acceptances';

/**
 * Controleert een promocode voor het inschrijfformulier — puur voor de
 * directe groen/rood-terugkoppeling in de UI.
 *
 * Deze route BINDT NIETS. De echte inwisseling gebeurt transactioneel in
 * create_school_with_owner, samen met de schoolcreatie. Tussen deze check en
 * die transactie kan een gelimiteerde code uitgeput raken; dan wint de
 * transactie. Dat is correct: de code is dan echt op.
 *
 * De onderliggende RPC geeft bewust geen reden terug — onbekend, inactief,
 * verlopen en uitgeput zien er identiek uit. Anders is dit endpoint een
 * orakel waarmee je codes kunt aftasten.
 */
export async function POST(request: NextRequest) {
  const ip = extractIpAddress(request) ?? 'unknown';
  if (!rateLimit(`validate-promo-code:${ip}`, { maxRequests: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel pogingen. Probeer het zo opnieuw.' }, { status: 429 });
  }

  let code: unknown;
  try {
    ({ code } = await request.json());
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  if (typeof code !== 'string' || code.trim() === '') {
    return NextResponse.json({ valid: false });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase.rpc('validate_promo_code', {
    p_code: code.trim().toUpperCase(),
  });

  if (error) {
    console.error('validate_promo_code error:', error);
    // Fail-closed naar de UI: geen groen vinkje op een mislukte controle. De
    // registratie zelf controleert opnieuw, dus een terecht geldige code komt
    // er alsnog doorheen.
    return NextResponse.json({ valid: false }, { status: 500 });
  }

  const result = data as { valid?: boolean; trial_ends_at?: string } | null;

  return NextResponse.json({
    valid: result?.valid === true,
    trial_ends_at: result?.trial_ends_at ?? null,
  });
}
