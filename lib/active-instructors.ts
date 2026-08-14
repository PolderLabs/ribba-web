/**
 * De teller waarop het abonnementsbedrag meeschaalt: het aantal ACTIEVE
 * instructeurs van een rijschool.
 *
 * Dit stond driemaal los in de codebase (checkout, school-usage, upgrade-
 * spiegel). Sinds Premium per instructeur boven de 5 bijrekent bepaalt deze
 * telling wat er geïncasseerd wordt, dus hij hoort op één plek te staan.
 *
 * Fail-closed: een mislukte of onbepaalde telling gooit. Stil doorgaan met
 * 0 zou het abonnement terugzetten naar de kale planprijs en de school
 * structureel te weinig in rekening brengen.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export class InstructorCountError extends Error {
  constructor(schoolId: string, detail: string) {
    super(`Kon actieve instructeurs niet tellen voor school ${schoolId}: ${detail}`);
    this.name = 'InstructorCountError';
  }
}

export async function countActiveInstructors(
  supabase: SupabaseClient,
  schoolId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('instructors')
    .select('id', { count: 'exact', head: true })
    .eq('drivingschool_id', schoolId)
    .eq('status', 'active');

  if (error) {
    throw new InstructorCountError(schoolId, error.message);
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new InstructorCountError(schoolId, `onbruikbare telling: ${String(count)}`);
  }
  return count;
}
