# Flow: Abonnement afsluiten via ribba-web

## Waarom deze flow bestaat

Apple App Store staat niet toe dat een iOS app direct naar een externe betaalpagina linkt.
De Ribba iOS app stuurt gebruikers daarom eerst naar `ribba.app/rijschool-planner`, waarna
de gebruiker inlogt en daarna pas naar de betaalpagina komt.

## Overzicht van de flow

```
┌──────────────┐       ┌──────────────────┐       ┌──────────┐
│   iOS App    │──────▶│ /rijschool-      │──────▶│  /login  │
│ (deep link)  │       │     planner      │       │          │
└──────────────┘       │  (redirect naar  │       │ email +  │
                       │     /login)      │       │ wachtwrd │
                       └──────────────────┘       └────┬─────┘
                                                       │
                                                       ▼
                                               ┌───────────────┐
                                               │  Supabase     │
                                               │ signInWith    │
                                               │  Password()   │
                                               └───────┬───────┘
                                                       │
                                                       ▼
                                               ┌───────────────┐
                                               │  GET /api/me  │
                                               │ (Bearer token)│
                                               │               │
                                               │ → school_id   │
                                               └───────┬───────┘
                                                       │
                                                       ▼
                                            ┌────────────────────┐
                                            │ /upgrade?          │
                                            │   school_id=xxx    │
                                            │                    │
                                            │ Haalt huidig plan  │
                                            │ op via /api/       │
                                            │ current-plan       │
                                            └──────────┬─────────┘
                                                       │
                                              Kiest Basic/Premium
                                                       │
                                                       ▼
                                            ┌────────────────────┐
                                            │  POST /api/        │
                                            │    checkout        │
                                            │ (Bearer token)     │
                                            │                    │
                                            │ → Mollie iDEAL URL │
                                            └──────────┬─────────┘
                                                       │
                                                       ▼
                                               ┌───────────────┐
                                               │    Mollie     │
                                               │  (iDEAL bank  │
                                               │   keuze)      │
                                               └───────┬───────┘
                                                       │
                                          Na betaling: webhook
                                                       │
                                                       ▼
                                            ┌────────────────────┐
                                            │ POST /api/mollie-  │
                                            │   webhook          │
                                            │                    │
                                            │ → maakt recurring  │
                                            │ subscription aan   │
                                            └──────────┬─────────┘
                                                       │
                                                       ▼
                                            /upgrade/success
```

## Betrokken bestanden

| Bestand | Rol |
|---------|-----|
| `app/rijschool-planner/page.tsx` | Redirect endpoint waar de iOS app naartoe stuurt → stuurt door naar `/login` |
| `app/login/page.tsx` | Login formulier (email + wachtwoord), checkt eerst bestaande sessie, stuurt door naar `/upgrade` |
| `app/api/me/route.ts` | Geeft `school_id` terug op basis van Bearer token (instructor → drivingschool_id) |
| `app/upgrade/page.tsx` | Toont huidige plan + Basic/Premium kaarten, stuurt auth header mee bij API calls |
| `app/api/current-plan/route.ts` | Haalt het actieve abonnement op voor de school (auth vereist) |
| `app/api/checkout/route.ts` | Maakt Mollie iDEAL betaling aan (auth vereist) |
| `app/api/mollie-webhook/route.ts` | Verwerkt Mollie callbacks, maakt recurring subscription aan |

## Stap voor stap

### 1. iOS app → `ribba.app/rijschool-planner`
De iOS app opent een browser met deze URL omdat Apple geen directe externe betaal-links toestaat.

### 2. `/rijschool-planner` → `/login`
Client-side redirect (via `router.replace('/login')`).

### 3. `/login`
- Bij page load: controleert `supabase.auth.getSession()`.
  - **Al ingelogd?** → roept `/api/me` aan, haalt `school_id` op, redirect naar `/upgrade?school_id=xxx`.
  - **Niet ingelogd?** → toont login formulier.
- Bij submit: `supabase.auth.signInWithPassword({ email, password })`.
  - Bij succes: zelfde flow — `/api/me` → `/upgrade`.
  - Bij falen: toont "E-mailadres of wachtwoord is onjuist".
- Link onderaan: "Wachtwoord vergeten?" → `/reset`.

### 4. `/api/me`
- **Auth:** Bearer token (Supabase access token).
- **Query:** Zoekt de `instructors` record van de user en geeft `drivingschool_id` + naam terug.
- **Response:** `{ school_id, school_name }`.
- Wordt gebruikt vanuit de login pagina om te weten naar welke school te routeren.

### 5. `/upgrade?school_id=xxx`
- Haalt Supabase sessie op.
  - **Geen sessie?** → redirect naar `/login`.
- Stuurt `Authorization: Bearer <token>` mee bij `/api/current-plan`.
- Toont:
  - **In trial:** beide plannen klikbaar.
  - **Basic actief:** alleen upgrade naar Premium mogelijk.
  - **Premium actief:** geen upgrade mogelijk (downgrade via support).
- Bij klik op plan: `POST /api/checkout` met Bearer token.

### 6. `/api/checkout`
- Verifieert auth + eigendom van school (`instructors` tabel).
- Maakt Mollie customer aan (of hergebruikt bestaande).
- Cancelt oude Mollie subscription bij plan-wissel.
- Maakt eerste iDEAL betaling (sequenceType: `first`) — legt SEPA mandaat vast.
- Geeft Mollie checkout URL terug.

### 7. Mollie checkout
Gebruiker betaalt via iDEAL bij hun bank. Na betaling: redirect naar `/upgrade/success`.

### 8. `/api/mollie-webhook`
Mollie stuurt een webhook. Als `status=paid` + `type=subscription_setup`:
- Maakt recurring subscription aan die elke maand automatisch incasseert via SEPA.
- Eerste incasso is 1 maand na de initiële betaling (die maand is al betaald).
- Updatet `instructor_licenses`: `billing_plan`, `is_trial=false`, `external_subscription_id`.

## Security

- **Auth vereist** op `/api/me`, `/api/current-plan` en `/api/checkout`.
- **Ownership check**: elke API controleert of de ingelogde user een actieve instructor is van de opgegeven school.
- **Rate limiting** op `/api/checkout` (5 requests/min per IP).
- **Tokens** worden alleen in memory bewaard (via Supabase browser client), niet in URL params.

## Testen

1. `npm run build` — geen TypeScript fouten.
2. Navigeer naar `/rijschool-planner` → moet doorverwijzen naar `/login`.
3. Login met test-credentials → moet doorverwijzen naar `/upgrade?school_id=xxx`.
4. Upgrade pagina toont juiste plan (trial/basic/premium).
5. Klik op "Kies Basic" of "Upgrade naar Premium" → Mollie checkout opent.
6. Na test-betaling: webhook maakt recurring subscription aan.
