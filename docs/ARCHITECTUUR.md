# Ribba Architectuur — Wat hoort waar

Dit document legt uit welke code in welke repo hoort. Lees dit door voordat je iets bouwt,
zodat we nooit meer twee systemen door elkaar halen.

## Producten

Ribba bestaat uit **twee losse producten** onder hetzelfde merk:

| Product | Wat | Voor wie |
|---|---|---|
| **Ribba** (vergelijkingssite) | Website waar consumenten rijscholen zoeken/vergelijken | Eindgebruikers (leerlingen) |
| **Ribba Rijschool Planner** | SaaS software voor rijschoolbeheer (planning, leerlingen, facturatie) | Rijschool-eigenaren |

Beide zijn van hetzelfde bedrijf (Ribba, KVK 85826898), maar het zijn **aparte diensten**.

## Repo-overzicht

| Systeem | Repo | Host | Tech |
|---|---|---|---|
| **Vergelijkingssite** | (andere repo) | `ribba.app` (GitHub Pages) | ? |
| **Rijschool Planner — iOS app** | (andere repo) | App Store / Google Play | Swift / iOS |
| **Rijschool Planner — website** | **`ribba-web`** (deze repo) | `link.ribba.app` (Vercel) | Next.js 16 |
| **Supabase database** | Gedeeld | `vsuhctqdtsxyimzsbjds.supabase.co` | PostgreSQL + Auth |

## Wat hoort in deze repo (`ribba-web`)

Deze repo = **de website voor Ribba Rijschool Planner**, gehost op `link.ribba.app`.

### ✅ WEL hier:

