-- ============================================================================
-- Marketplace MVP schema (PolderLabs/ribba.app#36, onderdeel van Epic #35)
--
-- Tabellen voor de two-sided inquiry-flow: leerling stuurt aanvraag vanaf de
-- vergelijkingssite, Ribba routeert naar rijscholen, beide partijen chatten
-- geanonimiseerd via de web-chat gateway (link.ribba.app/chat/{token}) én via
-- de native apps. Eén bron van waarheid, meerdere clients.
--
-- BEWUSTE AFWIJKINGEN t.o.v. de draft-SQL in issue #36:
--
-- D1. `rijschool_subscriptions` is WEGGELATEN. Billing-state leeft al in
--     `instructor_licenses` (Mollie, web-owned — zie docs/ARCHITECTUUR.md).
--     Een tweede subscription-tabel zou twee bronnen van billing-waarheid
--     creëren. Het freemium-model voor Chats beslist ribbaPro#141.
--
-- D2. Conversation vóór accept. Issue #36 maakte conversations pas bij
--     accept aan, maar #42 eist dat de rijschool direct na e-mailverificatie
--     in een (geanonimiseerde) chat zit. Daarom:
--       - conversations worden aangemaakt bij de eerste claim van de
--         rijschool (OTP-verificatie op /chat/{token}), niet bij accept;
--       - `conversations.leerling_user_id` is NULLABLE en wordt gevuld
--         zodra de leerling zijn kant claimt;
--       - accept (ribbaPro#140) is enkel een status-flip op
--         inquiry_recipients die contact-reveal ontgrendelt.
--
-- D3. Chat-tokens als kolommen op `inquiry_recipients`:
--     `rijschool_chat_token` en `leerling_chat_token` (opaque uuid's).
--     De outreach-/notificatiemails linken naar /chat/{token}; één route
--     dekt beide rollen. Resolutie gebeurt server-side met de service role,
--     tokens zijn nooit via anon RLS bereikbaar. `notified_email` is een
--     snapshot van het adres dat we daadwerkelijk gemaild hebben (cbr-data
--     kan wijzigen; de claim-check vergelijkt tegen wat we stuurden).
--
-- D4. Notificatie-kolommen voor reply-mails (#44) zitten er direct in:
--     `conversations.{leerling,rijschool}_last_notified_at` en
--     `inquiry_recipients.{leerling,rijschool}_email_optout_at`.
--
-- D5. GEEN anonieme INSERT-policy op `inquiries`. Alle writes lopen via
--     /api/inquiry-submit met de service role.
--
-- D6. `inquiry_recipients.conversation_id` is WEGGELATEN (circulaire FK in
--     de draft). De canonieke link is `conversations.inquiry_recipient_id`
--     (UNIQUE); join daarop.
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
  gewenste_startdatum date,
  opleidingsvoorkeur text,
  bericht text,
  source_page text,
  toestemming_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_leerling ON public.inquiries(leerling_user_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_leerling_email ON public.inquiries(lower(leerling_email));

-- ----------------------------------------------------------------------------
-- inquiry_recipients — één rij per (inquiry × rijschool)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inquiry_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  rijschool_id integer NOT NULL REFERENCES public.cbr_rijscholen(id),
  rijschool_user_id uuid REFERENCES auth.users(id), -- null tot rijschool claimt (web-chat of app)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',        -- net binnen, nog geen outreach gelukt
    'app_notified',   -- rijschool kreeg mail/sms
    'opened',         -- rijschool heeft de aanvraag geopend (web-chat claim of app)
    'accepted',       -- rijschool accepteerde → contact-reveal
    'declined',       -- rijschool wees af
    'expired'         -- geen reactie binnen de vervaltermijn
  )),
  accepted_at timestamptz,
  declined_at timestamptz,
  notification_email_sent_at timestamptz,
  notification_sms_sent_at timestamptz,
  notified_email text,                              -- snapshot van gemaild rijschool-adres (D3)
  rijschool_chat_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  leerling_chat_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  leerling_email_optout_at timestamptz,             -- opt-out reply-mails vóór claim (D4)
  rijschool_email_optout_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquiry_id, rijschool_id)
);

CREATE INDEX IF NOT EXISTS idx_inquiry_recipients_rijschool_status ON public.inquiry_recipients(rijschool_id, status);
CREATE INDEX IF NOT EXISTS idx_inquiry_recipients_inquiry_status ON public.inquiry_recipients(inquiry_id, status);

-- ----------------------------------------------------------------------------
-- conversations — één conversatie per inquiry_recipient (aangemaakt bij claim, D2)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_recipient_id uuid NOT NULL UNIQUE REFERENCES public.inquiry_recipients(id) ON DELETE CASCADE,
  leerling_user_id uuid REFERENCES auth.users(id),  -- nullable tot leerling-claim (D2)
  rijschool_user_id uuid NOT NULL REFERENCES auth.users(id),
  rijschool_id integer NOT NULL REFERENCES public.cbr_rijscholen(id),
  last_message_at timestamptz,
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
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- user_profiles — rol-onderscheid; auth.users bevat alleen credentials
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('leerling', 'rijschool', 'admin')),
  full_name text,
  phone text,
  rijschool_id integer REFERENCES public.cbr_rijscholen(id), -- alleen voor role='rijschool'
  expo_push_token text,
  email_notifications boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_rijschool ON public.user_profiles(rijschool_id) WHERE role = 'rijschool';

