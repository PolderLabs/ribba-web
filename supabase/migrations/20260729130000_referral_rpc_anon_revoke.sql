-- ============================================================================
-- Referral-RPC's: anon expliciet intrekken (defense-in-depth)
--
-- Supabase's ALTER DEFAULT PRIVILEGES grant functies in public aan anon,
-- authenticated én service_role. Het `REVOKE ... FROM PUBLIC`-patroon in
-- 20260729000000 raakt die expliciete anon-grant dus niet: anon kon elke
-- referral-RPC aanroepen. Er lekte niets wezenlijks — alle mutatie-RPC's
-- checken lidmaatschap op auth.uid() (NULL voor anon → 'geen toegang') — maar
-- de bedoeling was dat anon deze functies helemaal niet kan uitvoeren.
--
-- referral_program_public blijft bewust anon-aanroepbaar: die voedt de
-- publieke enrollmentpagina (/partner/join/[slug]) en geeft alleen
-- schoolnaam + beloningen terug.
--
-- Idempotent: veilig om meermaals te draaien.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.referral_is_school_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_is_school_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_program_upsert(uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_program_get(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_list_referrals(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_list_payouts(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_mark_milestone(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_confirm_payout(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_reject_payout(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_retry_payout(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.referral_void_referral(uuid, text) FROM anon;
