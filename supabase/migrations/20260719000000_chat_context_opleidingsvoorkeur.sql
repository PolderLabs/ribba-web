-- ============================================================================
-- get_chat_context: opleidingsvoorkeur ("Soort opleiding") toevoegen aan de
-- inquiry_preview. Het veld werd wél opgeslagen en aan de app-inbox
-- (get_inquiry_for_recipient) teruggegeven, maar ontbrak in de web-chat-kaart,
-- waardoor de rijschool "Lespakket" e.d. niet zag. Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_chat_context(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_rec public.inquiry_recipients%ROWTYPE;
  v_inq public.inquiries%ROWTYPE;
  v_school RECORD;
  v_conv RECORD;
  v_expected_email text;
  v_voornaam text;
  v_claimed_by_caller boolean;
BEGIN
  SELECT * INTO v_rec FROM public.inquiry_recipients WHERE rijschool_chat_token = p_token;
  IF FOUND THEN
    v_role := 'rijschool';
  ELSE
    SELECT * INTO v_rec FROM public.inquiry_recipients WHERE leerling_chat_token = p_token;
    IF FOUND THEN
      v_role := 'leerling';
    ELSE
      RETURN jsonb_build_object('found', false);
    END IF;
  END IF;

  SELECT * INTO v_inq FROM public.inquiries WHERE id = v_rec.inquiry_id;

  -- Token-expiry: verlopen links werken niet meer voor nieuwe bezoekers,
  -- maar wie zijn kant al claimde behoudt toegang (RLS dekt de data toch al).
  v_claimed_by_caller := coalesce(
    (v_role = 'rijschool' AND v_rec.rijschool_user_id IS NOT NULL AND v_rec.rijschool_user_id = auth.uid())
    OR (v_role = 'leerling' AND v_inq.leerling_user_id IS NOT NULL AND v_inq.leerling_user_id = auth.uid()),
    false);
  IF now() > v_rec.chat_tokens_expire_at AND NOT v_claimed_by_caller THEN
    RETURN jsonb_build_object('found', false, 'expired', true);
  END IF;

  SELECT id, name, email, city INTO v_school FROM public.cbr_rijscholen WHERE id = v_rec.rijschool_id;
  SELECT id, leerling_user_id INTO v_conv FROM public.conversations WHERE inquiry_recipient_id = v_rec.id;

  v_expected_email := CASE v_role
    WHEN 'rijschool' THEN coalesce(v_school.email, v_rec.notified_email)
    ELSE v_inq.leerling_email
  END;
  v_voornaam := initcap(split_part(trim(v_inq.leerling_name), ' ', 1));

  RETURN jsonb_build_object(
    'found', true,
    'role', v_role,
    'inquiry_id', v_inq.id,
    'recipient_id', v_rec.id,
    'conversation_id', v_conv.id,
    'status', v_rec.status,
    'claimed', CASE v_role WHEN 'rijschool' THEN v_rec.rijschool_user_id IS NOT NULL
                           ELSE v_inq.leerling_user_id IS NOT NULL END,
    'expected_email_masked', CASE WHEN v_expected_email IS NULL THEN NULL
      ELSE left(split_part(v_expected_email, '@', 1), 1) || '•••@' || split_part(v_expected_email, '@', 2) END,
    'counterpart_name', CASE v_role WHEN 'rijschool' THEN v_voornaam ELSE coalesce(v_school.name, 'Rijschool') END,
    'inquiry_preview', jsonb_build_object(
      'voornaam', v_voornaam,
      'rijbewijs_categorie', v_inq.rijbewijs_categorie,
      'schakeling', v_inq.schakeling,
      'gewenste_startdatum', v_inq.gewenste_startdatum,
      'opleidingsvoorkeur', v_inq.opleidingsvoorkeur,
      'bericht', v_inq.bericht,
      'created_at', v_inq.created_at
    ),
    'contact', CASE WHEN v_role = 'rijschool' AND v_rec.status = 'accepted'
      THEN jsonb_build_object('name', v_inq.leerling_name, 'email', v_inq.leerling_email, 'phone', v_inq.leerling_phone)
      ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_context(uuid) TO anon, authenticated;