-- ----------------------------------------------------------------------------
-- Trigger: last_message_at bijhouden (SECURITY DEFINER, dus geen client
-- UPDATE-policy op conversations nodig)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_touch_conversation()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
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
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- anon heeft niets te zoeken in deze tabellen (alle anonieme flows lopen via
-- service-role API routes); authenticated alleen wat de policies toestaan.
REVOKE ALL ON public.inquiries, public.inquiry_recipients, public.conversations, public.messages, public.user_profiles FROM anon;

-- inquiries: alleen de leerling zelf. Rijscholen krijgen een geanonimiseerde
-- preview via /api/chat/resolve (service role) — contactvelden staan hier.
DROP POLICY IF EXISTS inquiries_select_own ON public.inquiries;
CREATE POLICY inquiries_select_own ON public.inquiries
  FOR SELECT TO authenticated
  USING (leerling_user_id = auth.uid());

-- inquiry_recipients: eigen rijschool-kant óf eigen leerling-inquiry.
DROP POLICY IF EXISTS inquiry_recipients_select_participant ON public.inquiry_recipients;
CREATE POLICY inquiry_recipients_select_participant ON public.inquiry_recipients
  FOR SELECT TO authenticated
  USING (
    rijschool_user_id = auth.uid()
    OR inquiry_id IN (SELECT id FROM public.inquiries WHERE leerling_user_id = auth.uid())
  );

-- conversations: alleen participants. Geen client-INSERT/UPDATE (claim-API en
-- trigger regelen mutaties).
DROP POLICY IF EXISTS conversations_select_participant ON public.conversations;
CREATE POLICY conversations_select_participant ON public.conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = leerling_user_id OR auth.uid() = rijschool_user_id);

-- messages: lezen als participant; schrijven alleen als jezelf, op de kant
-- die je in de conversatie inneemt; updaten (read receipts) alleen op
-- berichten van de ander — column-grant beperkt dat tot read_at.
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

DROP POLICY IF EXISTS messages_update_read_receipt ON public.messages;
CREATE POLICY messages_update_read_receipt ON public.messages
  FOR UPDATE TO authenticated
  USING (
    sender_user_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (auth.uid() = c.leerling_user_id OR auth.uid() = c.rijschool_user_id)
    )
  )
  WITH CHECK (
    sender_user_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (auth.uid() = c.leerling_user_id OR auth.uid() = c.rijschool_user_id)
    )
  );

-- Column-grant: authenticated mag via UPDATE alléén read_at aanraken.
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT UPDATE (read_at) ON public.messages TO authenticated;

-- user_profiles: alleen eigen rij (INSERT via service role in de claim-stap).
DROP POLICY IF EXISTS user_profiles_select_own ON public.user_profiles;
CREATE POLICY user_profiles_select_own ON public.user_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_profiles_update_own ON public.user_profiles;
CREATE POLICY user_profiles_update_own ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime: messages + conversations in de supabase_realtime publication
-- (idempotent; RLS geldt ook voor realtime — client moet realtime.setAuth()
-- aanroepen met een geldig access token)
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
END;
$$;
