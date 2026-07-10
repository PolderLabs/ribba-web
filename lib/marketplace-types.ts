// Handgeschreven row-types voor de marketplace-tabellen
// (supabase/migrations/20260711000000_marketplace_mvp.sql).
// Het gedeelde Supabase-project is niet CLI-gelinkt vanuit deze repo, dus
// geen `supabase gen types` — houd dit bestand in sync met de migratie.

export type RijbewijsCategorie = 'B' | 'AM' | 'A' | 'BE' | 'C' | 'CE' | 'D' | 'DE' | 'T';

export type Schakeling = 'handgeschakeld' | 'automaat' | 'beide';

export type InquiryRecipientStatus =
  | 'pending'
  | 'app_notified'
  | 'opened'
  | 'accepted'
  | 'declined'
  | 'expired';

export type ChatRole = 'leerling' | 'rijschool';

export interface InquiryRow {
  id: string;
  leerling_user_id: string | null;
  leerling_email: string;
  leerling_phone: string | null;
  leerling_name: string;
  rijbewijs_categorie: RijbewijsCategorie;
  schakeling: Schakeling | null;
  gewenste_startdatum: string | null; // ISO date; mag client-side gesynthetiseerd zijn (zsm/+1m/+3m → datum, "later" → null)
  opleidingsvoorkeur: string | null;
  bericht: string | null;
  source_page: string | null;
  marketing_optin: boolean;
  toestemming_at: string;
  created_at: string;
}

export interface InquiryRecipientRow {
  id: string;
  inquiry_id: string;
  rijschool_id: number;
  rijschool_user_id: string | null;
  school_id: string | null; // uuid → drivingschools, gevuld ná KvK-claim/approval
  status: InquiryRecipientStatus;
  opened_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  expires_at: string;
  notification_email_sent_at: string | null;
  notification_sms_sent_at: string | null;
  notified_email: string | null;
  rijschool_chat_token: string;
  leerling_chat_token: string;
  leerling_email_optout_at: string | null;
  rijschool_email_optout_at: string | null;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  inquiry_recipient_id: string;
  leerling_user_id: string | null; // null tot de leerling zijn kant claimt
  rijschool_user_id: string;
  rijschool_id: number;
  school_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  leerling_last_notified_at: string | null;
  rijschool_last_notified_at: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_role: ChatRole;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface MarketplaceProfileRow {
  user_id: string;
  marketplace_role: ChatRole;
  email_notifications: boolean;
  created_at: string;
}

// Retour-shape van de gedeelde RPC get_chat_context(p_token) — identiek
// contract voor de web-chat gateway en de ribbaPro-app.
export interface ChatContext {
  found: boolean;
  role: ChatRole;
  inquiry_id: string;
  recipient_id: string;
  conversation_id: string | null;
  status: InquiryRecipientStatus;
  claimed: boolean;
  expected_email_masked: string | null;
  counterpart_name: string;
  inquiry_preview: {
    voornaam: string;
    rijbewijs_categorie: RijbewijsCategorie;
    schakeling: Schakeling | null;
    gewenste_startdatum: string | null;
    bericht: string | null;
    created_at: string;
  };
  contact: { name: string; email: string; phone: string | null } | null;
}
