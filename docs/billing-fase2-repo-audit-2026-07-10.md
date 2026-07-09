# Billing Fase 2 — Repo-audit ribba-web

**Datum:** 2026-07-10
**Scope:** onderzoeksrapport op basis van de billing-architectuur die in ribbaPro is vastgelegd. Geen code-wijziging; alleen documentatie van de huidige staat en de precieze locatie van de openstaande bugs B1 en B2.
**Aanleiding:** vaststellen wat in Fase 2 in ribba-web hoort te veranderen en wat in ribbaPro / Supabase-migraties.

---

## Ownership-verdeling (contract)

| Onderdeel | Eigenaar |
|---|---|
| Checkout / iDEAL first-payment | **ribba-web** |
| Mollie subscription lifecycle (create, cancel, recurring) | **ribba-web** |
| Mollie webhook (`/api/mollie-webhook`) | **ribba-web** |
| Subscription-cancel endpoint (`/api/cancel-subscription`) | **ribba-web** |
| Reconciliation cron (`/api/cron/reconcile-subscriptions`) | **ribba-web** |
| Trial-reminder cron (`/api/cron/trial-reminder`) | **ribba-web** |
| Billing-mails (klant + platform) | **ribba-web** |
| `billing_events` tabel-migratie (append-only audit) | **ribbaPro / Supabase** |
| `check-trial-expiry` edge function (sentinel `billing_plan='expired'`) | **ribbaPro / Supabase** |
| App-runtime read-modellen (PlanContext e.d.) | **ribbaPro** |
| Interface = database (`instructor_licenses`) | Contract, geen eigenaar |

Contract-kernpunt (ongewijzigd): `instructor_licenses.status` blijft altijd `'active'`. Billing-mutaties gaan uitsluitend via `billing_plan`, `cancelled_at`, `period_end`, `external_subscription_id`, `mollie_customer_id`, `failed_payment_count`, `last_failed_payment_at`.

---

## 1. Volledige billing-flow (huidige staat)

**Setup (nieuw / heraanmelding):**

1. `/upgrade` (client) → `POST /api/checkout` → Mollie iDEAL setup-payment (`sequenceType: first`) + Mollie customer aangemaakt of hergebruikt → redirect naar Mollie checkout.
2. Betaling gelukt → Mollie POST → `POST /api/mollie-webhook` (type=`subscription_setup`) → recurring subscription aangemaakt bij Mollie, license geüpdatet (`billing_plan`, `period_end = now + 1 maand`, `external_subscription_id`, `mollie_customer_id`), admin-mail + klant-bevestigingsmail verstuurd (idempotent via pre-fetch-state).

**Cancel (user-initiated):** `/upgrade` → `POST /api/cancel-subscription` → Mollie subscription cancel + license geüpdatet (`cancelled_at`, `external_subscription_id = null`), admin-mail. `billing_plan` en `period_end` blijven ongemoeid → toegang tot `period_end`.

**Read:** `/api/current-plan` — lazy trial-expiry check + normalisatie van sentinel `billing_plan='expired'` naar `plan=null`.

**Usage-limits (Basic-gating):** `/api/school-usage` retourneert `active_students` + `active_instructors` voor client-side pre-check + server-side hard-check in `/api/checkout`.

---

## 2. Trial-reminders

**Locatie:** [`app/api/cron/trial-reminder/route.ts`](../app/api/cron/trial-reminder/route.ts)
**Schedule:** Vercel cron `0 9 * * *` (dagelijks 09:00 UTC — zie `vercel.json`).
Zoekt licenses waar `trial_ends_at` valt op `now + 7d` of `now + 1d` → mail via `sendTrialEndingReminderMail`.

**Ontbreekt hier:** de daadwerkelijke `trial → expired`-transitie. De code verwacht dat een `check-trial-expiry` job `billing_plan='expired'` zet — die job zit in **ribbaPro / Supabase edge functions**, niet in deze repo. Web ziet die staat alleen (lazy-check + sentinel-normalisatie in `/api/current-plan`).

---

## 3. Checkout

[`app/api/checkout/route.ts`](../app/api/checkout/route.ts) — Bearer-auth + ownership-check + rate-limit + Basic-limietcheck (regel 82-125) + optionele cancel van bestaande sub (**B1**, zie §7) → Mollie customer create/hergebruik → iDEAL first-payment. Returnt `checkoutUrl`.

---

## 4. Mollie-webhook

[`app/api/mollie-webhook/route.ts`](../app/api/mollie-webhook/route.ts) — één endpoint dat drie type events afhandelt via `payment.metadata.type`:

| type | Trigger | Effect |
|---|---|---|
| `subscription_setup` + status=paid | eerste iDEAL gelukt | Recurring sub aanmaken, license update, mails (idempotent) |
| `recurring` + status=paid | maandelijkse SEPA-incasso gelukt | `period_end += 1 maand`, failure counter reset (**B2**, zie §7) |
| `recurring` + status=failed | SEPA mislukt | Escalatieladder: pogingen 1–2 mail rijschool; ≥3 = Mollie-sub cancel + trial-reset + suspended-mail |

---

## 5. Renewal / failed-payment flow

- **Renewal**: enkel in `mollie-webhook` `recurring` + paid branch (regel 202-216).
- **Failed-payment ladder**: idem file, regel 219-310. Threshold `FAILED_PAYMENT_LIMIT = 3`.
- **Reconciliation**: [`app/api/cron/reconcile-subscriptions/route.ts`](../app/api/cron/reconcile-subscriptions/route.ts) — cron `0 3 * * *` — vangnet voor licenses die wél Mollie customer hebben maar géén `external_subscription_id`.

