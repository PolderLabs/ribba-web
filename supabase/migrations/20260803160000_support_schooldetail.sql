-- Supportportaal fase 2 — schooldetail en foutentijdlijn (niveau 0)
--
-- Het scholenoverzicht laat zien dát een rijschool stilstaat. Dit laat zien
-- wáár. Twee functies:
--
--   support_school_detail(school)  — profiel, onboardingstappen, juridische
--                                    acceptaties, instructeurs (zonder namen)
--   support_school_events(school)  — wat er misging, in tijdsvolgorde
--
-- NIVEAUGRENS — waar de lijn precies ligt
-- --------------------------------------
-- Niveau 0 betekent niet "geen persoonsgegevens", het betekent: gegevens van
-- de rijschool als bedrijf, waarvoor Ribba zelf verwerkingsverantwoordelijke
-- is. Concreet:
--
--   WEL: bedrijfsnaam, vestigingsadres, KVK, btw, het zakelijke e-mailadres
--        en telefoonnummer van de rijschool, en de ontvanger van onze eigen
--        facturatiemail aan die rijschool. Dat is onze klantrelatie.
--   NIET: namen, e-mailadressen en telefoonnummers van individuele
--        instructeurs en leerlingen. Dáárvoor is Ribba verwerker, en die
--        gegevens horen bij niveau 1 en 2 — pas in te zien nadat de rijschool
--        er zelf om vraagt.
--
-- Vandaar dat de instructeurslijst hieronder rollen, status en activiteit
-- toont maar geen namen. "De eigenaar heeft nooit ingelogd" is de vraag die
-- support moet kunnen beantwoorden; wie die eigenaar is, staat al in het
-- e-mailadres van de rijschool zelf.
--
-- ONBOARDINGSTAPPEN
-- -----------------
-- Elke stap draagt een tijdstip, niet alleen een vinkje. Een rijschool die
-- vier stappen deed en toen stopte, laat dat zien in de gaten tussen die
-- tijdstippen. Dat is de eigenlijke diagnose: niet "hij is niet klaar" maar
-- "hij is drie weken geleden gestopt bij het eerste lestype".
--
-- De stappen komen als jsonb-array uit de database, zodat een stap toevoegen
-- een migratie is en geen frontendwijziging.

-- ---------------------------------------------------------------------------
-- 1. Schooldetail
-- ---------------------------------------------------------------------------