- **Landing/marketing page** (`/pro`) — uitleg over de Rijschool Planner
- **Registratie** voor rijschool-eigenaren (`/registreren`)
- **Login** (`/login`) — voor rijschool-eigenaren die willen betalen
- **Abonnement afsluiten** (`/upgrade`) — Basic/Premium kiezen
- **Abonnement opzeggen** (knop op `/upgrade`)
- **Betaalflow** — Mollie iDEAL + SEPA recurring (`/api/checkout`, `/api/mollie-webhook`, `/api/cancel-subscription`)
- **Leerling-inschrijfpagina per rijschool** (`/[slug]`)
- **Marketplace web-backend** (Epic ribba.app#35):
  - `/api/inquiry-submit` — inquiry-intake vanaf de vergelijkingssite (CORS), schrijft `inquiries` + `inquiry_recipients`, stuurt outreach-mails naar rijscholen
  - `/chat/[token]` — geanonimiseerde web-chat gateway met e-mailverificatie (Supabase Auth OTP), realtime via Supabase Realtime
  - `/api/cron/chat-notifications` — reply-notificatie e-mails (gebundeld, beide richtingen)
  - `supabase/migrations/` — schema voor inquiries/conversations/messages/marketplace_profiles
    **plus de gedeelde SECURITY DEFINER RPC's** (`get_chat_context`, `claim_inquiry`,
    `claim_inquiry_recipient`, `get_inquiry_for_recipient`, `mark_messages_read`) — web-chat en
    ribbaPro-app gebruiken exact dezelfde claim/masking-semantiek
  - `.well-known/apple-app-site-association` bevat `/chat/*` — met de app geïnstalleerd opent
    de mail-link de app i.p.v. de browser (universal link, ribbaPro#139)
- **Wachtwoord reset** (`/reset`)
- **iCal proxy** (`/api/ical`)
- **Legal pagina's voor de Rijschool Planner**:
  - `/voorwaarden`
  - `/privacy`
  - `/verwerkersovereenkomst`
- **Redirect landing** (`/rijschool-planner`) — waar de iOS app naartoe stuurt

### ❌ NIET hier (hoort in de iOS app-repo):

- Planning / agenda functionaliteit
- Leerlingbeheer (CRUD in de app zelf)
- Facturatie / pakketten
- CBR-koppeling
- Moneybird-koppeling
- Alles wat dagelijks gebruik van de software is

### ❌ NIET hier (hoort in de vergelijkingssite-repo):

- Rijschool-zoekfunctionaliteit voor consumenten
- Reviews / vergelijkingen
- Legal pagina's van de vergelijkingssite (`ribba.app/voorwaarden`, `ribba.app/privacybeleid`)
- Homepage van `ribba.app`

## Domeinen

| Domein | Wijst naar | Doel |
|---|---|---|
| `ribba.app` | GitHub Pages (andere repo) | Vergelijkingssite |
| `ribba.app/voorwaarden` | GitHub Pages (andere repo) | Voorwaarden vergelijkingssite |
| `ribba.app/privacybeleid` | GitHub Pages (andere repo) | Privacy vergelijkingssite |
| `link.ribba.app` | Vercel (deze repo) | Rijschool Planner website |
| `link.ribba.app/*` | Vercel (deze repo) | Alle planner-routes |

**`app.ribba.app`** is gereserveerd maar heeft geen DNS record — niet gebruiken.

## Wat doet de middleware in deze repo?

De `middleware.ts` in deze repo:

1. Als iemand `ribba.app/pro` (of een andere planner-route) opent en die request
   toevallig toch hier binnenkomt → redirect 308 naar `link.ribba.app/pro`.
2. Als iemand `link.ribba.app/` opent → toont de `/pro` landing page.

In praktijk zal `ribba.app/*` nooit bij deze repo binnenkomen (GitHub Pages handelt dat af),
maar de middleware-redirect is er als vangnet.

## Supabase — gedeelde database

Beide de iOS app en deze web-repo praten met **dezelfde Supabase database**:
`vsuhctqdtsxyimzsbjds.supabase.co`.

### Gedeelde tabellen

| Tabel | Wie schrijft | Wie leest |
|---|---|---|
| `auth.users` | Beide (via Supabase Auth) | Beide |
| `drivingschools` | Web (bij registratie) + app (bij updates) | Beide |
| `instructors` | Beide | Beide |
| `instructor_licenses` | **Web (subscription/betaling)** | Beide |
| `students` | Beide | Beide |
| `cbr_rijscholen` | Vergelijkingssite-pipeline | Beide (web leest voor marketplace-outreach) |
| `inquiries` + `inquiry_recipients` | **Web (`/api/inquiry-submit`) + claim-RPC's** | Beide |
| `conversations` + `messages` | Beide (web-chat én apps, zelfde bron van waarheid) | Beide |
| `marketplace_profiles` | Alleen claim-RPC's (rol) + eigenaar (email_notifications) | Beide |
| `push_tokens` | App (multi-device push-registratie) | Web leest (notificatie-dedupe in cron) |

### Belangrijk: `instructor_licenses` kolommen

Deze web-repo beheert de betaling en stopt/start abonnementen. De iOS app **leest** deze kolommen alleen:

| Kolom | Gevuld door | Betekenis |
|---|---|---|
| `billing_plan` | Web (webhook) | `'trial'`, `'basic'`, of `'premium'` |
| `is_trial` | Web | `true` tijdens proefperiode |
| `trial_ends_at` | Web (bij registratie) | Einde proefperiode |
| `price_per_month` | Web (webhook) | Prijs in euro |
| `mollie_customer_id` | Web | Mollie customer ID |
| `external_subscription_id` | Web | Mollie subscription ID |
| `cancelled_at` | Web (opzegknop) | Moment van opzegging |
| `period_end` | Web (webhook) | Datum tot wanneer toegang geldig is |

### De iOS app moet:

- Checken of abonnement verlopen is: `cancelled_at IS NOT NULL AND period_end < NOW()` → toegang intrekken
- Bij opzegging ergens tonen: "Opgezegd — nog actief tot [period_end]"
- **Niet** deze kolommen zelf schrijven (alleen lezen) — betaling gebeurt altijd via web

## Flows

### Abonnement afsluiten
```
iOS app (tik "Upgrade")
  → open webbrowser naar link.ribba.app/rijschool-planner
  → link.ribba.app/login (via redirect)
  → login met Supabase credentials
  → /api/me haalt school_id op
  → link.ribba.app/upgrade?school_id=xxx
  → kies Basic/Premium
  → /api/checkout maakt Mollie iDEAL payment (eerste betaling + SEPA mandaat)
  → Mollie checkout
  → webhook /api/mollie-webhook maakt recurring subscription aan
  → link.ribba.app/upgrade/success
```

### Abonnement opzeggen
```
link.ribba.app/upgrade (ingelogd)
  → knop "Abonnement opzeggen"
  → /api/cancel-subscription
  → Mollie subscription gecancelled
  → cancelled_at gezet in instructor_licenses
  → gebruiker houdt toegang tot period_end
  → na period_end: current-plan API geeft plan=null terug
```

## Legal pagina's

**Belangrijk onderscheid:**

| URL | Geldt voor | Waar beheerd |
|---|---|---|
| `ribba.app/voorwaarden` | Vergelijkingssite | Andere repo (GitHub Pages) |
| `ribba.app/privacybeleid` | Vergelijkingssite | Andere repo (GitHub Pages) |
| `link.ribba.app/voorwaarden` | Rijschool Planner | **Deze repo** |
| `link.ribba.app/privacy` | Rijschool Planner | **Deze repo** |
| `link.ribba.app/verwerkersovereenkomst` | Rijschool Planner | **Deze repo** |

Elke legal pagina in deze repo heeft een disclaimer bovenaan met link naar de
tegenhanger op de vergelijkingssite.

## Samengevat

> **Deze repo = de website waar rijschool-eigenaren hun abonnement afsluiten, upgraden en opzeggen.**
>
> **De iOS app = de applicatie die ze daarna gebruiken voor hun dagelijkse werk.**
>
> **De vergelijkingssite = een apart product voor consumenten, andere repo, andere URL structuur.**

Als je twijfelt of iets hier hoort: hoort het bij **"hoe sluit een rijschool zijn abonnement af"**?
Dan hoort het hier. Anders niet.
