-- ============================================================================
-- drivingschools.signup_attribution — herkomst van de rijschool-registratie
--
-- Beantwoordt "kwam deze signup via een advertentie-LP?": first-touch
-- utm-parameters, referrer en landingspad, client-side gecaptured
-- (lib/signup-attribution.ts) en server-side gewhitelist opgeslagen door
-- /api/register-school. Nullable en puur additief — de iOS-app (ribbaPro)
-- hoeft er niets mee. Shape: { utm_source, utm_medium, utm_campaign,
-- utm_term, utm_content, referrer, landing_page, captured_at }.
--
-- Idempotent: veilig om meermaals te draaien.
-- ============================================================================

ALTER TABLE public.drivingschools
  ADD COLUMN IF NOT EXISTS signup_attribution jsonb;
