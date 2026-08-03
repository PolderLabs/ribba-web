-- Supportportaal — interne rijscholen apart zetten en de activiteitsmeting repareren
--
-- Twee dingen die het scholenoverzicht bruikbaar maken.
--
-- 1. INTERNE RIJSCHOLEN
--    Van de tien rijscholen in het overzicht zijn er vier van onszelf: een
--    testschool, een tweede test, een pilot en een ketentest. Die staan het
--    zicht op de echte klanten in de weg.
--
--    Bewust een kolom en geen naamfilter op '[TEST]' of 'Test'. Een naamfilter
--    is een heuristiek: hij werkt tot de dag dat een echte rijschool "Rijschool
--    Testrit" heet en stilletjes uit beeld verdwijnt — precies het soort fout
--    dat je pas merkt als die klant belt. Een kolom is een expliciet contract.
--
--    De kolom staat op drivingschools en niet in het supportportaal, omdat
--    "dit is onze eigen testomgeving" een eigenschap van de rijschool is. Ook
--    de engagement-signalering en toekomstige rapportages hebben er iets aan.
--
-- 2. ACTIVITEITSMETING
--    De vorige versie keek alleen naar auth.sessions. Gemeten op 3 aug 2026:
--    010 Rijbewijs (843 lessen, 55 leerlingen) had NUL sessierijen en kwam in
--    het overzicht binnen als "nooit actief", terwijl ze de dag ervoor om
--    10:08 hadden ingelogd. Sessies verdwijnen namelijk bij uitloggen en bij
--    verlopen.
--
--    Andersom klopt last_sign_in_at ook niet: Het Zwaantje logde voor het
--    laatst in op 12 juli maar ververst zijn sessie dagelijks. Dat veld staat
--    stil zolang iemand ingelogd blijft.
--
--    Daarom de hoogste van drie signalen: sessieactiviteit, laatste echte
--    login, en de laatste aangemaakte les. Die derde is menselijk gedrag —
--    een les plan je niet per ongeluk.
--
--    NIET gebruikt: lessons.updated_at. Dat veld stond bij alle drie de
--    gemeten scholen op 2 aug 20:00, binnen twintig seconden van elkaar. Dat
--    is de cron auto_complete_past_lessons die elke vijf minuten draait — die
--    meet onze eigen automatisering, niet de rijschool.

-- ---------------------------------------------------------------------------
-- 1. Interne rijscholen markeren
-- ---------------------------------------------------------------------------

alter table public.drivingschools
  add column if not exists is_internal boolean not null default false;

comment on column public.drivingschools.is_internal is
  'true = eigen test-, pilot- of ketentestomgeving van Ribba, geen klant. '
  'Standaard verborgen in het supportportaal. Expliciet gezet, nooit afgeleid '
  'uit de naam.';

update public.drivingschools set is_internal = true
where id in (
  '0218195e-e6a9-403d-953d-c9cb5501f834',  -- [TEST] Önder Test-rijschool
  'bf561cc3-2c18-4bec-975b-3ae70f7a5566',  -- Test rijschool ates
  '8df4cd3c-2be5-4177-b5b0-9bfd58ccea22',  -- [PILOT] Mailketen Rijschool
  '14c25727-ae8a-4e15-b8b5-a9dc5355d4c6'   -- [E2E] Ketentest Rijschool
);

-- ---------------------------------------------------------------------------
-- 2. Overzicht: filter + betere activiteitsmeting
-- ---------------------------------------------------------------------------
--
-- De parameter maakt van de nulargument-versie een aparte functie, dus die
-- moet eerst weg — anders is een aanroep zonder argumenten dubbelzinnig.

drop function if exists public.support_school_overview();

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
