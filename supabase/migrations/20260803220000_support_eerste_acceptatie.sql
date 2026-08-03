-- Supportportaal — onboardingstap "voorwaarden" toont de eerste acceptatie
--
-- Wat er mis was
-- --------------
-- De stap nam max(accepted_at) over alle documenten. Dat is de LAATSTE
-- acceptatie, en die schuift vooruit zodra een documentversie wordt gebumpt en
-- iedereen opnieuw moet accepteren.
--
-- Gevolg, gemeten op Rijschool Nielsen: ingeschreven 23 juli 20:52, alle drie
-- de documenten diezelfde seconde geaccepteerd (v2026-04-v1). Na de DPA-bump
-- van eind juli accepteerden ze op 30 juli opnieuw (v2026-07-v1). Het
-- onboardingscherm meldde daardoor dat ze de voorwaarden pas een week ná
-- inschrijving hadden geaccepteerd — precies het soort gat waar je een
-- verkeerde conclusie uit trekt ("ze twijfelden een week").
--
-- Een onboardingstap beantwoordt "wanneer deed deze rijschool dit voor het
-- eerst". Dat is min, niet max.
--
-- Per document de eerste keer, en daarvan de laatste: de stap is pas af
-- wanneer alle drie de documenten een keer zijn geaccepteerd.
--
-- Het juridische blok houdt bewust de LAATSTE acceptatie — daar is de vraag
-- juist welke versie nu geldt en wanneer die is aanvaard. Twee vragen, twee
-- berekeningen, uit dezelfde tabel.
--
-- Tweede verbetering in hetzelfde blok
-- ------------------------------------
-- De getoonde versie kwam uit max(document_version): de alfabetisch hoogste
-- versietekst, niet de versie die bij de laatste acceptatie hoort. Dat gaat nu
-- goed omdat versies als '2026-07-v1' toevallig alfabetisch én chronologisch
-- gelijk lopen, maar dat is een aanname over een tekstformaat en geen feit.
-- Nu wordt de versie van de daadwerkelijk laatste acceptatie gepakt.
--
-- Alleen deze twee CTE's en hun twee gebruikers wijzigen; de rest van de
-- functie is ongewijzigd.

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
  -- Eerste acceptatie per document; voedt de onboardingstap.
  juridisch_eerste as (
    select la.document_type, min(la.accepted_at) as wanneer
    from public.legal_acceptances la
    where la.school_id = p_school_id
    group by la.document_type
  ),
  -- Geldende versie per document = die van de laatste acceptatie; voedt het
  -- juridische blok.
  juridisch_geldend as (
    select distinct on (la.document_type)
           la.document_type, la.document_version, la.accepted_at
    from public.legal_acceptances la
    where la.school_id = p_school_id
    order by la.document_type, la.accepted_at desc
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
        'id', d.id, 'naam', d.name, 'is_internal', d.is_internal, 'status', d.status,
        'aangemaakt', d.created_at, 'email', d.email, 'telefoon', d.phone,
        'adres', d.address, 'postcode', d.postal_code, 'plaats', d.city,
        'land', d.country_code, 'rechtsvorm', d.legal_form, 'kvk', d.kvk_number,
        'btw', d.btw_number, 'iban_ingevuld', d.iban is not null and d.iban <> '',
        'website', d.website, 'logo', d.logo_url is not null,
        'registratie_slug', d.registration_slug, 'registratie_open', d.registration_enabled,
        'welkomstmail', d.welcome_email_sent_at, 'plango_import', d.plango_imported_at
      ) from d),

    -- Instructeurs zonder namen: rol, status en activiteit zijn wat support
    -- nodig heeft. Zie de niveaugrens in migratie 20260803160000.
    'instructeurs', (select coalesce(jsonb_agg(jsonb_build_object(
        'rol', instr.school_role, 'status', instr.status, 'toegevoegd', instr.created_at,
        'account_bevestigd', (select u.email_confirmed_at from auth.users u where u.id = instr.user_id),
        'laatste_activiteit', greatest(
          (select max(coalesce(s.refreshed_at, s.created_at)) from auth.sessions s where s.user_id = instr.user_id),
          (select u.last_sign_in_at from auth.users u where u.id = instr.user_id)
        )
      ) order by instr.created_at), '[]'::jsonb) from instr),

    'juridisch', (select coalesce(jsonb_agg(jsonb_build_object(
        'document', juridisch_geldend.document_type,
        'versie', juridisch_geldend.document_version,
        'wanneer', juridisch_geldend.accepted_at
      ) order by juridisch_geldend.document_type), '[]'::jsonb) from juridisch_geldend),

    'abonnement', (select case when abo.stripe_status is null then null else jsonb_build_object(
        'status', abo.stripe_status, 'plan', abo.plan, 'gestart', abo.created_at,
        'loopt_tot', abo.current_period_end) end from abo),

    'cbr', (select case when cbr_status.laatste is null and not exists (select 1 from cbr_koppeling)
                        then null else jsonb_build_object(
        'koppeling', (select case when cbr_koppeling.is_enabled then 'aan' else 'uit' end from cbr_koppeling),
        'connectie_status', (select cbr_koppeling.connection_status from cbr_koppeling),
        'laatste_fout', (select cbr_koppeling.last_sync_error from cbr_koppeling),
        'gewijzigd', (select cbr_koppeling.updated_at from cbr_koppeling),
        'laatste', cbr_status.laatste, 'laatste_geslaagd', cbr_status.laatste_ok,
        'runs_7d', cbr_status.runs_7d, 'mislukt_7d', cbr_status.mislukt_7d
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
      -- De laatste van de eerste keren: pas als alle drie de documenten ooit
      -- zijn geaccepteerd, is deze stap gezet.
      jsonb_build_object('sleutel','voorwaarden','label','Voorwaarden, privacy en verwerkersovereenkomst',
        'wanneer', (select max(wanneer) from juridisch_eerste), 'blokkerend', false),
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
  'Niveau 0 schooldetail: profiel, onboardingstappen met tijdstippen (eerste '
  'keer), juridische acceptaties (geldende versie), CBR-koppelingstoestand en '
  'instructeurs zonder namen. Bevat geen persoonsgegevens van leerlingen of '
  'instructeurs — zie de niveaugrens in migratie 20260803160000.';

revoke execute on function public.support_school_detail(uuid) from public, anon, authenticated;
grant execute on function public.support_school_detail(uuid) to service_role;
