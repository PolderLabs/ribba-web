# Supportportaal — tweefactor herstellen

Wat te doen als een supportmedewerker geen geldige TOTP-code meer kan produceren
en daardoor niet meer in `/support` komt.

Dit is een **admin-procedure**: alleen uit te voeren door wie de
`SUPABASE_SERVICE_ROLE_KEY` beheert. Er bestaat met opzet geen zelfherstelknop in
het portaal — zie "Waarom dit handwerk is".

## Wanneer je deze procedure gebruikt

Herkenbaar aan alle drie tegelijk:

- Inloggen met e-mail en wachtwoord lukt, maar het portaal blijft op het
  codescherm hangen.
- De medewerker heeft geen werkende authenticator-entry meer (app-entry
  verwijderd, telefoon kwijt, gewist of vervangen).
- In `auth.audit_log_entries` staan wel `login` en `challenge_created`, maar geen
  geslaagde `verification_attempted`.

Klopt dat beeld niet, dan is dit **niet** het probleem. Ga dan niet verwijderen,
maar zoek eerst uit wat er wél speelt.

## Voorwaarde vooraf

Stel de identiteit van de aanvrager vast **buiten het getroffen kanaal om** — dus
niet via de mailbox of het account waar het verzoek vandaan kwam. Wie deze
procedure misbruikt, koppelt zijn eigen authenticator aan een account met toegang
tot de gegevens van álle rijscholen.

Bij één supportmedewerker is die stap formeel. Vanaf de tweede is hij de hele
beveiliging van deze procedure.

## Stappen

### 1. Bevestig de situatie (read-only)

```sql
select id, factor_type, status, created_at, updated_at
from auth.mfa_factors
where user_id = '<user_id>';
```

Verwacht: precies één rij, status `verified`. Wijkt dat af (nul rijen, meerdere
rijen, status `unverified`), stop en onderzoek eerst.

### 2. Zorg dat de medewerker klaarzit

Tussen stap 3 en stap 4 is het account **alleen door een wachtwoord beschermd**.
Dat venster hoort minuten te duren, geen uren. Begin dus pas als de medewerker
achter zijn telefoon zit met de authenticator-app open.

### 3. Verwijder de factor via de Auth Admin API

Vanuit de repo-root (waar `.env.local` staat):

```bash
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2- | tr -d '\r"' | xargs); curl -sS -X DELETE "https://vsuhctqdtsxyimzsbjds.supabase.co/auth/v1/admin/users/<user_id>/factors/<factor_id>" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -w '\nHTTP %{http_code}\n'; unset KEY
```

Verwacht: `{"id":"<factor_id>"}` en `HTTP 200`.

Alternatief zonder terminal: Supabase Dashboard → Authentication → Users → de
gebruiker → MFA-factor verwijderen. Loopt langs dezelfde API en levert hetzelfde
auditspoor op.

**Nooit via directe SQL** (`delete from auth.mfa_factors`). Dat werkt wel, maar
omzeilt GoTrue: je mist de `factor_deleted`-auditregel en de opruiming van
openstaande challenges. Bij een portaal dat zijn bestaansrecht ontleent aan
"elke toegang is herleidbaar", is de herstelhandeling zelf niet de plek om het
spoor te laten vallen.

### 4. Medewerker koppelt direct opnieuw

De medewerker gaat naar `/support`. Omdat er geen factor meer is, komt
`bepaalFase()` in `app/support/page.tsx` uit op `tweefactor-instellen` en
verschijnt vanzelf een nieuwe QR-code. Scannen, code invoeren, klaar.

Een bestaande browsersessie op aal1 blijft bruikbaar — opnieuw inloggen is meestal
niet nodig.

### 5. Verifieer met bewijs, niet met vertrouwen

Alle drie moeten kloppen voordat je dit afgerond noemt:

```sql
-- a) precies één nieuwe factor, status verified
select id, status, created_at from auth.mfa_factors where user_id = '<user_id>';

-- b) het spoor van de herstelhandeling
select created_at, payload->>'action' as action, payload->>'actor_username' as actor
from auth.audit_log_entries
where payload->>'actor_id' = '<user_id>'
order by created_at desc limit 10;
-- verwacht: factor_deleted, factor_in_progress, verification_attempted

-- c) het portaal laat de medewerker daadwerkelijk toe én logt het
select at, action, level, result from platform_access_log
where staff_user_id = '<user_id>' order by at desc limit 5;
-- verwacht: een verse regel met result 'ok'
```

Controleer ook of er in het wachtwoord-only-venster (stap 3 tot 4) geen andere
loginpogingen op dat account staan.

## Harde regels

- De service-role-key gaat nooit in chat, ticket, screenshot of shell-history.
  Lees hem uit `.env.local` in een variabele en `unset` hem erna.
- Uitsluitend uit te voeren door de beheerder van die key.
- Leg elke uitvoering vast: wie, wanneer, voor wie, en waarom.

## Valkuilen (uit de praktijk, 20 aug 2026)

- **`HTTP 000` zonder foutmelding.** De `-s` vlag van curl slikt fouten in. Draai
  met `-sS`, dan zie je wat er werkelijk misgaat.
- **Onzichtbare tekens in de key.** Een afsluitende `\r` of aanhalingstekens uit
  `.env.local` maken de HTTP-header ongeldig, waarna curl afbreekt vóór er een
  antwoord komt. De `tr -d '\r"' | xargs` in het commando hierboven vangt dat af.
- **`HTTP 401` op `/auth/v1/health` is normaal.** Dat endpoint wil een apikey
  zien. Als connectiviteitstest betekent 401 dus: verbinding in orde.

## Waarom dit handwerk is

In `app/support/page.tsx` ruimt `startInstellen()` alleen factoren met status
`unverified` op. Een geverifieerde factor blijft staan, en de client-side
`mfa.unenroll` van een geverifieerde factor vereist zélf een aal2-sessie — die je
juist niet kunt krijgen. Kip-ei, en dus bewust een admin-procedure.

## Wat dit niet oplost

Deze procedure herstelt een lockout; hij voorkomt hem niet. Zolang er één
supportmedewerker is met één factor en geen herstelcodes, blijft dit een
enkelvoudig faalpunt dat afhangt van de beschikbaarheid van de key-beheerder.
Een tweede, apart bewaarde factor of een break-glass-account is de structurele
oplossing — nog te besluiten.
