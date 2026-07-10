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

export type UserProfileRole = 'leerling' | 'rijschool' | 'admin';

export interface InquiryRow {
  id: string;
  leerling_user_id: string | null;
  leerling_email: string;
  leerling_phone: string | null;
  leerling_name: string;
  rijbewijs_categorie: RijbewijsCategorie;
  schakeling: Schakeling | null;
  gewenste_startdatum: string | null; // ISO date
  opleidingsvoorkeur: string | null;
  bericht: string | null;
  source_page: string | null;
  toestemming_at: string;
  created_at: string;
}

export interface InquiryRecipientRow {
  id: string;
  inquiry_id: string;
  rijschool_id: number;
  rijschool_user_id: string | null;
  status: InquiryRecipientStatus;
  accepted_at: string | null;
  declined_at: string | null;
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
  last_message_at: string | null;
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

export interface UserProfileRow {
  user_id: string;
  role: UserProfileRole;
  full_name: string | null;
  phone: string | null;
  rijschool_id: number | null;
  expo_push_token: string | null;
  email_notifications: boolean;
  created_at: string;
}
