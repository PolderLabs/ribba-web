-- Supportportaal — laat zien wanneer een CBR-koppeling uit staat
--
-- Waarom
-- ------
-- Sinds 26 juni (ribbaPro 84d0c3bc + 7ca3cc7f) stopt de CBR-synchronisatie na
-- één mislukte login en schakelt hij zichzelf uit. Dat is goed: daarvóór bleef
-- de cron elk uur opnieuw proberen en raakten CBR-accounts van rijscholen
-- geblokkeerd — Het Zwaantje en 010 Rijbewijs in juni, 44 keer in totaal.
--
-- Maar de uitgeschakelde staat is daarna stil. De rijschool krijgt één mail en
-- één melding op het moment zelf; wordt die gemist, dan blijft de koppeling uit
-- tot iemand merkt dat er geen examenuitslagen meer binnenkomen. Bij de
-- testrijschool staat hij inmiddels ruim vijf weken uit zonder dat het opviel.
--
-- Daarom in het scholenoverzicht een status: 'aan', 'uit' of leeg (geen
-- koppeling). Wat er op één moment misging is een gebeurtenis; dat het nog
-- steeds uit staat is een toestand, en toestanden horen in een overzicht.
--
-- De weerhaak zit in de aparte kolom: `laatste_activiteit` blijft gewoon
-- oplopen als de rijschool de app dagelijks gebruikt, dus een school met een
-- kapotte CBR-koppeling ziet er in het overzicht kerngezond uit. Zonder deze
-- kolom is de storing per constructie onzichtbaar.

drop function if exists public.support_school_overview(boolean);

create or replace function public.support_school_overview(
  p_include_internal boolean default false
)
returns table (
  school_id            uuid,
  school_name          text,
  city                 text,
  status               text,
  is_internal          boolean,
  created_at           timestamptz,
  registration_enabled boolean,
  welcome_email_sent_at timestamptz,
  instructeurs         integer,
  leerlingen           integer,
  lestypes             integer,
  beschikbaarheid      integer,
  pakketten            integer,
  voertuigen           integer,
  lessen               integer,
  facturen             integer,
  abonnement_status    text,
  cbr_koppeling        text,
  laatste_activiteit   timestamptz,
  onboarding_gereed    boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with instr as (
    select i.id, i.drivingschool_id, i.user_id
    from public.instructors i
  ),
  activiteit as (
    select instr.drivingschool_id,
           -- greatest() slaat NULL's over, dus een school met alleen een
           -- sessie óf alleen een login komt er ook doorheen.
           greatest(
             max(coalesce(s.refreshed_at, s.created_at)),
             max(u.last_sign_in_at)
           ) as laatste
    from instr
    left join auth.sessions s on s.user_id = instr.user_id
    left join auth.users u on u.id = instr.user_id
    group by instr.drivingschool_id
  ),
  lesactiviteit as (
    select instr.drivingschool_id, max(l.created_at) as laatste
    from instr
    join public.lessons l on l.instructor_id = instr.id
    group by instr.drivingschool_id
  )
  select
    d.id,
    d.name,
    d.city,
    d.status,
    d.is_internal,
    d.created_at,
    d.registration_enabled,
    d.welcome_email_sent_at,
    (select count(*)::int from instr where instr.drivingschool_id = d.id),
    (select count(*)::int from public.students st where st.drivingschool_id = d.id),
    (select count(*)::int from public.instructor_lesson_types ilt
       join instr on instr.id = ilt.instructor_id
      where instr.drivingschool_id = d.id and ilt.enabled),
    (select count(*)::int from public.availability_blocks ab
      where ab.drivingschool_id = d.id and ab.is_active),
    (select count(*)::int from public.lesson_packages lp where lp.drivingschool_id = d.id),
    (select count(*)::int from public.vehicles v where v.drivingschool_id = d.id),
    (select count(*)::int from public.lessons l
       join instr on instr.id = l.instructor_id
      where instr.drivingschool_id = d.id),
    (select count(*)::int from public.invoices inv where inv.school_id = d.id),
    (select ss.stripe_status
       from public.school_subscriptions ss
      where ss.school_id = d.id
      order by ss.created_at desc
      limit 1),
    -- Leeg = deze rijschool heeft de koppeling nooit ingericht; dat is geen
    -- storing en hoort dus ook geen signaal te zijn.
    (select case when scs.is_enabled then 'aan' else 'uit' end
       from public.school_cbr_settings scs
      where scs.school_id = d.id
      limit 1),
    greatest(
      (select a.laatste from activiteit a where a.drivingschool_id = d.id),
      (select la.laatste from lesactiviteit la where la.drivingschool_id = d.id)
    ),
    -- Klaar voor gebruik = minstens één ingeschakeld lestype. Zonder lestype
    -- kan er niets ingepland en dus niets gefactureerd worden.
    --
    -- Beschikbaarheid hoort hier bewust NIET bij, hoe logisch dat ook klinkt.
    -- Gemeten op 3 aug 2026: Het Zwaantje heeft 343 lessen en 0 actieve
    -- beschikbaarheidsblokken. Blokken zijn er voor leerlingen die zélf
    -- inplannen; een instructeur die handmatig plant heeft ze niet nodig. Zou
    -- beschikbaarheid meetellen, dan meldde dit overzicht de actiefste klant
    -- als "niet klaar" — en een dashboard dat vals alarm geeft, geloof je na
    -- twee keer niet meer.
    exists (
      select 1 from public.instructor_lesson_types ilt
        join instr on instr.id = ilt.instructor_id
       where instr.drivingschool_id = d.id and ilt.enabled
    )
  from public.drivingschools d
  where p_include_internal or not d.is_internal
  order by d.created_at desc;
$$;

comment on function public.support_school_overview(boolean) is
  'Niveau 0 voor het supportportaal: rijschoolgegevens, configuratie en '
  'aantallen. Bevat per contract geen persoonsgegevens van leerlingen. '
  'Eigen test- en pilotomgevingen zijn standaard verborgen; geef '
  'p_include_internal mee om ze te tonen.';

revoke execute on function public.support_school_overview(boolean) from public, anon, authenticated;
grant execute on function public.support_school_overview(boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Schooldetail: dezelfde toestand, plus sinds wanneer
-- ---------------------------------------------------------------------------
-- Alleen het cbr-blok verandert; de rest van de functie is ongewijzigd.

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
  ),
  cbr_koppeling as (
    select scs.is_enabled, scs.connection_status, scs.last_sync_error, scs.updated_at
    from public.school_cbr_settings scs
    where scs.school_id = p_school_id
    limit 1
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
    -- nodig heeft. Zie de niveaugrens in migratie 20260803160000.
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

    'cbr', (select case when cbr_status.laatste is null and not exists (select 1 from cbr_koppeling)
                        then null else jsonb_build_object(
        'koppeling', (select case when cbr_koppeling.is_enabled then 'aan' else 'uit' end from cbr_koppeling),
        'connectie_status', (select cbr_koppeling.connection_status from cbr_koppeling),
        'laatste_fout', (select cbr_koppeling.last_sync_error from cbr_koppeling),
        'gewijzigd', (select cbr_koppeling.updated_at from cbr_koppeling),
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
  'juridische acceptaties, CBR-koppelingstoestand en instructeurs zonder '
  'namen. Bevat geen persoonsgegevens van leerlingen of instructeurs — zie de '
  'niveaugrens in migratie 20260803160000.';

revoke execute on function public.support_school_detail(uuid) from public, anon, authenticated;
grant execute on function public.support_school_detail(uuid) to service_role;
