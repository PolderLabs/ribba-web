// Niveau 0 — scholenoverzicht voor het supportportaal.
//
// Deze route bevat bewust geen autorisatielogica en geen filters: wie erbij
// mag bepaalt withSupportAccess, en wát niveau 0 is bepaalt de databasefunctie
// support_school_overview(). Deze route zet die twee alleen aan elkaar.

import { NextRequest } from 'next/server';
import { withSupportAccess } from '@/lib/support-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withSupportAccess(
    req,
    { action: 'schools.list', level: 0, targetType: 'schools' },
    async ({ supabase }) => {
      const { data, error } = await supabase.rpc('support_school_overview');
      if (error) throw new Error(error.message);
      return { schools: data ?? [] };
    },
  );
}
