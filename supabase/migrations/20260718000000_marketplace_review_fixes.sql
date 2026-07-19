-- ============================================================================
-- Marketplace review-fixes (vervolg op 20260711000000_marketplace_mvp.sql)
--
-- Adresseert bevindingen uit de high-effort code-review op ribba-web#25:
--   #1  RLS lekt de bearer chat-tokens van de tegenpartij → column-level SELECT
--   #6  24u-dedupe TOCTOU-race → transactionele submit_inquiry-RPC (advisory lock)
--   #7  notificatie-cron starvation → list_notifiable_conversation_ids-RPC doet
--       de kolom-vergelijking server-side zodat de cap niet vol loopt met
--       al-genotificeerde conversaties
--   #8  messages konden ook na 'declined'/'expired' nog gepost worden → status-gate
--
-- Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- #1 — chat-tokens niet meer leesbaar voor de tegenpartij
-- ----------------------------------------------------------------------------
-- De SELECT-policy is rij-niveau; zonder column-grant kan een geclaimde
-- deelnemer rijschool_chat_token / leerling_chat_token / notified_email van de
-- tegenpartij lezen (bearer-tokens tegen get_chat_context/opt-out). Beperk
-- authenticated SELECT tot een token-vrije kolomlijst. Server-side code draait
-- met de service role en is niet geraakt; de RPC's zijn SECURITY DEFINER.
REVOKE SELECT ON public.inquiry_recipients FROM authenticated;
GRANT SELECT (
  id, inquiry_id, rijschool_id, rijschool_user_id, school_id, status,
  opened_at, accepted_at, declined_at, decline_reason, expires_at,
  notification_email_sent_at, notification_sms_sent_at,
  leerling_email_optout_at, rijschool_email_optout_at, created_at
) ON public.inquiry_recipients TO authenticated;

-- ----------------------------------------------------------------------------
-- #8 — geen berichten meer in een afgewezen/verlopen aanvraag
-- ----------------------------------------------------------------------------
-- Accept/decline (ribbaPro#140) is nog niet live, dus er zijn nu geen
-- declined/expired conversaties — veilig om de gate nu toe te voegen.
DROP POLICY IF EXISTS messages_insert_own ON public.messages;
CREATE POLICY messages_insert_own ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.inquiry_recipients ir ON ir.id = c.inquiry_recipient_id
      WHERE c.id = conversation_id
        AND ir.status NOT IN ('declined', 'expired')
        AND (
          (sender_role = 'leerling' AND c.leerling_user_id = auth.uid())
          OR (sender_role = 'rijschool' AND c.rijschool_user_id = auth.uid())
        )
    )
  );

-- ----------------------------------------------------------------------------
-- #6 — submit_inquiry: transactionele intake + dedupe (geen TOCTOU)
-- ----------------------------------------------------------------------------
-- Vervangt de read-then-insert + compenserende delete in /api/inquiry-submit.
-- pg_advisory_xact_lock serialiseert gelijktijdige submits van hetzelfde
-- e-mailadres, zodat de 24u-dedupe niet te omzeilen is met een dubbelklik.
-- Retour: { inquiry_id, recipients:[{id,rijschool_id,rijschool_chat_token}] }.
-- inquiry_id null + lege recipients = alles was een duplicaat (route → 409).
CREATE OR REPLACE FUNCTION public.submit_inquiry(
  p_leerling jsonb,
  p_rijschool_ids integer[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_leerling->>'leerling_email', '')));
  v_inquiry_id uuid;
  v_fresh integer[];
  v_recipients jsonb;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'leerling_email verplicht' USING ERRCODE = '22023';
  END IF;

  -- Serialiseer gelijktijdige submits van hetzelfde adres (transactie-scope lock).
  PERFORM pg_advisory_xact_lock(hashtext(v_email));

  -- Fresh = gevraagde scholen minus scholen die dit adres < 24u geleden al schreef.
  SELECT array_agg(x) INTO v_fresh
  FROM unnest(p_rijschool_ids) AS x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inquiry_recipients ir
    JOIN public.inquiries i ON i.id = ir.inquiry_id
    WHERE ir.rijschool_id = x
      AND lower(i.leerling_email) = v_email
      AND ir.created_at > now() - interval '24 hours'
  );

  IF v_fresh IS NULL OR array_length(v_fresh, 1) IS NULL THEN
    RETURN jsonb_build_object('inquiry_id', NULL, 'recipients', '[]'::jsonb);
  END IF;

  INSERT INTO public.inquiries (
    leerling_name, leerling_email, leerling_phone, rijbewijs_categorie,
    schakeling, gewenste_startdatum, opleidingsvoorkeur, bericht,
    source_page, marketing_optin
  ) VALUES (
    p_leerling->>'leerling_name',
    v_email,
    nullif(trim(coalesce(p_leerling->>'leerling_phone', '')), ''),
    p_leerling->>'rijbewijs_categorie',
    nullif(p_leerling->>'schakeling', ''),
    (nullif(p_leerling->>'gewenste_startdatum', ''))::date,
    nullif(p_leerling->>'opleidingsvoorkeur', ''),
    nullif(p_leerling->>'bericht', ''),
    nullif(p_leerling->>'source_page', ''),
    coalesce((p_leerling->>'marketing_optin')::boolean, false)
  )
  RETURNING id INTO v_inquiry_id;

  INSERT INTO public.inquiry_recipients (inquiry_id, rijschool_id)
  SELECT v_inquiry_id, x FROM unnest(v_fresh) AS x;

  SELECT jsonb_agg(jsonb_build_object(
           'id', id,
           'rijschool_id', rijschool_id,
           'rijschool_chat_token', rijschool_chat_token))
    INTO v_recipients
  FROM public.inquiry_recipients
  WHERE inquiry_id = v_inquiry_id;

  RETURN jsonb_build_object('inquiry_id', v_inquiry_id, 'recipients', v_recipients);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_inquiry(jsonb, integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_inquiry(jsonb, integer[]) TO service_role;

-- ----------------------------------------------------------------------------
-- #7 — cron-kandidaten: kolom-vergelijking server-side (geen starvation)
-- ----------------------------------------------------------------------------
-- PostgREST kan twee kolommen niet vergelijken, dus de cron haalde een brede
-- set op en cap'te op 200 — waarbij al-genotificeerde conversaties de cap
-- konden vullen en nieuwere verhongeren. Deze functie geeft alleen ids terug
-- van conversaties waar minstens één kant achterloopt.
CREATE OR REPLACE FUNCTION public.list_notifiable_conversation_ids(
  p_window_start timestamptz,
  p_settle_cutoff timestamptz,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (conversation_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.conversations c
  WHERE c.last_message_at IS NOT NULL
    AND c.last_message_at <= p_settle_cutoff
    AND c.last_message_at >= p_window_start
    AND (
      c.last_message_at > coalesce(c.leerling_last_notified_at, 'epoch'::timestamptz)
      OR c.last_message_at > coalesce(c.rijschool_last_notified_at, 'epoch'::timestamptz)
    )
  ORDER BY c.last_message_at ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.list_notifiable_conversation_ids(timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_notifiable_conversation_ids(timestamptz, timestamptz, integer) TO service_role;
