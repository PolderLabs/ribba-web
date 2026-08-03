// Het doorlaatpunt van het supportportaal.
//
// Elke supportroute gaat hier doorheen, en nergens anders langs. Dat is met
// opzet één functie: zolang er precies één plek is waar supportdata vandaan
// komt, is "is dit gelogd?" een vraag die je één keer beantwoordt in plaats
// van bij elke nieuwe pagina opnieuw.
//
// De regel die het portaal draagt:
//
//     Geen logregel, geen data.
//
// Niet "we loggen erbij", maar "de logregel is de voorwaarde". Faalt het
// schrijven naar platform_access_log, dan krijgt de aanvrager niets — ook niet
// als hij overduidelijk bevoegd is. Een supportportaal waarvan het spoor stuk
// kan zijn zonder dat iemand het merkt, is precies wat de verwerkersovereenkomst
// (art. 7.3) belooft dat het niet is.
//
// Drie horden, in deze volgorde, allemaal fail-closed:
//   1. Geldige sessie (bearer-token, server-side geverifieerd)
//   2. Tweefactor daadwerkelijk gebruikt in DEZE sessie (aal2)
//   3. Actieve rij in platform_staff
//
// Horde 2 verdient toelichting: Supabase zet in het token een `aal`-claim die
// zegt of de gebruiker in deze sessie ook echt zijn tweede factor heeft
// gebruikt. Alleen kijken óf iemand 2FA heeft ingesteld is niet genoeg — dan
// zou een gestolen wachtwoord nog steeds volstaan.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export type SupportLevel = 0 | 1 | 2;

export interface AccessSpec {
  /** Korte, stabiele naam van de handeling, bv. 'schools.list'. */
  action: string;
  /** 0 = geen persoonsgegevens van leerlingen, 1 = gepseudonimiseerd, 2 = identificeerbaar. */
  level: SupportLevel;
  targetType?: string;
  targetSchoolId?: string;
  targetStudentId?: string;
  /** Verplicht vanaf niveau 1 — daar wordt hij afgedwongen. */
  reason?: string;
  meta?: Record<string, unknown>;
}

export interface SupportSession {
  user: User;
  supabase: SupabaseClient;
}

export function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Leest de `aal`-claim uit een token dat al server-side is geverifieerd.
 *
 * Bewust geen eigen handtekeningcontrole: dit wordt uitsluitend aangeroepen
 * nádat supabase.auth.getUser(token) het token heeft gevalideerd. Het enige
 * wat hier gebeurt is de payload uitlezen van een token waarvan de echtheid
 * al vaststaat.
 */
export function readAal(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { aal?: unknown };
    return typeof decoded.aal === 'string' ? decoded.aal : null;
  } catch {
    return null;
  }
}

/** Eerste IP uit x-forwarded-for; Vercel zet daar de echte client-IP voorop. */
function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}

interface LogInput extends AccessSpec {
  staffUserId: string;
  staffEmail: string | null;
  result: 'ok' | 'denied' | 'error';
}

/**
 * Schrijft één regel in het logboek. Gooit als dat niet lukt — de aanroeper
 * moet dan afbreken, niet doorgaan.
 */
async function writeLog(
  supabase: SupabaseClient,
  req: NextRequest,
  input: LogInput,
): Promise<void> {
  const { error } = await supabase.from('platform_access_log').insert({
    staff_user_id: input.staffUserId,
    staff_email: input.staffEmail,
    action: input.action,
    level: input.level,
    result: input.result,
    target_type: input.targetType ?? null,
    target_school_id: input.targetSchoolId ?? null,
    target_student_id: input.targetStudentId ?? null,
    reason: input.reason ?? null,
    ip: clientIp(req),
    user_agent: req.headers.get('user-agent'),
    meta: input.meta ?? null,
  });
  if (error) throw new Error(`platform_access_log: ${error.message}`);
}

/**
 * Voert `handler` uit als — en alleen als — de aanvrager door alle drie de
 * horden komt én de handeling is vastgelegd.
 *
 * Volgorde is bewust: eerst loggen, dan de data ophalen. Wie kijkt is dan ook
 * vastgelegd als de query daarna klapt. Faalt de query, dan komt er een tweede
 * regel bij met result 'error'; `result` beschrijft dus de toegangsbeslissing
 * en niet de afloop van de query.
 */
export async function withSupportAccess<T>(
  req: NextRequest,
  spec: AccessSpec,
  handler: (session: SupportSession) => Promise<T>,
): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    // Niets te loggen: zonder geldig token is er geen persoon om aan toe te
    // schrijven, en een logboek dat volloopt met anonieme ruis is onbruikbaar.
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const token = authHeader.slice('Bearer '.length);

  const supabase = getServiceClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Ongeldige sessie.' }, { status: 401 });
  }

  const email = user.email ?? null;
  const deny = async (reason: string, status: number) => {
    // Een geweigerde poging van een bekende gebruiker is juist wél
    // interessant, dus die gaat het logboek in.
    try {
      await writeLog(supabase, req, {
        ...spec,
        staffUserId: user.id,
        staffEmail: email,
        result: 'denied',
        meta: { ...(spec.meta ?? {}), denied_reason: reason },
      });
    } catch {
      // Logboek stuk én toegang geweigerd: de weigering staat hoe dan ook.
    }
    return NextResponse.json({ error: 'Geen toegang.' }, { status });
  };

  if (readAal(token) !== 'aal2') {
    return deny('mfa_required', 403);
  }

  const { data: isStaff, error: staffError } = await supabase.rpc('is_platform_staff', {
    p_user_id: user.id,
  });
  if (staffError) {
    return deny(`staff_lookup_failed: ${staffError.message}`, 500);
  }
  if (isStaff !== true) {
    return deny('not_platform_staff', 403);
  }

  // Vanaf niveau 1 raken we persoonsgegevens van leerlingen. Dan is "waarom"
  // geen formaliteit maar de verantwoording zelf.
  if (spec.level >= 1 && !spec.reason?.trim()) {
    return deny('reason_required', 400);
  }

  try {
    await writeLog(supabase, req, {
      ...spec,
      staffUserId: user.id,
      staffEmail: email,
      result: 'ok',
    });
  } catch (e) {
    // Geen logregel, geen data.
    console.error('[support] logboek niet beschikbaar — toegang geweigerd', e);
    return NextResponse.json(
      { error: 'Toegang tijdelijk niet mogelijk: het logboek is niet beschikbaar.' },
      { status: 503 },
    );
  }

  try {
    const data = await handler({ user, supabase });
    return NextResponse.json(data);
  } catch (e) {
    try {
      await writeLog(supabase, req, {
        ...spec,
        staffUserId: user.id,
        staffEmail: email,
        result: 'error',
        meta: { ...(spec.meta ?? {}), message: e instanceof Error ? e.message : String(e) },
      });
    } catch {
      // De 'ok'-regel staat er al; deze aanvulling is een extraatje.
    }
    console.error(`[support] ${spec.action} faalde`, e);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
