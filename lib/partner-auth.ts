// Bearer-token-authenticatie voor de partner-portal-API's (/api/partner/*).
// Zelfde patroon als /api/me: token uit de Authorization-header, server-side
// geverifieerd via de service-role client.

import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function getAuthedUser(
  req: NextRequest,
): Promise<{ user: User; supabase: SupabaseClient } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const supabase = getServiceClient();
  const { data: { user }, error } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (error || !user) return null;
  return { user, supabase };
}

// School waarvoor deze user owner/admin is (optioneel beperkt tot een
// specifieke school). null = geen school waarvoor de user dit mag.
export async function getAdminSchoolId(
  supabase: SupabaseClient,
  userId: string,
  requestedSchoolId?: string | null,
): Promise<string | null> {
  let query = supabase
    .from('instructors')
    .select('drivingschool_id')
    .eq('user_id', userId)
    .in('school_role', ['owner', 'admin']);
  if (requestedSchoolId) {
    query = query.eq('drivingschool_id', requestedSchoolId);
  }
  const { data } = await query;
  return data?.[0]?.drivingschool_id ?? null;
}
