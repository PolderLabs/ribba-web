-- ============================================================================
-- get_chat_context: MERGE na ribbaPro 20260721150000_contact_reveal_by_leerling
--
-- Contact-reveal-semantiek (contact_shared / contact_shared_at) is van ribbaPro
-- en blijft leidend. Hun CREATE OR REPLACE was echter op een oudere kopie
-- gebaseerd en liet twee ribba-web-toevoegingen vallen:
--   1. `opleidingsvoorkeur` in inquiry_preview (web-chat 20260719000000)
--   2. de token-expiry-gate (chat_tokens_expire_at → found:false/expired),
--      review-fix: verlopen/gelekte links mogen niet eeuwig werken
-- Deze migratie zet beide terug BOVENOP hun contact_shared-versie.
--
-- ⚠️ Gedeelde functie: web + app. Wie 'm herdefinieert moet ALLE velden
-- behouden: contact_shared/contact_shared_at (ribbaPro) én opleidingsvoorkeur
-- + de expiry-gate (ribba-web). Idempotent (CREATE OR REPLACE).
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

  -- Token-expiry-gate (ribba-web): verlopen links werken niet meer voor nieuwe
  -- bezoekers; wie zijn kant al claimde behoudt toegang. coalesce → anonieme
  -- caller (auth.uid() NULL) levert false, niet NULL.
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
    'contact_shared', v_rec.contact_shared_at IS NOT NULL,
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
    'contact', CASE WHEN v_role = 'rijschool' AND v_rec.contact_shared_at IS NOT NULL
      THEN jsonb_build_object('name', v_inq.leerling_name, 'email', v_inq.leerling_email, 'phone', v_inq.leerling_phone)
      ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_context(uuid) TO anon, authenticated;
