// Niveau 0 — scholenoverzicht voor het supportportaal.
//
// Deze route bevat bewust geen autorisatielogica en geen filters: wie erbij
// mag bepaalt withSupportAccess, en wát niveau 0 is bepaalt de databasefunctie
// support_school_overview(). Deze route zet die twee alleen aan elkaar.
//
// ?intern=1 toont ook onze eigen test- en pilotomgevingen. Standaard staan die
// eruit, zodat het overzicht over klanten gaat. De keuze gaat mee het logboek
// in — anders is achteraf niet te zien wat er op het scherm stond.

import { NextRequest } from 'next/server';
import { withSupportAccess } from '@/lib/support-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const intern = new URL(req.url).searchParams.get('intern') === '1';

  return withSupportAccess(
    req,
    { action: 'schools.list', level: 0, targetType: 'schools', meta: { intern } },
    async ({ supabase }) => {
      const { data, error } = await supabase.rpc('support_school_overview', {
        p_include_internal: intern,
      });
      if (error) throw new Error(error.message);
      return { schools: data ?? [] };
    },
  );
}
