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
