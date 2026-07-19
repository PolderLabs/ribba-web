-- ============================================================================
-- Marketplace MVP schema (PolderLabs/ribba.app#36, onderdeel van Epic #35)
--
-- Tabellen + gedeelde RPC's voor de two-sided inquiry-flow: leerling stuurt
-- aanvraag vanaf de vergelijkingssite, Ribba routeert naar rijscholen, beide
-- partijen chatten geanonimiseerd via de web-chat gateway
-- (link.ribba.app/chat/{token}) én via de native apps. Eén bron van waarheid.
--
-- Verwerkt het ribbaPro schema-contract-review
-- (ribba.app#36#issuecomment-4933108256) en de PR-review op ribba-web#25:
--
-- C1. `marketplace_profiles` i.p.v. `user_profiles`: minimaal additief
--     register (rol-resolutie in de app: instructor > student > marketplace-
--     rol). Geen expo_push_token (bestaande `push_tokens`-tabel is de SSoT),
--     geen full_name/phone (staan al op inquiries/drivingschools). Alleen
--     de claim-RPC's schrijven hier.
-- C2. `rijschool_subscriptions` bestaat niet: plan/trial-state leeft op
--     `instructor_licenses`; freemium-teller `marketplace_contacts` volgt in
--     een ribbaPro-migratie.
-- C3. inquiry_recipients: + opened_at, decline_reason, expires_at, school_id
--     (uuid → drivingschools, gevuld ná KvK-claim/approval).
--     conversations: + school_id, last_message_preview (trigger onderhoudt
--     last_message_at + preview — gesprekkenlijst zonder N+1).
-- C4. messages: GÉÉN client-UPDATE. read_at wordt uitsluitend gezet via de
--     RPC `mark_messages_read` (NULL → now(), alleen counterpart-berichten) —
--     een afzender kan zijn eigen berichten dus niet "gelezen" maken en
--     read_at kan nooit teruggezet of geantidateerd worden.
-- C5. Claim-semantiek als SECURITY DEFINER RPC's, identiek voor web én app:
--     `claim_inquiry` / `claim_inquiry_recipient` (e-mail-match verplicht,
--     idempotent) + `get_chat_context` (token → geanonimiseerde context,
--     masking server-side) + `get_inquiry_for_recipient`.
-- C6. Realtime publication: messages + conversations + inquiry_recipients
--     (app-inboxen draaien op status-updates en tab-badges).
--
-- Eerdere bewuste afwijkingen van de issue-draft blijven staan:
-- D2. Conversation ontstaat bij de eerste claim van de rijschool (web-chat
--     vóór accept, #42); conversations.leerling_user_id nullable tot de
--     leerling claimt. Accept (ribbaPro#140) is een status-flip die
--     contact-reveal ontgrendelt (accept/decline-RPC's levert ribbaPro als
--     vervolg-migratie; claim zet zelf opened_at bij eerste opening).
-- D3. Chat-tokens als kolommen op inquiry_recipients (rijschool_chat_token /
--     leerling_chat_token); mails linken naar /chat/{token} — één URL-schema
--     voor browser én app (universal link). notified_email is een audit-
--     snapshot van het gemailde adres; de claim matcht tegen het actuele
--     cbr_rijscholen.email (besluit plan-review 2026-07-10).
-- D4. Notificatie-kolommen voor reply-mails (#44) op conversations
--     (…_last_notified_at) en inquiry_recipients (…_email_optout_at).
-- D5. Geen anonieme INSERT-policy op inquiries: alle writes via
--     /api/inquiry-submit (service role).
-- D6. Geen inquiry_recipients.conversation_id (circulair); canonieke link is
--     conversations.inquiry_recipient_id (UNIQUE).
--
-- Idempotent: veilig om meermaals te draaien.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- inquiries — één aanvraag per leerling per sessie (kan N recipients hebben)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leerling_user_id uuid REFERENCES auth.users(id), -- null tot leerling claimt via web-chat of app
  leerling_email text NOT NULL,
  leerling_phone text,
  leerling_name text NOT NULL,
  rijbewijs_categorie text NOT NULL CHECK (rijbewijs_categorie IN ('B', 'AM', 'A', 'BE', 'C', 'CE', 'D', 'DE', 'T')),
  schakeling text CHECK (schakeling IN ('handgeschakeld', 'automaat', 'beide')),
  -- Mag client-side gesynthetiseerd zijn (zsm/+1m/+3m → datum; "later" → null)
  gewenste_startdatum date,
  opleidingsvoorkeur text,
  bericht text,
  source_page text,
  marketing_optin boolean NOT NULL DEFAULT false,
  toestemming_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_leerling ON public.inquiries(leerling_user_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_leerling_email ON public.inquiries(lower(leerling_email), created_at);

-- ----------------------------------------------------------------------------
-- inquiry_recipients — één rij per (inquiry × rijschool)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inquiry_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  rijschool_id integer NOT NULL REFERENCES public.cbr_rijscholen(id),
  rijschool_user_id uuid REFERENCES auth.users(id), -- null tot rijschool claimt (web-chat of app)
  school_id uuid REFERENCES public.drivingschools(id), -- gevuld ná KvK-claim/approval (C3)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',        -- net binnen, nog geen outreach gelukt
    'app_notified',   -- rijschool kreeg mail/sms (app rendert als "Nieuw")
    'opened',         -- rijschool heeft de aanvraag geopend (claim of app)
    'accepted',       -- rijschool accepteerde → contact-reveal
    'declined',       -- rijschool wees af
    'expired'         -- geen reactie binnen de vervaltermijn
  )),
  opened_at timestamptz,                            -- "gezien op" (ribbaPro#140/#142)
  accepted_at timestamptz,
  declined_at timestamptz,
  decline_reason text,                              -- reden bij afwijzen (ribbaPro#140)
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  notification_email_sent_at timestamptz,
  notification_sms_sent_at timestamptz,
  notified_email text,                              -- audit-snapshot van gemaild rijschool-adres (D3)
  rijschool_chat_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  leerling_chat_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- Rolling expiry voor beide chat-tokens: de notificatie-cron verlengt bij
  -- elke verstuurde mail, zodat links in recente mails altijd werken maar een
  -- oud gelekt token vanzelf dooft. Geclaimde deelnemers behouden toegang
  -- (expiry gate zit in get_chat_context, niet in RLS).
  chat_tokens_expire_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  leerling_email_optout_at timestamptz,             -- opt-out reply-mails vóór claim (D4)
  rijschool_email_optout_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquiry_id, rijschool_id)
);

CREATE INDEX IF NOT EXISTS idx_inquiry_recipients_rijschool_status ON public.inquiry_recipients(rijschool_id, status);
CREATE INDEX IF NOT EXISTS idx_inquiry_recipients_inquiry_status ON public.inquiry_recipients(inquiry_id, status);
CREATE INDEX IF NOT EXISTS idx_inquiry_recipients_school ON public.inquiry_recipients(school_id) WHERE school_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- conversations — één conversatie per inquiry_recipient (aangemaakt bij claim, D2)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_recipient_id uuid NOT NULL UNIQUE REFERENCES public.inquiry_recipients(id) ON DELETE CASCADE,
  leerling_user_id uuid REFERENCES auth.users(id),  -- nullable tot leerling-claim (D2)
  rijschool_user_id uuid NOT NULL REFERENCES auth.users(id),
  rijschool_id integer NOT NULL REFERENCES public.cbr_rijscholen(id),
  school_id uuid REFERENCES public.drivingschools(id), -- gevuld ná KvK-claim/approval (C3)
  last_message_at timestamptz,
  last_message_preview text,                        -- gesprekkenlijst zonder N+1 (C3)
  leerling_last_notified_at timestamptz,            -- reply-mail throttling (D4)
  rijschool_last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_leerling ON public.conversations(leerling_user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_rijschool ON public.conversations(rijschool_user_id, last_message_at DESC);

-- ----------------------------------------------------------------------------
-- messages
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id),
  sender_role text NOT NULL CHECK (sender_role IN ('leerling', 'rijschool')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- marketplace_profiles — minimaal additief rol-register (C1)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  marketplace_role text NOT NULL CHECK (marketplace_role IN ('leerling', 'rijschool')),
  email_notifications boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Trigger: last_message_at + preview bijhouden (C3)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_touch_conversation()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = left(NEW.body, 140)
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON public.messages;
CREATE TRIGGER trg_messages_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_touch_conversation();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiry_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_profiles ENABLE ROW LEVEL SECURITY;

-- anon heeft niets te zoeken in deze tabellen; authenticated alleen wat de
-- policies toestaan. Alle overige mutaties: service role of RPC's.
REVOKE ALL ON public.inquiries, public.inquiry_recipients, public.conversations, public.messages, public.marketplace_profiles FROM anon;

-- inquiries: alleen de leerling zelf. Rijschool-clients SELECTeren inquiries
-- nooit direct (contactvelden!) — zij krijgen get_inquiry_for_recipient /
-- get_chat_context met server-side masking.
DROP POLICY IF EXISTS inquiries_select_own ON public.inquiries;
CREATE POLICY inquiries_select_own ON public.inquiries
  FOR SELECT TO authenticated
  USING (leerling_user_id = auth.uid());

-- inquiry_recipients: eigen rijschool-kant óf eigen leerling-inquiry.
-- Status-transities alleen via RPC's (claim hieronder; accept/decline levert
-- ribbaPro) — dus géén client-UPDATE policy.
DROP POLICY IF EXISTS inquiry_recipients_select_participant ON public.inquiry_recipients;
CREATE POLICY inquiry_recipients_select_participant ON public.inquiry_recipients
  FOR SELECT TO authenticated
  USING (
    rijschool_user_id = auth.uid()
    OR inquiry_id IN (SELECT id FROM public.inquiries WHERE leerling_user_id = auth.uid())
  );

-- conversations: alleen participants; mutaties via claim-RPC's en trigger.
DROP POLICY IF EXISTS conversations_select_participant ON public.conversations;
CREATE POLICY conversations_select_participant ON public.conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = leerling_user_id OR auth.uid() = rijschool_user_id);

-- messages: lezen als participant; schrijven alleen als jezelf op de kant die
-- je inneemt. GÉÉN client-UPDATE (C4) — read_at alleen via mark_messages_read.
DROP POLICY IF EXISTS messages_select_participant ON public.messages;
CREATE POLICY messages_select_participant ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (auth.uid() = c.leerling_user_id OR auth.uid() = c.rijschool_user_id)
    )
  );

DROP POLICY IF EXISTS messages_insert_own ON public.messages;
CREATE POLICY messages_insert_own ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (
          (sender_role = 'leerling' AND c.leerling_user_id = auth.uid())
          OR (sender_role = 'rijschool' AND c.rijschool_user_id = auth.uid())
        )
    )
  );