---

## 6. `billing_events` — bestaat NIET

Nul hits in de hele codebase (`grep billing_events` → leeg). Er is geen append-only audit-log voor:

- setup / recurring / cancel / suspend transities
- refund events
- webhook-retries

**Waar het hoort:**

- **Migratie** (append-only, RLS deny UPDATE/DELETE, indexen op `school_id` + `created_at`) → **ribbaPro / Supabase**.
- **Write-calls** vanuit alle billing-endpoints → **ribba-web** (wrapper-lib + call-sites in checkout, webhook, cancel-subscription, reconcile-cron).

---

## 7. B1 & B2 — precieze locatie + oorzaak

### B1 — te vroeg cancelen bij planwissel

**Locatie:** [`app/api/checkout/route.ts:127-138`](../app/api/checkout/route.ts:127)

```ts
if (license?.external_subscription_id && license?.mollie_customer_id) {
  await getMollie().customerSubscriptions.cancel(...)
  // Mollie-sub is NU al weg. DB nog ongewijzigd.
}
// Daarna pas: iDEAL first-payment aangemaakt en checkoutUrl returned
```

Oude Mollie-subscription wordt gecanceld **vóór** de nieuwe iDEAL gestart is. Als de gebruiker de iDEAL-flow niet afmaakt (afbreken, timeout, iDEAL geweigerd, browser sluit) → geen webhook → DB houdt oude `external_subscription_id`, maar bij Mollie is die dood. Volgende maand: **geen incasso** en de cron `reconcile-subscriptions` slaat dit over (filter is `external_subscription_id IS NULL`). School blijft toegang houden tot `period_end` en verdwijnt dan zonder correcte state.

**Correcte volgorde**: eerst nieuwe iDEAL/subscription success afwachten in webhook, dán oude subscription cancelen (of pas cancelen als de user daadwerkelijk een nieuwe SEPA-mandaat heeft geset).

**Repo:** ribba-web.

### B2 — renewal na opzegging verlengt onterecht

**Locatie:** [`app/api/mollie-webhook/route.ts:202-216`](../app/api/mollie-webhook/route.ts:202)

```ts
if (payment.status === 'paid' && type === 'recurring') {
  await getSupabase().from('instructor_licenses')
    .update({ period_end: newPeriodEnd, failed_payment_count: 0 })
    .eq('school_id', school_id).eq('status', 'active');
  // ← geen check op cancelled_at
}
```

Twee scenario's leiden hierheen:

1. **Race**: user zegt op via `/api/cancel-subscription`, Mollie-cancel-call slaagt niet (netwerkfout, api-error), staat in try/catch die alleen `warn` logt ([`app/api/cancel-subscription/route.ts:69-71`](../app/api/cancel-subscription/route.ts:69)). DB gemarkeerd als opgezegd, Mollie subscription leeft door → volgende recurring gaat door → onze webhook verlengt `period_end` → **school krijgt onterecht toegang + wordt geïncasseerd na opzegging**.
2. **Timing**: opzegging vlak vóór volgende incasso, Mollie heeft die al ingezet.

**Fix in webhook**: check op `cancelled_at !== null` vóór `period_end` te verlengen → skip + refund + notify.
**Fix in cancel-route**: als Mollie-cancel-call faalt, geen 200 teruggeven; retryen; admin-notify.

**Repo:** ribba-web.

---

## 8. Wat waar hoort (samenvattend)

### Alleen in ribba-web

1. **B1** fix in `app/api/checkout/route.ts` (volgorde omdraaien).
2. **B2** fix in `app/api/mollie-webhook/route.ts` (`cancelled_at`-guard op recurring paid).
3. **Hardening `cancel-subscription`**: Mollie-cancel-fail moet 5xx returnen of retry-queue, niet stil warnen.
4. **Write-calls naar `billing_events`** inbouwen op alle transities (setup / recurring-paid / recurring-failed / cancel / suspend). Incl. logging-wrapper-lib.

### Alleen in ribbaPro / Supabase-migraties

1. Nieuwe `billing_events` tabel-migratie (append-only, RLS deny UPDATE/DELETE, indexen op `school_id` + `created_at`).
2. `check-trial-expiry` edge function (zet sentinel `billing_plan='expired'`).
3. App-runtime PlanContext / read-modellen die eventueel `billing_events` gaan lezen voor history-UI.

### Contract-eis (blijft ongewijzigd)

`instructor_licenses.status` blijft altijd `'active'`. Alle billing-writes gaan via de bekende kolommen. Geen wijziging aan dit contract nodig in Fase 2.

---

## Aanbevolen implementatievolgorde (na expliciete GO)

Niet alles in één PR. Per veilige stap, elk met eigen PR + E2E-verificatie:

1. `billing_events` migratie in **ribbaPro / Supabase**.
2. Logging-wrapper + `billing_events` write-calls in **ribba-web**.
3. **B1** fix in **ribba-web**.
4. **B2** fix in **ribba-web**.
5. `cancel-subscription` hardening in **ribba-web**.
6. E2E-test met testschool (setup → cancel → recurring → refund pad).

**Belangrijk:** implementatie start pas na expliciete GO. Deze commit legt alleen de audit vast; er zijn geen code-wijzigingen.
