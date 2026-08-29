// Supportportaal — mag dit account überhaupt aan de tweefactor-flow beginnen?
//
// WAAROM DIT BESTAAT
//
// /support accepteert elk geldig Ribba-account bij het inloggen, want app en
// portaal delen één auth.users. Zonder deze controle kwam een gewone leerling of
// instructeur die hier belandde eerst een QR-code tegen en pas ná het afronden
// van de tweefactor-setup te horen dat hij geen supportmedewerker is. Op
// productie is dat één keer gebeurd (20 aug 2026, intern testaccount).
//
// Een achtergelaten factor is niet onschuldig: de resetpagina eist vanaf dat
// moment een TOTP-code bij "wachtwoord vergeten", en een geverifieerde factor
// verwijderen is een adminprocedure met de service-role-key. Dat botst met de
// productregel dat rijscholen nooit in een 2FA-afhankelijkheid worden getrokken.
//
// WAT DIT WEL EN NIET IS
//
// Dit is GEEN beveiligingsgrens. `mfa.enroll()` is een GoTrue-aanroep die de
// browser rechtstreeks doet met de anon-key; daar zit geen Ribba-code tussen.
// Wie met devtools zelf enrollt op zijn eigen account kunnen we hier niet
// tegenhouden. Harde afdwinging zou de MFA Verification Attempt-hook vereisen,
// en die is Teams/Enterprise-only terwijl wij op Pro zitten.
//
// Wat dit endpoint wél garandeert: Ribba léidt niemand meer de enrollment in die
// er niet hoort. Dat dekt elk onbedoeld pad, en dat was de volledige waargenomen
// impact. Lees dit dus niet als een poort tegen directe GoTrue-aanroepen.
//
// De échte grens ligt onveranderd in lib/support-auth.ts: aal2 + actieve
// platform_staff + verplichte logregel, vóór er ook maar één gegeven terugkomt.
// Dit endpoint geeft geen supportdata, op geen enkel niveau — alleen een
// boolean over je eigen account.

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/support-auth';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Altijd dezelfde vorm, zodat een statuscode niets extra's verraadt. */
function antwoord(eligible: boolean, status = 200) {
  return NextResponse.json({ eligible }, { status });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return antwoord(false, 401);
  const token = authHeader.slice('Bearer '.length);

  // Per IP, niet per account: het account is op dit punt nog niet vastgesteld.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (!rateLimit(`support-eligibility:${ip}`, { maxRequests: 20, windowMs: 60_000 })) {
    return antwoord(false, 429);
  }

  const supabase = getServiceClient();

  // Uitsluitend het token telt. Wat er in de query of body staat wordt nooit
  // gelezen — anders zou dit een oracle worden waarmee je willekeurige
  // user-id's op stafflidmaatschap kunt testen.
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return antwoord(false, 401);

  const { data: isStaff, error: staffError } = await supabase.rpc('is_platform_staff', {
    p_user_id: user.id,
  });

  // Fail closed: een kapotte lookup is geen "ja".
  if (staffError) return antwoord(false, 500);

  const eligible = isStaff === true;

  // Best-effort, en bewust alleen bij een weigering.
  //
  // Loggen blokkeert hier NIET, anders houdt een logstoring een legitieme
  // supportmedewerker zonder factor permanent uit zijn enrollment — en juist
  // dan is het herstelrunbook ook niet bruikbaar. Op het datavlak blijft
  // "geen logregel, geen data" onverkort gelden; daar wordt wél data
  // vrijgegeven en hier niet.
  //
  // Alleen weigeringen, want elke paginalading van een supportmedewerker in het
  // toegangslogboek schrijven maakt dat logboek juist minder bruikbaar als
  // verantwoording over inzage in klantgegevens.
  if (!eligible) {
    try {
      await supabase.from('platform_access_log').insert({
        staff_user_id: user.id,
        staff_email: user.email ?? null,
        action: 'support.eligibility',
        level: 0,
        result: 'denied',
        ip,
        user_agent: request.headers.get('user-agent'),
        meta: { denied_reason: 'not_platform_staff' },
      });
    } catch {
      // Bewust genegeerd. Zie de toelichting hierboven.
    }
  }

  return antwoord(eligible);
}
