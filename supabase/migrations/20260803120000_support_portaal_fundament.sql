-- Support-portaal — fundament (niveau 0)
--
-- Waarom deze migratie bestaat
-- ----------------------------
-- Ribba levert support aan rijscholen. Tot nu toe gebeurde dat zonder eigen
-- gereedschap: de enige "admin"-pagina (/admin/plango-import) autoriseert op
-- een hardcoded e-mailadres in de code. Dat schaalt niet en het laat geen
-- spoor na.
--
-- Deze migratie legt het fundament voor een supportportaal met drie
-- eigenschappen die vanaf de eerste dag moeten kloppen:
--
--   1. Toegang is DATA, geen code. Wie support mag doen staat in
--      platform_staff, niet in een if-statement. Iemand toevoegen of
--      intrekken is een rij, geen deploy.
--   2. Elke inzage laat een spoor na (platform_access_log). De
--      verwerkersovereenkomst (art. 7.3) belooft rijscholen expliciet
--      "monitoring en logging van toegang tot systemen". Dit is die belofte,
--      uitgevoerd.
--   3. Wat "niveau 0" precies is, bepaalt de DATABASE, niet de applicatie.
--      support_school_overview() geeft uitsluitend gegevens over de rijschool
--      zelf en aantallen — nul persoonsgegevens van leerlingen. De applicatie
--      kan er dus niet per ongeluk meer uit halen dan is afgesproken.
--
-- Niveau 1 (gepseudonimiseerde leerlinggegevens) en niveau 2 (identificeerbaar,
-- op verzoek van de rijschool) komen later en krijgen een eigen slot: toegang
-- bestaat dan alleen zolang er een sessie met reden en vervaltijd openstaat.
-- Die tabellen zitten bewust NIET in deze migratie.
--
-- Geen enkele bestaande tabel wordt gewijzigd. Terugdraaien = beide tabellen
-- en de twee functies droppen; niets in de app of bij klanten hangt eraan.

-- ---------------------------------------------------------------------------
-- 1. Wie mag support doen
-- ---------------------------------------------------------------------------

create table if not exists public.platform_staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'support' check (role in ('support')),
  active     boolean not null default true,
  note       text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.platform_staff is
  'Ribba-medewerkers met toegang tot het supportportaal. Bewust leeg na deze '
  'migratie: toegang verlenen is een aparte, bewuste handeling.';
comment on column public.platform_staff.revoked_at is
  'Ingevuld = toegang ingetrokken. We verwijderen de rij niet, zodat het '
  'toegangslogboek herleidbaar blijft naar een bekende persoon.';

alter table public.platform_staff enable row level security;

-- Bewust GEEN policies: anon en authenticated komen er nooit bij. Alleen de
-- serverlaag (service_role, die RLS omzeilt) leest deze tabel. Een ingelogde
-- gebruiker kan dus niet eens zien of hij zelf in de tabel staat.

-- ---------------------------------------------------------------------------
-- 2. Het logboek
-- ---------------------------------------------------------------------------

create table if not exists public.platform_access_log (
  id               uuid primary key default gen_random_uuid(),
  at               timestamptz not null default now(),
  staff_user_id    uuid not null,
  staff_email      text,
  action           text not null,
  level            smallint not null check (level between 0 and 2),
  result           text not null default 'ok' check (result in ('ok', 'denied', 'error')),
  target_type      text,
  target_school_id uuid,
  target_student_id uuid,
  reason           text,
  ip               text,
  user_agent       text,
  meta             jsonb
);

comment on table public.platform_access_log is
  'Onwijzigbaar spoor van elke supporthandeling. Ook mislukte en geweigerde '
  'pogingen worden vastgelegd (result), want juist die zijn interessant.';
comment on column public.platform_access_log.level is
  '0 = geen persoonsgegevens van leerlingen, 1 = gepseudonimiseerd, '
  '2 = identificeerbaar (alleen op verzoek van de rijschool).';
comment on column public.platform_access_log.staff_user_id is
  'Bewust GEEN foreign key: het logboek moet een verwijderd account overleven. '
  'staff_email is om dezelfde reden een momentopname, geen verwijzing.';

create index if not exists platform_access_log_at_idx
  on public.platform_access_log (at desc);
create index if not exists platform_access_log_school_idx
  on public.platform_access_log (target_school_id, at desc)
  where target_school_id is not null;
create index if not exists platform_access_log_staff_idx
  on public.platform_access_log (staff_user_id, at desc);

alter table public.platform_access_log enable row level security;
-- Idem: geen policies, alleen de serverlaag.

-- Append-only, óók voor service_role.
--
-- RLS beschermt hier niets: de serverlaag draait met service_role en omzeilt
-- RLS per definitie. Zonder deze trigger zou dezelfde sleutel waarmee we
-- loggen ook het logboek kunnen opschonen — en dan is het geen bewijs meer,
-- maar een verhaal. Een trigger geldt voor iedereen die via SQL binnenkomt.
create or replace function public.platform_access_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'platform_access_log is append-only (poging: %)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists platform_access_log_no_change on public.platform_access_log;
create trigger platform_access_log_no_change
  before update or delete on public.platform_access_log
  for each row execute function public.platform_access_log_append_only();

-- ---------------------------------------------------------------------------
-- 3. Hulpfunctie: is deze gebruiker supportmedewerker?
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_staff(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.platform_staff
    where user_id = p_user_id
      and active
      and revoked_at is null
  );
$$;

comment on function public.is_platform_staff(uuid) is
  'Enige plek waar "mag deze gebruiker support doen" wordt beantwoord. '
  'Straks ook de basis voor de RLS-policies van niveau 1 en 2.';

revoke execute on function public.is_platform_staff(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_staff(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Niveau 0: het scholenoverzicht
-- ---------------------------------------------------------------------------
--
-- Wat hier WEL in zit: gegevens van de rijschool als klant van Ribba
-- (bedrijfsgegevens, configuratie, aantallen, abonnement, activiteit).
-- Wat hier bewust NIET in zit: namen, e-mailadressen, telefoonnummers of
-- welk ander gegeven dan ook van leerlingen of instructeurs.
--
-- Activiteit wordt gemeten op auth.sessions.refreshed_at (en created_at als
-- terugval). NIET op users.last_sign_in_at: dat veld bevriest na de eerste
-- login en zou elke terugkerende gebruiker als "stil" aanmerken.

create or replace function public.support_school_overview()
returns table (
  school_id            uuid,
  school_name          text,
  city                 text,
  status               text,
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
           max(coalesce(s.refreshed_at, s.created_at)) as laatste
    from instr
    join auth.sessions s on s.user_id = instr.user_id
    group by instr.drivingschool_id
  )
  select
    d.id,
    d.name,
    d.city,
    d.status,
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
    (select a.laatste from activiteit a where a.drivingschool_id = d.id),
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
  order by d.created_at desc;
$$;

comment on function public.support_school_overview() is
  'Niveau 0 voor het supportportaal: rijschoolgegevens, configuratie en '
  'aantallen. Bevat per contract geen persoonsgegevens van leerlingen — de '
  'database bepaalt hier de grens, niet de applicatie.';

revoke execute on function public.support_school_overview() from public, anon, authenticated;
grant execute on function public.support_school_overview() to service_role;
