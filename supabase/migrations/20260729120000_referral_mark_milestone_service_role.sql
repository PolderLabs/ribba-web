-- ============================================================================
-- referral_mark_milestone: service-role callers toestaan (ribbaPro hand-off)
--
-- ribbaPro markeert milestones niet alleen vanuit de app (instructeur,
-- authenticated), maar ook vanuit webhook-/cron-paden die onder service role
-- draaien. De oorspronkelijke functie (20260729000000) faalde daar dubbel:
--   1. GRANT EXECUTE was alleen aan authenticated;
--   2. de lidmaatschapscheck loopt via auth.uid(), en die is NULL onder
--      service role → 'geen toegang'.
--
-- Fix: EXECUTE-grant voor service_role + bypass van de lidmaatschapscheck
-- voor vertrouwde callers. LET OP de SECURITY DEFINER-valkuil: current_user
-- is binnen de functie altijd de owner, dus die is onbruikbaar als check.
-- We testen daarom:
--   - auth.role() = 'service_role'  → PostgREST-calls met de service-key
--     (ribbaPro edge functions / servers);
--   - session_user = 'postgres'     → directe SQL-paden (pg_cron, dashboard);
--     session_user blijft de verbindende rol, óók onder SECURITY DEFINER
--     (PostgREST verbindt als 'authenticator', dus reguliere clients kunnen
--     hier nooit doorheen).
-- Gewone authenticated callers blijven op de bestaande
-- referral_is_school_member-check lopen.
--
-- Idempotent: veilig om meermaals te draaien.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.referral_mark_milestone(p_student_id uuid, p_milestone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref public.referrals%ROWTYPE;
  v_rank_current integer;
  v_rank_new integer;
  v_reward jsonb;
  v_payout_id uuid;
  v_fee integer;
BEGIN
  IF p_milestone IS NULL OR p_milestone NOT IN ('proefles', 'eerste_betaalde_les') THEN
    RAISE EXCEPTION 'ongeldige milestone' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ref FROM public.referrals WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('referral', NULL);
  END IF;

  -- Vertrouwde geautomatiseerde callers (service role / directe SQL) mogen
  -- altijd; menselijke callers moeten lid zijn van de school van de referral.
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR session_user = 'postgres'
    OR public.referral_is_school_member(v_ref.drivingschool_id)
  ) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;

  IF v_ref.status = 'void' THEN
    RETURN jsonb_build_object('referral', NULL, 'voided', true);
  END IF;

  v_rank_current := CASE v_ref.status
    WHEN 'registered' THEN 0 WHEN 'proefles' THEN 1 ELSE 2 END;
  v_rank_new := CASE p_milestone WHEN 'proefles' THEN 1 ELSE 2 END;

  IF v_rank_new > v_rank_current THEN
    UPDATE public.referrals
    SET status = p_milestone,
        proefles_at = CASE WHEN p_milestone = 'proefles' THEN coalesce(proefles_at, now()) ELSE proefles_at END,
        eerste_betaalde_les_at = CASE WHEN p_milestone = 'eerste_betaalde_les' THEN coalesce(eerste_betaalde_les_at, now()) ELSE eerste_betaalde_les_at END
    WHERE id = v_ref.id;
  END IF;

  -- Payout uit de snapshot (R2); geen reward voor deze milestone → geen payout.
  SELECT elem.value INTO v_reward
  FROM jsonb_array_elements(v_ref.reward_snapshot) AS elem(value)
  WHERE elem.value->>'milestone' = p_milestone
  LIMIT 1;

  IF v_reward IS NULL THEN
    RETURN jsonb_build_object('referral_id', v_ref.id, 'payout_id', NULL);
  END IF;

  SELECT ribba_fee_cents INTO v_fee FROM public.referral_programs
  WHERE drivingschool_id = v_ref.drivingschool_id;

  INSERT INTO public.referral_payouts (
    referral_id, membership_id, partner_id, drivingschool_id,
    milestone, reward_kind, amount_cents, ribba_fee_cents
  )
  VALUES (
    v_ref.id, v_ref.membership_id, v_ref.partner_id, v_ref.drivingschool_id,
    p_milestone, v_reward->>'reward_kind',
    (v_reward->>'amount_cents')::integer,
    coalesce(v_fee, 250)
  )
  ON CONFLICT (referral_id, milestone) DO NOTHING;

  SELECT id INTO v_payout_id FROM public.referral_payouts
  WHERE referral_id = v_ref.id AND milestone = p_milestone;

  RETURN jsonb_build_object('referral_id', v_ref.id, 'payout_id', v_payout_id);
END;
$$;

REVOKE ALL ON FUNCTION public.referral_mark_milestone(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_mark_milestone(uuid, text) TO authenticated, service_role;