create or replace function public.support_school_detail(p_school_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (
    select * from public.drivingschools where id = p_school_id
  ),
  instr as (
    select i.id, i.user_id, i.school_role, i.status, i.created_at
    from public.instructors i
    where i.drivingschool_id = p_school_id
  ),
  eerste_login as (
    select min(s.created_at) as wanneer
    from instr join auth.sessions s on s.user_id = instr.user_id
  ),
  bevestigd as (
    select min(u.email_confirmed_at) as wanneer
    from instr join auth.users u on u.id = instr.user_id
  ),
  juridisch as (
    select la.document_type, max(la.accepted_at) as wanneer,
           max(la.document_version) as versie
    from public.legal_acceptances la
    where la.school_id = p_school_id
    group by la.document_type
  ),
  lestype as (
    select min(ilt.created_at) as wanneer
    from public.instructor_lesson_types ilt
    join instr on instr.id = ilt.instructor_id
    where ilt.enabled
  ),
  beschikbaar as (
    select min(ab.created_at) as wanneer
    from public.availability_blocks ab
    where ab.drivingschool_id = p_school_id and ab.is_active
  ),
  voertuig as (
    select min(v.created_at) as wanneer from public.vehicles v
    where v.drivingschool_id = p_school_id
  ),
  pakket as (
    select min(lp.created_at) as wanneer from public.lesson_packages lp
    where lp.drivingschool_id = p_school_id
  ),
  leerling as (
    select min(st.created_at) as wanneer, count(*)::int as aantal
    from public.students st where st.drivingschool_id = p_school_id
  ),
  les as (
    select min(l.created_at) as wanneer, count(*)::int as aantal
    from public.lessons l join instr on instr.id = l.instructor_id
  ),
  factuur as (
    select min(inv.created_at) as wanneer, count(*)::int as aantal
    from public.invoices inv where inv.school_id = p_school_id
  ),
  abo as (
    select ss.stripe_status, ss.plan, ss.created_at, ss.current_period_end
    from public.school_subscriptions ss
    where ss.school_id = p_school_id
    order by ss.created_at desc limit 1
  ),
  -- De CBR-hartslag hoort hier en niet in de tijdlijn: de cron draait elk uur,
  -- dus als los feit is elke regel waardeloos en als samenvatting waardevol.
  cbr_status as (
    select max(c.created_at) as laatste,
           max(c.created_at) filter (where c.success) as laatste_ok,
           count(*) filter (where c.created_at > now() - interval '7 days')::int as runs_7d,
           count(*) filter (where c.created_at > now() - interval '7 days' and not c.success)::int as mislukt_7d
    from public.cbr_sync_log c
    where c.school_id = p_school_id
  )
  select jsonb_build_object(
    'school', (select jsonb_build_object(
        'id', d.id,
        'naam', d.name,
        'is_internal', d.is_internal,
        'status', d.status,
        'aangemaakt', d.created_at,
        -- Zakelijke contactgegevens van de rijschool: onze eigen klantrelatie.
        'email', d.email,
        'telefoon', d.phone,
        'adres', d.address,
        'postcode', d.postal_code,
        'plaats', d.city,
        'land', d.country_code,
        'rechtsvorm', d.legal_form,
        'kvk', d.kvk_number,
        'btw', d.btw_number,
        'iban_ingevuld', d.iban is not null and d.iban <> '',
        'website', d.website,
        'logo', d.logo_url is not null,
        'registratie_slug', d.registration_slug,
        'registratie_open', d.registration_enabled,
        'welkomstmail', d.welcome_email_sent_at,
        'plango_import', d.plango_imported_at
      ) from d),

    -- Instructeurs zonder namen: rol, status en activiteit zijn wat support
    -- nodig heeft. Zie de niveaugrens bovenaan dit bestand.
    'instructeurs', (select coalesce(jsonb_agg(jsonb_build_object(
        'rol', instr.school_role,
        'status', instr.status,
        'toegevoegd', instr.created_at,
        'account_bevestigd', (select u.email_confirmed_at from auth.users u where u.id = instr.user_id),
        'laatste_activiteit', greatest(
          (select max(coalesce(s.refreshed_at, s.created_at)) from auth.sessions s where s.user_id = instr.user_id),
          (select u.last_sign_in_at from auth.users u where u.id = instr.user_id)
        )
      ) order by instr.created_at), '[]'::jsonb) from instr),

    'juridisch', (select coalesce(jsonb_agg(jsonb_build_object(
        'document', juridisch.document_type,
        'versie', juridisch.versie,
        'wanneer', juridisch.wanneer
      ) order by juridisch.document_type), '[]'::jsonb) from juridisch),

    'abonnement', (select case when abo.stripe_status is null then null else jsonb_build_object(
        'status', abo.stripe_status,
        'plan', abo.plan,
        'gestart', abo.created_at,
        'loopt_tot', abo.current_period_end
      ) end from abo),

    'cbr', (select case when cbr_status.laatste is null then null else jsonb_build_object(
        'laatste', cbr_status.laatste,
        'laatste_geslaagd', cbr_status.laatste_ok,
        'runs_7d', cbr_status.runs_7d,
        'mislukt_7d', cbr_status.mislukt_7d
      ) end from cbr_status),

    'aantallen', jsonb_build_object(
      'instructeurs', (select count(*)::int from instr),
      'leerlingen', (select aantal from leerling),
      'lessen', (select aantal from les),
      'facturen', (select aantal from factuur),
      'voertuigen', (select count(*)::int from public.vehicles v where v.drivingschool_id = p_school_id),
      'pakketten', (select count(*)::int from public.lesson_packages lp where lp.drivingschool_id = p_school_id)
    ),

    -- Volgorde = de volgorde waarin een rijschool ze in de praktijk doorloopt.
    'onboarding', jsonb_build_array(
      jsonb_build_object('sleutel','ingeschreven','label','Ingeschreven',
        'wanneer', (select d.created_at from d), 'blokkerend', false),
      jsonb_build_object('sleutel','email_bevestigd','label','E-mailadres bevestigd',
        'wanneer', (select wanneer from bevestigd), 'blokkerend', false),
      jsonb_build_object('sleutel','voorwaarden','label','Voorwaarden, privacy en verwerkersovereenkomst',
        'wanneer', (select max(wanneer) from juridisch), 'blokkerend', false),
      jsonb_build_object('sleutel','eerste_login','label','Voor het eerst ingelogd',
        'wanneer', (select wanneer from eerste_login), 'blokkerend', false),
      jsonb_build_object('sleutel','welkomstmail','label','Welkomstmail verstuurd',
        'wanneer', (select d.welcome_email_sent_at from d), 'blokkerend', false),
      jsonb_build_object('sleutel','bedrijfsgegevens','label','Bedrijfsgegevens ingevuld (KVK en btw)',
        'wanneer', (select case when d.kvk_number is not null and d.btw_number is not null
                                then d.created_at end from d), 'blokkerend', false),
      -- Vanaf hier begint het echte inrichten. Zonder lestype kan een rijschool
      -- niets: geen les inplannen, geen prijs, geen factuur.
      jsonb_build_object('sleutel','lestype','label','Eerste lestype aangemaakt',
        'wanneer', (select wanneer from lestype), 'blokkerend', true),
      jsonb_build_object('sleutel','voertuig','label','Voertuig toegevoegd',
        'wanneer', (select wanneer from voertuig), 'blokkerend', false),
      jsonb_build_object('sleutel','pakket','label','Lespakket aangemaakt',
        'wanneer', (select wanneer from pakket), 'blokkerend', false),
      jsonb_build_object('sleutel','beschikbaarheid','label','Beschikbaarheid ingesteld (voor zelf inplannen)',
        'wanneer', (select wanneer from beschikbaar), 'blokkerend', false),
      jsonb_build_object('sleutel','leerling','label','Eerste leerling',
        'wanneer', (select wanneer from leerling), 'blokkerend', false),
      jsonb_build_object('sleutel','les','label','Eerste les ingepland',
        'wanneer', (select wanneer from les), 'blokkerend', false),
      jsonb_build_object('sleutel','factuur','label','Eerste factuur',
        'wanneer', (select wanneer from factuur), 'blokkerend', false),
      jsonb_build_object('sleutel','abonnement','label','Abonnement afgesloten',
        'wanneer', (select abo.created_at from abo), 'blokkerend', false)
    )
  )
  from d;
$$;

comment on function public.support_school_detail(uuid) is
  'Niveau 0 schooldetail: profiel, onboardingstappen met tijdstippen, '
  'juridische acceptaties en instructeurs zonder namen. Bevat geen '
  'persoonsgegevens van leerlingen of instructeurs — zie de niveaugrens in '
  'migratie 20260803160000.';

revoke execute on function public.support_school_detail(uuid) from public, anon, authenticated;
grant execute on function public.support_school_detail(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Foutentijdlijn
-- ---------------------------------------------------------------------------
--
-- Vier bronnen die aan een rijschool hangen. Bewust NIET meegenomen:
--
--   stripe_webhook_events        — heeft geen school_id, alleen event_id/type
--   billing_unattributed_events  — is per definitie niet aan een school
--                                  toegewezen; dat is juist het signaal, en
--                                  hoort op een platformbreed scherm
--   billing_email_outbox         — koppelt alleen op e-mailadres; opnemen zou
--                                  betekenen dat we op adres gaan matchen, en
--                                  dat is precies de heuristiek die we niet
--                                  willen. Wat er wél uit kwam staat in
--                                  billing_events.
--
-- `ok` is bewust een aparte kolom en niet af te leiden uit `soort`: het scherm
-- moet fouten kunnen highlighten zonder te weten wat elke gebeurtenis betekent.
--
-- CBR: ALLEEN OMSLAGPUNTEN
-- ------------------------
-- cbr_sync_log is geen gebeurtenissenlijst maar een hartslag: de cron draait
-- elk uur en schrijft elke keer een regel. Gemeten 3 aug 2026: 5094 regels,
-- tegenover 90 uit alle andere bronnen samen. Alles tonen betekent dat één
-- mislukte betaling onvindbaar wordt onder een muur van "16 examens".
--
-- Daarom alleen de momenten waarop de uitkomst omslaat — van goed naar kapot
-- en terug. Dat brengt 5094 regels terug naar 6 à 21 per rijschool, en elke
-- overgebleven regel betekent iets: hier ging het stuk, hier was het weer
-- goed. De hartslag zelf hoort in de samenvatting van support_school_detail,
-- niet in de tijdlijn.

create or replace function public.support_school_events(
  p_school_id uuid,
  p_limit integer default 100
)
returns table (
  wanneer  timestamptz,
  bron     text,
  soort    text,
  ok       boolean,
  detail   text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cbr as (
    select c.created_at, c.success, c.sync_type, c.error_message,
           lag(c.success) over (partition by c.sync_type order by c.created_at) as vorige
    from public.cbr_sync_log c
    where c.school_id = p_school_id
  )
  select * from (
    select be.created_at, 'facturatie'::text, be.event_type,
           true,
           nullif(concat_ws(' · ', be.email_type, be.recipient, be.source), '')
    from public.billing_events be
    where be.school_id = p_school_id

    union all

    select coalesce(r.last_received_at, r.first_received_at), 'webhook'::text,
           concat_ws(' ', r.provider, r.event_kind),
           r.last_error is null and r.status not in ('failed', 'error'),
           nullif(concat_ws(' · ', r.status, r.side_effect_stage, r.last_error), '')
    from public.billing_webhook_receipts r
    where r.school_id = p_school_id

    union all

    -- Alleen de momenten waarop de uitkomst omslaat; zie de toelichting boven.
    select c.created_at, 'cbr'::text, c.sync_type,
           c.success,
           case when c.success then 'synchronisatie werkt weer'
                else coalesce(c.error_message, 'synchronisatie mislukt') end
    from cbr c
    where c.vorige is null or c.success is distinct from c.vorige

    union all

    select s.created_at, 'snelstart'::text, s.event,
           s.outcome is distinct from 'error',
           nullif(concat_ws(' · ', s.outcome, s.source, s.detail_code), '')
    from public.snelstart_connection_events s
    where s.school_id = p_school_id
  ) as t(wanneer, bron, soort, ok, detail)
  order by wanneer desc nulls last
  limit greatest(p_limit, 1);
$$;

comment on function public.support_school_events(uuid, integer) is
  'Niveau 0 gebeurtenissentijdlijn per rijschool uit billing_events, '
  'billing_webhook_receipts, cbr_sync_log en snelstart_connection_events.';

revoke execute on function public.support_school_events(uuid, integer) from public, anon, authenticated;
grant execute on function public.support_school_events(uuid, integer) to service_role;
