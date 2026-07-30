-- ============================================================================
-- Referral-programma: bestaande billing-machtiging adopteren (consent-audit)
--
-- Alle scholen betalen hun Ribba-abonnement via Stripe; wie via SEPA-incasso
-- betaalt heeft dus al een actief sepa_debit-mandaat. In plaats van een tweede
-- mandaat-flow mag de eigenaar met één expliciete bevestiging de bestaande
-- machtiging óók voor referral-uitbetalingen gebruiken
-- (POST /api/referral/school/adopt-mandate).
--
-- De bevestigingsklik is bewust behouden (ander doel + variabele bedragen);
-- deze kolommen leggen vast wíé wanneer instemde — dat voorkomt
-- incasso-verrassingen en geeft een antwoord bij storneringen. Bij de
-- reguliere nieuwe-mandaat-flow (SetupIntent) blijven ze NULL: daar is de
-- Stripe-mandaatbevestiging zelf het consent-moment.
--
-- Idempotent: veilig om meermaals te draaien.
-- ============================================================================

ALTER TABLE public.referral_programs
  ADD COLUMN IF NOT EXISTS sepa_mandate_adopted_at timestamptz,
  ADD COLUMN IF NOT EXISTS sepa_mandate_adopted_by uuid REFERENCES auth.users(id);
