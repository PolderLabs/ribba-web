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

- `20260711000000_marketplace_mvp.sql` gaat ervan uit dat `cbr_rijscholen`
  bestaat met een **integer** primary key. Is de PK `bigint`, pas dan de
  `rijschool_id`-kolommen in de migratie aan vóór het draaien.
- De migratie bevat bewuste afwijkingen t.o.v. de draft in issue #36 — zie de
  header van het bestand. Communiceer die naar het ribbaPro-team (issues
  #139/#140/#141 bouwen tegen dit schema).
- Voor de web-chat gate (#42) moet in het dashboard de **e-mail OTP-flow**
  aanstaan: Auth → Email Templates → "Magic Link" template moet `{{ .Token }}`
  bevatten (anders krijgen gebruikers alleen een link, geen 6-cijferige code).
  ⚠️ Dit template is gedeeld met de native apps — eerst afstemmen.
