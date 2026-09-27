-- =====================================================================
--  Mis Notas · esquema para Supabase
--  Ejecuta este archivo completo en: Supabase → SQL Editor → New query → Run
--  Solo se guarda JSON (proyectos, anotaciones y agenda). Los PDF, fotos,
--  videos y audios se quedan en el dispositivo donde se capturaron.
-- =====================================================================

create or replace function public.misnotas_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Proyectos de validación ----------
create table if not exists public.validation_projects (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null,
  data              jsonb       not null default '{}'::jsonb,
  deleted           boolean     not null default false,
  client_updated_at bigint      not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists validation_projects_sync_idx on public.validation_projects (user_id, updated_at);

drop trigger if exists validation_projects_touch on public.validation_projects;
create trigger validation_projects_touch before insert or update on public.validation_projects
  for each row execute function public.misnotas_touch_updated_at();

alter table public.validation_projects enable row level security;
drop policy if exists "vp_select_own" on public.validation_projects;
drop policy if exists "vp_insert_own" on public.validation_projects;
drop policy if exists "vp_update_own" on public.validation_projects;
drop policy if exists "vp_delete_own" on public.validation_projects;
create policy "vp_select_own" on public.validation_projects for select to authenticated using (auth.uid() = user_id);
create policy "vp_insert_own" on public.validation_projects for insert to authenticated with check (auth.uid() = user_id);
create policy "vp_update_own" on public.validation_projects for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vp_delete_own" on public.validation_projects for delete to authenticated using (auth.uid() = user_id);

-- ---------- Notas de la agenda ----------
create table if not exists public.agenda_notes (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null,
  data              jsonb       not null default '{}'::jsonb,
  deleted           boolean     not null default false,
  client_updated_at bigint      not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists agenda_notes_sync_idx on public.agenda_notes (user_id, updated_at);

drop trigger if exists agenda_notes_touch on public.agenda_notes;
create trigger agenda_notes_touch before insert or update on public.agenda_notes
  for each row execute function public.misnotas_touch_updated_at();

alter table public.agenda_notes enable row level security;
drop policy if exists "an_select_own" on public.agenda_notes;
drop policy if exists "an_insert_own" on public.agenda_notes;
drop policy if exists "an_update_own" on public.agenda_notes;
drop policy if exists "an_delete_own" on public.agenda_notes;
create policy "an_select_own" on public.agenda_notes for select to authenticated using (auth.uid() = user_id);
create policy "an_insert_own" on public.agenda_notes for insert to authenticated with check (auth.uid() = user_id);
create policy "an_update_own" on public.agenda_notes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "an_delete_own" on public.agenda_notes for delete to authenticated using (auth.uid() = user_id);
