-- Printerlogboek alpha: schema zoals toegepast op Supabase-project "nonstop"
-- (migraties alpha_schema + private_helpers). Alleen ter documentatie; niet opnieuw uitvoeren op hetzelfde project.

create schema if not exists private;
grant usage on schema private to authenticated;

create table public.members (
  email text primary key check (email = lower(email)),
  name text not null,
  role text not null default 'operator' check (role in ('operator','beheer')),
  created_at timestamptz not null default now()
);

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.email = lower(coalesce(auth.jwt()->>'email','')));
$$;
create or replace function private.is_beheer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.email = lower(coalesce(auth.jwt()->>'email','')) and m.role = 'beheer');
$$;
create or replace function private.member_name() returns text
language sql stable security definer set search_path = '' as $$
  select m.name from public.members m where m.email = lower(coalesce(auth.jwt()->>'email',''));
$$;
grant execute on function private.is_member(), private.is_beheer(), private.member_name() to authenticated;

create table public.machines (
  id text primary key, name text not null, type text not null default '',
  service_org text not null default '', service_channel text not null default '', sort int not null default 0
);

create table public.testprints (
  id bigint generated always as identity primary key,
  machine_id text not null references public.machines(id),
  result text not null default 'pending' check (result in ('pending','ok','warn','bad')),
  photo_path text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), by_name text
);

create table public.issues (
  id bigint generated always as identity primary key,
  machine_id text not null references public.machines(id),
  title text not null check (length(title) between 1 and 200),
  description text not null default '',
  severity text not null default 'middel' check (severity in ('hoog','middel','laag')),
  status text not null default 'Open' check (status in ('Open','In behandeling','Opgelost')),
  solution text, solution_type text check (solution_type in ('intern','monteur')),
  solved_by_name text, solved_at timestamptz,
  source text not null default 'app' check (source in ('app','whatsapp')),
  escalated_to text, escalated_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), by_name text
);

create table public.issue_notes (
  id bigint generated always as identity primary key,
  issue_id bigint not null references public.issues(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  kind text check (kind in ('esc','monteur','chat')),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), by_name text
);

create table public.messages (
  id bigint generated always as identity primary key,
  machine_id text not null references public.machines(id),
  body text not null check (length(body) between 1 and 4000),
  worked boolean not null default false,
  issue_id bigint references public.issues(id) on delete set null,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), by_name text
);

-- triggers: auteur en tijd door de server
create or replace function private.stamp_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := auth.uid();
  new.by_name := coalesce(private.member_name(), 'Onbekend');
  new.created_at := now();
  return new;
end $$;
create or replace function private.stamp_solution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.solution is distinct from old.solution and new.solution is not null then
    new.solved_by_name := coalesce(private.member_name(), 'Onbekend'); new.solved_at := now();
  end if;
  if new.escalated_to is distinct from old.escalated_to and new.escalated_to is not null then
    new.escalated_at := now();
  end if;
  new.created_by := old.created_by; new.by_name := old.by_name; new.created_at := old.created_at;
  return new;
end $$;
-- (triggers op testprints, issues, issue_notes, messages; zie migratie alpha_schema)

-- RLS: alleen leden lezen en schrijven, beheer mag verwijderen en machines/leden wijzigen.
-- Kolomrechten: testprints(result), messages(worked, issue_id),
-- issues(title, description, severity, status, solution, solution_type, escalated_to).
-- Opslag: privé bucket "testprints" (max 5 MB, jpg/png/webp), lezen en uploaden alleen voor leden.
