# Referral-programma per rijschool

Elke rijschool kan een eigen referral-programma draaien: partners (leerlingen,
vrienden, familie) melden zich aan op `link.ribba.app/partner/join/{slug}`,
krijgen een persoonlijke code en delen `link.ribba.app/{slug}?ref=CODE`.
Schrijft iemand zich via die link in en haalt hij milestones (proefles gehad /
eerste betaalde les), dan verdient de partner de beloning die de rijschool
instelde (cash in centen of een gratis les). De rijschool bevestigt elke
uitbetaling handmatig in de Ribba-app; daarna incasseert Ribba automatisch
(commissie + vaste Ribba-fee, default €2,50) via SEPA en betaalt de partner
uit via Stripe Connect. KYC ligt volledig bij Stripe.

## Repo-verdeling

| Onderdeel | Repo |
|---|---|
| Partner-portal, attributie, Stripe-uitvoering, migratie/RPC-contract, partner-mails | **ribba-web** (deze repo) |
| Rijschoolhouder-UI: programma configureren, referrals bekijken, milestones markeren, payouts bevestigen | **ribbaPro** (via de RPC's hieronder) |
| Vergelijkingssite | geen wijzigingen |

## Datamodel (migratie `20260729000000_referral_program.sql`)

- `referral_programs` — 1 per rijschool: status (`active`/`paused`), Stripe
  Customer + SEPA-mandaat, `ribba_fee_cents`.
- `referral_program_rewards` — 1 rij per milestone (`proefles`,
  `eerste_betaalde_les`) met `reward_kind` (`cash`/`free_lesson`).
- `referral_partners` — globale partneridentiteit (auth-user, e-mail, Stripe
  Express-account, `payouts_enabled`).
- `referral_partner_memberships` — partner × rijschool, draagt de unieke `code`.
- `referrals` — geattribueerde inschrijving met `reward_snapshot` (bevroren bij
  attributie) en status `registered → proefles → eerste_betaalde_les` (of `void`).
- `referral_payouts` — het grootboek: `pending → confirmed → charging →
  charged → paid` (of `failed`/`canceled`); `free_lesson` gaat bij bevestiging
  direct naar `paid`. Alle bedragen in integer centen.
- `stripe_webhook_events` — dedupe-tabel voor `/api/stripe-webhook`.

Statustransities in code zijn altijd **gefencede conditionele updates**
(`UPDATE … WHERE status = <verwacht> RETURNING`): 0 rijen = een andere run
bezit de payout. Stripe-calls dragen idempotency-keys per payout, dus ook
herverwerking na een crash kan nooit dubbel incasseren of dubbel uitbetalen.

## Geldstroom (separate charges and transfers)

1. ribbaPro roept `referral_confirm_payout` aan → payout `confirmed`.
2. `/api/cron/referral-payouts` (dagelijks 06:00) incasseert per payout
   `amount_cents + ribba_fee_cents` via een off-session SEPA PaymentIntent op
   het mandaat van de school → payout `charging`. **Er wordt nooit geïncasseerd
   als de partner zijn Stripe-onboarding niet heeft afgerond** — we innen geen
   geld dat we niet kunnen doorbetalen.
3. SEPA settelt asynchroon (2–14 werkdagen). `payment_intent.succeeded` →
   payout `charged` → Transfer van `amount_cents` naar het Express-account van
   de partner (met `source_transaction`) → `paid`. De fee blijft als marge op
   het platform achter.
4. `payment_intent.payment_failed` → `failed` + mail naar de school; herstel
   via `referral_retry_payout` (of één automatische retry door de cron).
5. Disputes/refunds → ops-alert naar team@ribba.app; transfer-reversal is in
   v1 een handmatige actie in het Stripe-dashboard.

## Env-variabelen

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (endpoint `/api/stripe-webhook`;
events: `setup_intent.succeeded`, `setup_intent.setup_failed`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`,
`charge.dispute.created`, `charge.refunded` — account.updated ook voor
connected accounts), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Bestaand:
`CRON_SECRET`, `RESEND_API_KEY`, Supabase-vars.

## Bekende risico's (geaccepteerd)

- SEPA-settlement van dagen tussen bevestiging en uitbetaling — de mails
  zetten die verwachting expliciet.
- Ribba is merchant of record op de incasso: een dispute ná de transfer is
  platformverlies tot een handmatige reversal.
- Partnerinkomsten kunnen DAC7-/IB-rapportageplichten raken — juridisch
  beoordelen, buiten scope van de code.
- `free_lesson`-rewards lopen buiten Stripe om en leveren geen Ribba-fee op.

---

## Hand-off: ribbaPro

> We hebben in ribba-web een referral-programma per rijschool gebouwd (branch
> `feat/referral-program`). De gedeelde Supabase-migratie
> `supabase/migrations/20260729000000_referral_program.sql` definieert de
> tabellen (`referral_programs`, `referral_program_rewards`, `referral_partners`,
> `referral_partner_memberships`, `referrals`, `referral_payouts`) en SECURITY
> DEFINER RPC's. Jullie bouwen de rijschoolhouder-kant, uitsluitend via deze
> RPC's (geen directe table-writes):
>
> 1. **Instellingen-scherm**: programma aan/uit + beloningen per milestone
>    (`proefles`, `eerste_betaalde_les`; cash-bedrag in centen of `free_lesson`)
>    via `referral_program_upsert(school_id, status, rewards)` /
>    `referral_program_get(school_id)`. Activeren met cash-rewards kan pas als
>    de SEPA-machtiging actief is (`sepa_mandate_status = 'active'`; de RPC
>    weigert anders) — toon een deep-link naar
>    `https://mijn.ribba.app/mijn-ribba/referral/betaling` waar de eigenaar de
>    machtiging afrondt. Toon ook de partner-wervings-URL:
>    `https://link.ribba.app/partner/join/{registration_slug}`.
> 2. **Referrals-lijst**: `referral_list_referrals(school_id)` — status per
>    referral, partnernaam/-e-mail, leerlingvoornaam. Onterechte referrals
>    voiden via `referral_void_referral(referral_id, reason)` (annuleert
>    automatisch de nog-onbevestigde payouts).
> 3. **Milestones markeren**: roep `referral_mark_milestone(student_id,
>    milestone)` aan op de plekken waar jullie "proefles gehad" en "eerste
>    factuur betaald" al weten. Idempotent en een no-op voor niet-gerefereerde
>    leerlingen — veilig om voor élke leerling aan te roepen. Maakt automatisch
>    de payout-rij (`pending`) aan uit de reward-snapshot van de referral.
> 4. **Payouts-scherm**: `referral_list_payouts(school_id, status?)` — pending
>    payouts met bedrag + Ribba-fee; bevestigen via
>    `referral_confirm_payout(payout_id)` (daarna incasseert ribba-web
>    automatisch commissie + fee via SEPA en betaalt de partner uit; settlement
>    2–14 werkdagen), afwijzen via `referral_reject_payout(payout_id, reason)`,
>    mislukte incasso's opnieuw via `referral_retry_payout(payout_id)`. Toon
>    `failure_reason` bij status `failed`.
> 5. **Free-lesson-fulfilment**: bij bevestigen van een `free_lesson`-payout
>    gaat die direct naar `paid` — jullie kennen zelf de gratis les toe in de
>    planner.
>
> Auth: mutatie-RPC's eisen `instructors.school_role IN ('owner','admin')`,
> lees-RPC's school-lidmaatschap, beide op `auth.uid()`.

## Hand-off: ribba.app (vergelijkingssite)

> Geen wijzigingen nodig: referral-attributie loopt volledig via de
> inschrijfpagina's op link.ribba.app (`/{slug}?ref=CODE`), niet via de
> marketplace-aanvraag. Optioneel/later: willen we ooit marketplace-inquiries
> attribueren, dan moet de aanvraag-POST een `ref_code` uit een cookie
> meesturen — nu buiten scope.
