# Billing Fase 2 — statusvastlegging (2026-07-10)

Administratieve vastlegging van de afronding van de webhook-idempotentie-fasering.
Aanvulling op `billing-fase2-repo-audit-2026-07-10.md` (het oorspronkelijke onderzoeksrapport).

## Faseoverzicht

| Fase | Inhoud | Status |
|---|---|---|
| A1/A2 | Migratie `billing_webhook_receipts` (ribbaPro/Supabase) | ✅ toegepast |
| A3 | Backfill: `tr_wvKA8Z78iAyHJjJYLVmTJ` → succeeded/completed, `tr_tw57XjLHQc6BaFZYG73TJ` → discarded/claimed | ✅ toegepast |
| B | Throwing fenced receipts-helper + unit-tests, geen runtime-koppeling (PR #23, main `f7edb9c`) | ✅ gemerged |
| C | Receipts-integratie in de setup-payment webhook + goedgekeurde B1 correctness-fix (PR #24, main `5e5171e`) | ✅ gemerged + productie |
| D | Gerichte tests (33/33 groen, onderdeel van B/C-PR's) | ✅ |
| **E** | **Redelivery-verificatie `tr_tw57XjLHQc6BaFZYG73TJ`** | ✅ **PASS — via spontane productie-redelivery** |

## Fase E — PASS via spontane productie-redelivery

De geplande handmatige redelivery bleek niet nodig: Mollie leverde de historische
payment `tr_tw57XjLHQc6BaFZYG73TJ` op **2026-07-10 14:37:51 UTC** (± 50 min na de
productie-deploy van `5e5171e`) uit eigen beweging opnieuw af. Waargenomen
(read-only, DB + billing_events):

- receipt `discarded` geraakt; `attempt_count` 1 → 2; `last_received_at` bijgewerkt;
- exact één `ignored_duplicate_setup_webhook` billing_event (`receipt_status: discarded`);
- géén `subscription_creation_failed`, géén adminmail, géén Mollie
  subscription-create, géén license-mutatie;
- de retry kreeg effectief HTTP 200 → de retry-storm (actief sinds 24 juni) is gestopt.

**Besluit: de handmatige redelivery vervalt** — opnieuw afleveren zou alleen
onnodige ruis produceren en bewijst niets extra's.

## Open restrisico's (ongewijzigd, bewust geaccepteerd)

1. Crash-window tussen `license_updated` en de old-subscription-cancel: recovery
   hervat dan alleen `markSucceeded`; een oude sub kan blijven staan (zichtbaar
   via het Mollie-dashboard). Gedocumenteerd in de webhook-code.
2. Mail-verlieswindow tussen `succeeded` en de activatiemails (bewuste keuze:
   verlies boven duplicatie).
3. Reconcile-cron heeft geen receipts/idempotentie-correlatie — open
   ontwerpbesluit (geen echte `setup_payment_id` in cron-context; geen
   synthetische sleutel zonder apart besluit).

## Volgende operationele stap

Gecontroleerd opzeggen van de TEST-subscription (`sub_FdUUJ7mW3w`,
`[TEST] Önder Test-rijschool`) — wacht op aparte GO. Daarna resteren o.a.:
TEST-school-rollback (school-email + licentie-baseline), refund-afweging voor de
live testbetaling, success-page-fix en het reconcile-ontwerpbesluit, elk als
losse, aparte actie.