-- Opruimen van de eerdere read-receipt-policy + grant (C4).
DROP POLICY IF EXISTS messages_update_read_receipt ON public.messages;
REVOKE UPDATE ON public.messages FROM authenticated;

-- marketplace_profiles: alleen eigen rij lezen; alleen email_notifications
-- zelf aanpassen (marketplace_role wordt uitsluitend door claim-RPC's geschreven).
DROP POLICY IF EXISTS marketplace_profiles_select_own ON public.marketplace_profiles;
CREATE POLICY marketplace_profiles_select_own ON public.marketplace_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS marketplace_profiles_update_own ON public.marketplace_profiles;
CREATE POLICY marketplace_profiles_update_own ON public.marketplace_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE UPDATE ON public.marketplace_profiles FROM authenticated;
GRANT UPDATE (email_notifications) ON public.marketplace_profiles TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: get_chat_context — token → geanonimiseerde context (web + app, C5)
-- ----------------------------------------------------------------------------
-- Masking is server-side en identiek voor beide clients. Geeft nooit het
-- volledige verwachte e-mailadres terug; contactgegevens alleen na accept en
-- alleen aan de rijschool-kant.
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
  -- coalesce: bij een anonieme caller is auth.uid() NULL en zou de expressie
  -- NULL opleveren — NOT NULL is NULL, waardoor de expiry-check hieronder
  -- stilletjes overgeslagen zou worden.
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

-- ----------------------------------------------------------------------------
-- RPC: claim_inquiry — leerling koppelt zijn auth-account (C5)
-- ----------------------------------------------------------------------------
-- Idempotent. E-mail-match verplicht (anti-hijack): een geforwarde link is
-- waardeloos zonder toegang tot de mailbox. Backfillt álle conversaties van
-- deze inquiry (account-continuïteit web ↔ app).
CREATE OR REPLACE FUNCTION public.claim_inquiry(p_inquiry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_inq public.inquiries%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'niet ingelogd' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inq FROM public.inquiries WHERE id = p_inquiry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'aanvraag niet gevonden' USING ERRCODE = 'P0002';
  END IF;
  IF lower(v_inq.leerling_email) <> v_email THEN
    RAISE EXCEPTION 'e-mailadres komt niet overeen' USING ERRCODE = '28000';
  END IF;

  IF v_inq.leerling_user_id IS NULL THEN
    UPDATE public.inquiries SET leerling_user_id = v_uid WHERE id = p_inquiry_id;
  ELSIF v_inq.leerling_user_id <> v_uid THEN
    RAISE EXCEPTION 'aanvraag hoort bij een ander account' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.marketplace_profiles (user_id, marketplace_role)
  VALUES (v_uid, 'leerling')
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.conversations c
  SET leerling_user_id = v_uid
  FROM public.inquiry_recipients ir
  WHERE c.inquiry_recipient_id = ir.id
    AND ir.inquiry_id = p_inquiry_id
    AND c.leerling_user_id IS NULL;

  RETURN jsonb_build_object('inquiry_id', p_inquiry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_inquiry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_inquiry(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: claim_inquiry_recipient — rijschool koppelt zijn auth-account (C5)
-- ----------------------------------------------------------------------------
-- Idempotent. E-mail-match tegen het actuele cbr_rijscholen.email (besluit
-- plan-review 2026-07-10). Maakt de conversatie aan bij de eerste claim (D2)
-- en zet opened_at/status 'opened' (eerste opening ís de claim).
CREATE OR REPLACE FUNCTION public.claim_inquiry_recipient(p_recipient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_rec public.inquiry_recipients%ROWTYPE;
  v_school_email text;
  v_leerling_user_id uuid;
  v_conv_id uuid;
BEGIN
  IF v_uid IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'niet ingelogd' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_rec FROM public.inquiry_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'aanvraag niet gevonden' USING ERRCODE = 'P0002';
  END IF;

  SELECT nullif(lower(trim(email)), '') INTO v_school_email
  FROM public.cbr_rijscholen WHERE id = v_rec.rijschool_id;
  IF v_school_email IS NULL OR v_school_email <> v_email THEN
    RAISE EXCEPTION 'e-mailadres komt niet overeen' USING ERRCODE = '28000';
  END IF;

  IF v_rec.rijschool_user_id IS NULL THEN
    UPDATE public.inquiry_recipients
    SET rijschool_user_id = v_uid,
        opened_at = coalesce(opened_at, now()),
        status = CASE WHEN status IN ('pending', 'app_notified') THEN 'opened' ELSE status END
    WHERE id = p_recipient_id;
  ELSIF v_rec.rijschool_user_id <> v_uid THEN
    RAISE EXCEPTION 'aanvraag hoort bij een ander account' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.marketplace_profiles (user_id, marketplace_role)
  VALUES (v_uid, 'rijschool')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT leerling_user_id INTO v_leerling_user_id FROM public.inquiries WHERE id = v_rec.inquiry_id;

  INSERT INTO public.conversations (inquiry_recipient_id, rijschool_user_id, rijschool_id, leerling_user_id)
  VALUES (p_recipient_id, v_uid, v_rec.rijschool_id, v_leerling_user_id)
  ON CONFLICT (inquiry_recipient_id) DO NOTHING;

  SELECT id INTO v_conv_id FROM public.conversations WHERE inquiry_recipient_id = p_recipient_id;

  RETURN jsonb_build_object(
    'conversation_id', v_conv_id,
    'status', (SELECT status FROM public.inquiry_recipients WHERE id = p_recipient_id),
    'contact_revealed', v_rec.status = 'accepted'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_inquiry_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_inquiry_recipient(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: get_inquiry_for_recipient — inquiry-details met server-side masking (C5)
-- ----------------------------------------------------------------------------
-- Voor de geclaimde rijschool-kant (app-inbox ribbaPro#140). Contactvelden
-- zijn NULL tenzij status = 'accepted'.
CREATE OR REPLACE FUNCTION public.get_inquiry_for_recipient(p_recipient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec public.inquiry_recipients%ROWTYPE;
  v_inq public.inquiries%ROWTYPE;
  v_accepted boolean;
BEGIN
  SELECT * INTO v_rec FROM public.inquiry_recipients WHERE id = p_recipient_id;
  IF NOT FOUND OR v_rec.rijschool_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inq FROM public.inquiries WHERE id = v_rec.inquiry_id;
  v_accepted := v_rec.status = 'accepted';

  RETURN jsonb_build_object(
    'recipient_id', v_rec.id,
    'inquiry_id', v_inq.id,
    'status', v_rec.status,
    'opened_at', v_rec.opened_at,
    'expires_at', v_rec.expires_at,
    'voornaam', initcap(split_part(trim(v_inq.leerling_name), ' ', 1)),
    'leerling_name', CASE WHEN v_accepted THEN v_inq.leerling_name ELSE NULL END,
    'leerling_email', CASE WHEN v_accepted THEN v_inq.leerling_email ELSE NULL END,
    'leerling_phone', CASE WHEN v_accepted THEN v_inq.leerling_phone ELSE NULL END,
    'rijbewijs_categorie', v_inq.rijbewijs_categorie,
    'schakeling', v_inq.schakeling,
    'gewenste_startdatum', v_inq.gewenste_startdatum,
    'opleidingsvoorkeur', v_inq.opleidingsvoorkeur,
    'bericht', v_inq.bericht,
    'created_at', v_inq.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_inquiry_for_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inquiry_for_recipient(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: mark_messages_read — enige schrijfpad voor read_at (C4)
-- ----------------------------------------------------------------------------
-- Markeert alle ongelezen counterpart-berichten in één keer (NULL → now()).
CREATE OR REPLACE FUNCTION public.mark_messages_read(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'niet ingelogd' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (v_uid = c.leerling_user_id OR v_uid = c.rijschool_user_id)
  ) THEN
    RAISE EXCEPTION 'geen toegang' USING ERRCODE = '42501';
  END IF;

  UPDATE public.messages
  SET read_at = now()
  WHERE conversation_id = p_conversation_id
    AND sender_user_id <> v_uid
    AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_messages_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Realtime: messages + conversations + inquiry_recipients (C6)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inquiry_recipients'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inquiry_recipients;
  END IF;
END;
$$;
