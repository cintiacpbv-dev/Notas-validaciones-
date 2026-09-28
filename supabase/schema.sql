-- =====================================================================
--  Mis Notas · esquema para Supabase (uso personal, sin inicio de sesión)
--  Ejecuta este archivo completo en: Supabase → SQL Editor → New query → Run
--  Se guardan: proyectos y observaciones (JSON), notas de la agenda (JSON)
--  y los PDF de cada proyecto (Storage, bucket privado "documentos").
--  Las fotos, videos y audios se quedan en el dispositivo donde se capturaron.
--  Puedes volver a ejecutarlo sin problema: no borra datos.
--
--  La app usa la clave pública (anon) sin iniciar sesión, así que quien tenga
--  esa clave puede leer y escribir estos datos. Está pensado para uso personal.
-- =====================================================================

create or replace function public.misnotas_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Proyectos de validación ----------
create table if not exists public.mn_proyectos (
  id                text        primary key,
  data              jsonb       not null default '{}'::jsonb,
  deleted           boolean     not null default false,
  client_updated_at bigint      not null default 0,
  updated_at        timestamptz not null default now()
);
create index if not exists mn_proyectos_sync_idx on public.mn_proyectos (updated_at);
drop trigger if exists mn_proyectos_touch on public.mn_proyectos;
create trigger mn_proyectos_touch before insert or update on public.mn_proyectos
  for each row execute function public.misnotas_touch_updated_at();

-- ---------- Notas de la agenda ----------
create table if not exists public.mn_agenda (
  id                text        primary key,
  data              jsonb       not null default '{}'::jsonb,
  deleted           boolean     not null default false,
  client_updated_at bigint      not null default 0,
  updated_at        timestamptz not null default now()
);
create index if not exists mn_agenda_sync_idx on public.mn_agenda (updated_at);
drop trigger if exists mn_agenda_touch on public.mn_agenda;
create trigger mn_agenda_touch before insert or update on public.mn_agenda
  for each row execute function public.misnotas_touch_updated_at();

-- Acceso directo desde la app (sin inicio de sesión)
alter table public.mn_proyectos enable row level security;
alter table public.mn_agenda enable row level security;
drop policy if exists "mn_proyectos_app" on public.mn_proyectos;
drop policy if exists "mn_agenda_app" on public.mn_agenda;
create policy "mn_proyectos_app" on public.mn_proyectos for all to anon, authenticated using (true) with check (true);
create policy "mn_agenda_app" on public.mn_agenda for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.mn_proyectos, public.mn_agenda to anon, authenticated;

-- ---------- PDF de los proyectos (Supabase Storage) ----------
-- Límite de 50 MB por archivo (máximo del plan gratuito).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "docs_app_select" on storage.objects;
drop policy if exists "docs_app_insert" on storage.objects;
drop policy if exists "docs_app_update" on storage.objects;
drop policy if exists "docs_app_delete" on storage.objects;
create policy "docs_app_select" on storage.objects for select to anon, authenticated using (bucket_id = 'documentos');
create policy "docs_app_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'documentos');
create policy "docs_app_update" on storage.objects for update to anon, authenticated using (bucket_id = 'documentos') with check (bucket_id = 'documentos');
create policy "docs_app_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'documentos');

-- ---------- Datos de versiones anteriores (si existían) ----------
-- Copia lo que se hubiera guardado con las versiones que usaban cuenta o código de espacio.
do $$
begin
  if to_regclass('public.espacio_validation_projects') is not null then
    insert into public.mn_proyectos (id, data, deleted, client_updated_at)
    select id, data, deleted, client_updated_at from public.espacio_validation_projects
    on conflict (id) do nothing;
  end if;
  if to_regclass('public.espacio_agenda_notes') is not null then
    insert into public.mn_agenda (id, data, deleted, client_updated_at)
    select id, data, deleted, client_updated_at from public.espacio_agenda_notes
    on conflict (id) do nothing;
  end if;
  if to_regclass('public.validation_projects') is not null then
    insert into public.mn_proyectos (id, data, deleted, client_updated_at)
    select id, data, deleted, client_updated_at from public.validation_projects
    on conflict (id) do nothing;
  end if;
  if to_regclass('public.agenda_notes') is not null then
    insert into public.mn_agenda (id, data, deleted, client_updated_at)
    select id, data, deleted, client_updated_at from public.agenda_notes
    on conflict (id) do nothing;
  end if;
end $$;
