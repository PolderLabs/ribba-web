# Supabase-migraties

Deze repo heeft (nog) geen CLI-gelinkte migratie-historie. Migraties hier zijn
SQL-bestanden die **handmatig** op het gedeelde Supabase-project
(`vsuhctqdtsxyimzsbjds.supabase.co`) toegepast worden — hetzelfde project dat
ook door de native apps (ribbaPro) gebruikt wordt.

## Toepassen

Optie 1 — dashboard (aanbevolen voor nu):

1. Open het Supabase-dashboard → SQL Editor.
2. Plak de inhoud van het migratie-bestand en voer uit.
3. Migraties zijn idempotent — nogmaals draaien is veilig.

Optie 2 — CLI:

```bash
supabase link --project-ref vsuhctqdtsxyimzsbjds
supabase db push
```

## Aandachtspunten

- `20260711000000_marketplace_mvp.sql` implementeert het schema-contract uit
  het ribbaPro-review (ribba.app#36#issuecomment-4933108256): o.a.
  `marketplace_profiles` i.p.v. `user_profiles`, gedeelde claim-RPC's
  (`claim_inquiry` / `claim_inquiry_recipient`), server-side masking
  (`get_chat_context` / `get_inquiry_for_recipient`) en `mark_messages_read`
  als enige schrijfpad voor read-receipts. Zie de header van het bestand voor
  alle contract- (C1–C6) en design-beslissingen (D2–D6).
- `cbr_rijscholen` bestaat in het gedeelde project (integer PK, kolommen
  `email` + `kvk` aanwezig) maar had bij de contract-review **0 rijen** —
  vullen is een voorwaarde voor de funnel én voor de e-mail-match bij de
  rijschool-claim.
- De cron `chat-notifications` leest de bestaande `push_tokens`-tabel van de
  app (kolom `user_id` aangenomen) voor push/e-mail-dedupe — check de
  kolomnaam bij het eerste draaien.
- Voor de web-chat gate (#42) moet in het dashboard de **e-mail OTP-flow**
  aanstaan: Auth → Email Templates → "Magic Link" template moet `{{ .Token }}`
  bevatten (anders krijgen gebruikers alleen een link, geen 6-cijferige code).
  ⚠️ Dit template is gedeeld met de native apps — eerst afstemmen.
- `20260718000000_marketplace_review_fixes.sql` bevat de fixes uit de
  code-review op ribba-web#25: column-level SELECT op de chat-tokens (#1),
  status-gate op de messages-INSERT-policy (#8), de transactionele
  `submit_inquiry`-RPC (#6, tegen de dedupe-race) en
  `list_notifiable_conversation_ids` (#7, tegen cron-starvation).

## chat-notifications via pg_cron (NIET Vercel Cron)

Het Vercel-plan staat geen 3e/sub-dagelijkse cron toe, dus de 5-minuten
reply-notificatie-trigger draait op **Supabase pg_cron** i.p.v. `vercel.json`:

- Extensies: `pg_cron` + `pg_net`.
- Secret: `CRON_SECRET` staat in Supabase **Vault** onder
  `cron_secret_chat_notifications` (niet in `cron.job.command`).
- Job `chat-notifications-5min` (`*/5 * * * *`) doet via `net.http_get` een
  call naar `https://link.ribba.app/api/cron/chat-notifications` met
  `Authorization: Bearer <vault-secret>`.

Herstellen/aanpassen: zie `cron.job` (`select * from cron.job where jobname =
'chat-notifications-5min'`). Bij een gewijzigd `CRON_SECRET` ook de Vault-secret
bijwerken (`vault.update_secret`).
