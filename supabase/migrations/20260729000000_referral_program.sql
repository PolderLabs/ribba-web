-- ============================================================================
-- Referral-/affiliateprogramma per rijschool (ribba-web feat/referral-program)
--
-- Elke rijschool kan een eigen referral-programma draaien: partners (leerlingen,
-- vrienden, familie) melden zich aan op link.ribba.app/partner, krijgen een
-- persoonlijke code en delen link.ribba.app/{registration_slug}?ref=CODE.
-- Milestones (proefles / eerste betaalde les) worden door ribbaPro gemarkeerd
-- via de RPC's hieronder; de rijschool bevestigt payouts handmatig, waarna
-- ribba-web via Stripe incasseert (commissie + Ribba-fee, SEPA) en de partner
-- uitbetaalt (Stripe Connect Express, separate charges and transfers).
--
-- Ontwerpbesluiten:
-- R1. Alle bedragen in integer centen, currency 'eur'.
-- R2. reward_snapshot op referrals + ribba_fee_cents op payouts: config-
--     wijzigingen raken bestaande referrals/payouts nooit.
-- R3. Statusmachines worden in code afgedwongen met gefencede conditionele
--     updates; de CHECK-constraints hier begrenzen alleen de waardenruimte.
-- R4. Geen client-writes op welke tabel dan ook: mutaties via service role
--     (ribba-web API's) of de SECURITY DEFINER RPC's (ribbaPro).
-- R5. referred_email is bewust NIET leesbaar voor partners (column-grant);
--     de partner-dashboard toont alleen referred_first_name + status.
-- R6. stripe_webhook_events is een minimale dedupe-tabel (insert-claim).
--     Bewust géén hergebruik van billing_webhook_receipts: die is Mollie-
--     specifiek (verplichte school_id, stage-machine). De echte side-effect-
--     guard is de gefencede payout-statusmachine.
--
-- Idempotent: veilig om meermaals te draaien.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- referral_programs — één programma per rijschool
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drivingschool_id uuid NOT NULL UNIQUE REFERENCES public.drivingschools(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused')),
  stripe_customer_id text,
  stripe_payment_method_id text,
  sepa_mandate_status text NOT NULL DEFAULT 'none' CHECK (sepa_mandate_status IN ('none', 'pending', 'active', 'failed')),
  ribba_fee_cents integer NOT NULL DEFAULT 250 CHECK (ribba_fee_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- referral_program_rewards — één rij per milestone
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_program_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.referral_programs(id) ON DELETE CASCADE,
  milestone text NOT NULL CHECK (milestone IN ('proefles', 'eerste_betaalde_les')),
  reward_kind text NOT NULL CHECK (reward_kind IN ('cash', 'free_lesson')),
  amount_cents integer CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((reward_kind = 'cash') = (amount_cents IS NOT NULL)),
  UNIQUE (program_id, milestone)
);

-- ----------------------------------------------------------------------------
-- referral_partners — globale partneridentiteit (één per auth-user)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  stripe_account_id text UNIQUE,
  stripe_onboarding_status text NOT NULL DEFAULT 'none' CHECK (stripe_onboarding_status IN ('none', 'pending', 'complete', 'restricted')),
  payouts_enabled boolean NOT NULL DEFAULT false,
  kyc_nudge_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- referral_partner_memberships — partner × rijschool, draagt de code
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_partner_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  drivingschool_id uuid NOT NULL REFERENCES public.drivingschools(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, drivingschool_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_memberships_school ON public.referral_partner_memberships(drivingschool_id);

-- ----------------------------------------------------------------------------
-- referrals — geattribueerde inschrijving (snapshots blijven ook zonder student)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.referral_partner_memberships(id),
  partner_id uuid NOT NULL REFERENCES public.referral_partners(id),
  drivingschool_id uuid NOT NULL REFERENCES public.drivingschools(id),
  student_id uuid UNIQUE REFERENCES public.students(id) ON DELETE SET NULL,
  referred_first_name text NOT NULL,
  referred_email text NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'proefles', 'eerste_betaalde_les', 'void')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  proefles_at timestamptz,
  eerste_betaalde_les_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  reward_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_partner ON public.referrals(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_school ON public.referrals(drivingschool_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- referral_payouts — het grootboek
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id),
  membership_id uuid NOT NULL REFERENCES public.referral_partner_memberships(id),
  partner_id uuid NOT NULL REFERENCES public.referral_partners(id),
  drivingschool_id uuid NOT NULL REFERENCES public.drivingschools(id),
  milestone text NOT NULL CHECK (milestone IN ('proefles', 'eerste_betaalde_les')),
  reward_kind text NOT NULL CHECK (reward_kind IN ('cash', 'free_lesson')),
  amount_cents integer CHECK (amount_cents > 0),
  ribba_fee_cents integer NOT NULL CHECK (ribba_fee_cents >= 0),
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',    -- milestone gehaald, wacht op bevestiging rijschool
    'confirmed',  -- rijschool bevestigde → cron gaat incasseren
    'charging',   -- SEPA-incasso loopt (asynchroon, 2–14 werkdagen)
    'charged',    -- incasso geslaagd, transfer naar partner wordt aangemaakt
    'paid',       -- partner uitbetaald (of free_lesson vervuld)
    'failed',     -- incasso mislukt (retry via referral_retry_payout)
    'canceled'    -- afgewezen door rijschool of geannuleerd (void/ops)
  )),
  confirmed_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz,
  stripe_payment_intent_id text,
  stripe_transfer_id text,
  charged_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  attempt_count integer NOT NULL DEFAULT 0,
  -- Wanneer de partner de "milestone gehaald, wacht op bevestiging"-mail
  -- kreeg (gezet door de dagelijkse cron-sweep; RPC's blijven side-effect-vrij).
  milestone_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((reward_kind = 'cash') = (amount_cents IS NOT NULL)),
  UNIQUE (referral_id, milestone)
);

CREATE INDEX IF NOT EXISTS idx_referral_payouts_status ON public.referral_payouts(status);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_partner ON public.referral_payouts(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_school_status ON public.referral_payouts(drivingschool_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_pi ON public.referral_payouts(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- stripe_webhook_events — minimale dedupe voor /api/stripe-webhook (R6)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.referral_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_program_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_partner_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.referral_programs, public.referral_program_rewards,
  public.referral_partners, public.referral_partner_memberships,
  public.referrals, public.referral_payouts FROM anon;
-- Webhook-dedupe is uitsluitend service-role terrein.
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;

-- Programma + rewards: leesbaar voor schoolleden (owner-UI in ribbaPro leest
-- via RPC's, maar directe reads mogen ook). Publieke info gaat via
-- referral_program_public (masked, anon).
DROP POLICY IF EXISTS referral_programs_select_school ON public.referral_programs;
CREATE POLICY referral_programs_select_school ON public.referral_programs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.instructors i
      WHERE i.user_id = auth.uid() AND i.drivingschool_id = referral_programs.drivingschool_id
    )
  );

DROP POLICY IF EXISTS referral_program_rewards_select_school ON public.referral_program_rewards;
CREATE POLICY referral_program_rewards_select_school ON public.referral_program_rewards
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.referral_programs p
      JOIN public.instructors i ON i.drivingschool_id = p.drivingschool_id
      WHERE p.id = referral_program_rewards.program_id AND i.user_id = auth.uid()
    )
  );

-- Partner-kant: eigen rijen via user_id → partner_id-keten.
DROP POLICY IF EXISTS referral_partners_select_own ON public.referral_partners;
CREATE POLICY referral_partners_select_own ON public.referral_partners
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS referral_memberships_select_own ON public.referral_partner_memberships;
CREATE POLICY referral_memberships_select_own ON public.referral_partner_memberships
  FOR SELECT TO authenticated
  USING (
    partner_id IN (SELECT id FROM public.referral_partners WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS referrals_select_own_partner ON public.referrals;
CREATE POLICY referrals_select_own_partner ON public.referrals
  FOR SELECT TO authenticated
  USING (
    partner_id IN (SELECT id FROM public.referral_partners WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS referral_payouts_select_own_partner ON public.referral_payouts;
CREATE POLICY referral_payouts_select_own_partner ON public.referral_payouts
  FOR SELECT TO authenticated
  USING (
    partner_id IN (SELECT id FROM public.referral_partners WHERE user_id = auth.uid())
  );

-- R5: referred_email nooit partner-leesbaar — column-grant sluit hem uit.
REVOKE SELECT ON public.referrals FROM authenticated;
GRANT SELECT (
  id, membership_id, partner_id, drivingschool_id, status,
  referred_first_name, registered_at, proefles_at, eerste_betaalde_les_at,
  voided_at, created_at
) ON public.referrals TO authenticated;

-- ----------------------------------------------------------------------------
-- Helper: is caller owner/admin van deze school?
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_is_school_admin(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.instructors
    WHERE user_id = auth.uid()
      AND drivingschool_id = p_school_id
      AND school_role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.referral_is_school_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_is_school_admin(uuid) TO authenticated;

-- Helper: is caller instructeur (elke rol) van deze school?
CREATE OR REPLACE FUNCTION public.referral_is_school_member(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.instructors
    WHERE user_id = auth.uid()
      AND drivingschool_id = p_school_id
  );
$$;

REVOKE ALL ON FUNCTION public.referral_is_school_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_is_school_member(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: referral_program_upsert — programma + rewards instellen (owner-only)
-- ----------------------------------------------------------------------------
-- p_rewards: jsonb-array [{milestone, reward_kind, amount_cents}]. Vervangt
-- de bestaande reward-rijen integraal. 'active' kan alleen als de SEPA-
-- machtiging actief is óf alle rewards free_lesson zijn (anders kan een
-- bevestigde payout nooit geïncasseerd worden).
CREATE OR REPLACE FUNCTION public.referral_program_upsert(
  p_school_id uuid,
  p_status text,
  p_rewards jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program public.referral_programs%ROWTYPE;
  v_reward jsonb;
  v_has_cash boolean := false;
  v_milestone text;
  v_kind text;
  v_amount integer;
BEGIN
  IF NOT public.referral_is_school_admin(p_school_id) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'ongeldige status' USING ERRCODE = '22023';
  END IF;
  IF p_rewards IS NULL OR jsonb_typeof(p_rewards) <> 'array' THEN
    RAISE EXCEPTION 'rewards moet een array zijn' USING ERRCODE = '22023';
  END IF;

  -- Valideer rewards vóór enige write.
  FOR v_reward IN SELECT * FROM jsonb_array_elements(p_rewards) LOOP
    v_milestone := v_reward->>'milestone';
    v_kind := v_reward->>'reward_kind';
    v_amount := (v_reward->>'amount_cents')::integer;
    IF v_milestone IS NULL OR v_milestone NOT IN ('proefles', 'eerste_betaalde_les') THEN
      RAISE EXCEPTION 'ongeldige milestone: %', v_milestone USING ERRCODE = '22023';
    END IF;
    IF v_kind IS NULL OR v_kind NOT IN ('cash', 'free_lesson') THEN
      RAISE EXCEPTION 'ongeldige reward_kind: %', v_kind USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'cash' THEN
      IF v_amount IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION 'cash-reward vereist amount_cents > 0' USING ERRCODE = '22023';
      END IF;
      v_has_cash := true;
    ELSIF v_amount IS NOT NULL THEN
      RAISE EXCEPTION 'free_lesson-reward mag geen amount_cents hebben' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO public.referral_programs (drivingschool_id, status)
  VALUES (p_school_id, 'paused')
  ON CONFLICT (drivingschool_id) DO NOTHING;

  SELECT * INTO v_program FROM public.referral_programs
  WHERE drivingschool_id = p_school_id FOR UPDATE;

  IF p_status = 'active' AND v_has_cash AND v_program.sepa_mandate_status <> 'active' THEN
    RAISE EXCEPTION 'SEPA-machtiging vereist voor cash-rewards (rond eerst de betaalinstelling af)' USING ERRCODE = 'P0001';
  END IF;
  IF p_status = 'active' AND jsonb_array_length(p_rewards) = 0 THEN
    RAISE EXCEPTION 'actief programma vereist minstens één beloning' USING ERRCODE = '22023';
  END IF;

  UPDATE public.referral_programs
  SET status = p_status, updated_at = now()
  WHERE id = v_program.id;

  DELETE FROM public.referral_program_rewards WHERE program_id = v_program.id;
  INSERT INTO public.referral_program_rewards (program_id, milestone, reward_kind, amount_cents)
  SELECT v_program.id, r.value->>'milestone', r.value->>'reward_kind', (r.value->>'amount_cents')::integer
  FROM jsonb_array_elements(p_rewards) AS r(value);

  RETURN public.referral_program_get(p_school_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: referral_program_get — programma + rewards + mandaatstatus
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_program_get(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program public.referral_programs%ROWTYPE;
BEGIN
  IF NOT public.referral_is_school_member(p_school_id) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_program FROM public.referral_programs WHERE drivingschool_id = p_school_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'program_id', v_program.id,
    'status', v_program.status,
    'sepa_mandate_status', v_program.sepa_mandate_status,
    'ribba_fee_cents', v_program.ribba_fee_cents,
    'partner_count', (
      SELECT count(*) FROM public.referral_partner_memberships m
      WHERE m.drivingschool_id = p_school_id AND m.status = 'active'
    ),
    'rewards', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'milestone', r.milestone,
        'reward_kind', r.reward_kind,
        'amount_cents', r.amount_cents
      ) ORDER BY r.milestone)
      FROM public.referral_program_rewards r
      WHERE r.program_id = v_program.id
    ), '[]'::jsonb)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: referral_list_referrals — referrals voor de school-UI
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_list_referrals(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.referral_is_school_member(p_school_id) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'referral_id', r.id,
      'status', r.status,
      'student_id', r.student_id,
      'referred_first_name', r.referred_first_name,
      'referred_email', r.referred_email,
      'partner_name', coalesce(p.display_name, p.email),
      'partner_email', p.email,
      'registered_at', r.registered_at,
      'proefles_at', r.proefles_at,
      'eerste_betaalde_les_at', r.eerste_betaalde_les_at,
      'voided_at', r.voided_at,
      'void_reason', r.void_reason,
      'reward_snapshot', r.reward_snapshot
    ) ORDER BY r.created_at DESC)
    FROM public.referrals r
    JOIN public.referral_partners p ON p.id = r.partner_id
    WHERE r.drivingschool_id = p_school_id
  ), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: referral_list_payouts — payout-grootboek voor de school-UI
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_list_payouts(p_school_id uuid, p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.referral_is_school_member(p_school_id) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'payout_id', po.id,
      'referral_id', po.referral_id,
      'milestone', po.milestone,
      'reward_kind', po.reward_kind,
      'amount_cents', po.amount_cents,
      'ribba_fee_cents', po.ribba_fee_cents,
      'currency', po.currency,
      'status', po.status,
      'failure_reason', po.failure_reason,
      'partner_name', coalesce(p.display_name, p.email),
      'partner_email', p.email,
      'partner_payouts_enabled', p.payouts_enabled,
      'referred_first_name', r.referred_first_name,
      'confirmed_at', po.confirmed_at,
      'paid_at', po.paid_at,
      'created_at', po.created_at
    ) ORDER BY po.created_at DESC)
    FROM public.referral_payouts po
    JOIN public.referral_partners p ON p.id = po.partner_id
    JOIN public.referrals r ON r.id = po.referral_id
    WHERE po.drivingschool_id = p_school_id
      AND (p_status IS NULL OR po.status = p_status)
  ), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: referral_mark_milestone — ribbaPro markeert proefles / eerste betaalde les
-- ----------------------------------------------------------------------------
-- Idempotent en veilig aanroepbaar voor élke leerling: geen referral → no-op.
-- Bij vooruitgang: status + timestamp op de referral, en een payout-rij
-- ('pending') uit de reward_snapshot — ON CONFLICT (referral_id, milestone)
-- DO NOTHING is het idempotentie-anker. eerste_betaalde_les mag proefles
-- overslaan (alleen díe milestone-payout wordt dan aangemaakt).
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

  IF NOT public.referral_is_school_member(v_ref.drivingschool_id) THEN
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

-- ----------------------------------------------------------------------------
-- RPC: referral_confirm_payout — rijschool bevestigt (owner-only)
-- ----------------------------------------------------------------------------
-- Gefenced pending→confirmed. free_lesson gaat direct door naar paid
-- (fulfilment doet de school zelf in de planner; geen Stripe, geen fee).
CREATE OR REPLACE FUNCTION public.referral_confirm_payout(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.referral_payouts%ROWTYPE;
BEGIN
  SELECT * INTO v_payout FROM public.referral_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout niet gevonden' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.referral_is_school_admin(v_payout.drivingschool_id) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;
  IF v_payout.status <> 'pending' THEN
    RAISE EXCEPTION 'payout is niet meer te bevestigen (status: %)', v_payout.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.referral_payouts
  SET status = CASE WHEN reward_kind = 'free_lesson' THEN 'paid' ELSE 'confirmed' END,
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      paid_at = CASE WHEN reward_kind = 'free_lesson' THEN now() ELSE paid_at END
  WHERE id = p_payout_id AND status = 'pending';

  RETURN jsonb_build_object(
    'payout_id', p_payout_id,
    'status', (SELECT status FROM public.referral_payouts WHERE id = p_payout_id)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: referral_reject_payout — rijschool wijst af (owner-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_reject_payout(p_payout_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.referral_payouts%ROWTYPE;
BEGIN
  SELECT * INTO v_payout FROM public.referral_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout niet gevonden' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.referral_is_school_admin(v_payout.drivingschool_id) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;
  IF v_payout.status <> 'pending' THEN
    RAISE EXCEPTION 'payout is niet meer af te wijzen (status: %)', v_payout.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.referral_payouts
  SET status = 'canceled', failure_reason = left(coalesce(p_reason, 'afgewezen door rijschool'), 500)
  WHERE id = p_payout_id AND status = 'pending';

  RETURN jsonb_build_object('payout_id', p_payout_id, 'status', 'canceled');
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: referral_retry_payout — mislukte incasso opnieuw (owner-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_retry_payout(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.referral_payouts%ROWTYPE;
BEGIN
  SELECT * INTO v_payout FROM public.referral_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout niet gevonden' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.referral_is_school_admin(v_payout.drivingschool_id) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;
  IF v_payout.status <> 'failed' THEN
    RAISE EXCEPTION 'alleen mislukte payouts kunnen opnieuw (status: %)', v_payout.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.referral_payouts
  SET status = 'confirmed', failure_reason = NULL, failed_at = NULL
  WHERE id = p_payout_id AND status = 'failed';

  RETURN jsonb_build_object('payout_id', p_payout_id, 'status', 'confirmed');
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: referral_void_referral — referral ongeldig maken (owner-only)
-- ----------------------------------------------------------------------------
-- Annuleert de nog-onbevestigde ('pending') payouts; confirmed+ blijven staan
-- (de school heeft die al goedgekeurd — terugdraaien is een ops-actie).
CREATE OR REPLACE FUNCTION public.referral_void_referral(p_referral_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref public.referrals%ROWTYPE;
  v_canceled integer;
BEGIN
  SELECT * INTO v_ref FROM public.referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral niet gevonden' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.referral_is_school_admin(v_ref.drivingschool_id) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;
  IF v_ref.status = 'void' THEN
    RETURN jsonb_build_object('referral_id', p_referral_id, 'status', 'void');
  END IF;

  UPDATE public.referrals
  SET status = 'void', voided_at = now(), void_reason = left(coalesce(p_reason, ''), 500)
  WHERE id = p_referral_id;

  UPDATE public.referral_payouts
  SET status = 'canceled', failure_reason = 'referral void'
  WHERE referral_id = p_referral_id AND status = 'pending';
  GET DIAGNOSTICS v_canceled = ROW_COUNT;

  RETURN jsonb_build_object('referral_id', p_referral_id, 'status', 'void', 'canceled_payouts', v_canceled);
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: referral_program_public — publieke programma-info voor de enrollmentpagina
-- ----------------------------------------------------------------------------
-- Anon-grant: schoolnaam + status + beloningen, géén Stripe-/config-velden.
CREATE OR REPLACE FUNCTION public.referral_program_public(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school RECORD;
  v_program public.referral_programs%ROWTYPE;
BEGIN
  SELECT id, name, registration_slug INTO v_school
  FROM public.drivingschools
  WHERE registration_slug = p_slug AND registration_enabled = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_program FROM public.referral_programs
  WHERE drivingschool_id = v_school.id;
  IF NOT FOUND OR v_program.status <> 'active' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'school_name', v_school.name,
    'registration_slug', v_school.registration_slug,
    'rewards', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'milestone', r.milestone,
        'reward_kind', r.reward_kind,
        'amount_cents', r.amount_cents
      ) ORDER BY r.milestone)
      FROM public.referral_program_rewards r
      WHERE r.program_id = v_program.id
    ), '[]'::jsonb)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- Grants op de RPC's
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.referral_program_upsert(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_program_upsert(uuid, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_program_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_program_get(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_list_referrals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_list_referrals(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_list_payouts(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_list_payouts(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_mark_milestone(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_mark_milestone(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_confirm_payout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_confirm_payout(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_reject_payout(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_reject_payout(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_retry_payout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_retry_payout(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_void_referral(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_void_referral(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.referral_program_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_program_public(text) TO anon, authenticated;
