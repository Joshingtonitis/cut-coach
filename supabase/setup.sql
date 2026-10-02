-- Pinche Güey: one-time Supabase setup.
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- Safe to run more than once.

-- Every piece of app data is a "record": e:YYYY-MM-DD (a day's log), m:YYYY-MM-DD
-- (mood check-ins), p:goals, p:settings, f:YYYY-MM-DD (progress photo info; the image
-- itself is in the "photos" storage bucket). updated_ms is when it last changed on a
-- device; the newer change wins when two devices disagree.
create table if not exists public.records (
  user_id    uuid    not null default auth.uid() references auth.users(id) on delete cascade,
  key        text    not null,
  data       jsonb,
  updated_ms bigint  not null,
  deleted    boolean not null default false,
  primary key (user_id, key)
);

-- Row-level security: each signed-in user can only see and change their own rows.
alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private bucket for progress photos, stored as <user id>/<date>.jpg.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;

drop policy if exists "own photos select" on storage.objects;
drop policy if exists "own photos insert" on storage.objects;
drop policy if exists "own photos update" on storage.objects;
drop policy if exists "own photos delete" on storage.objects;
create policy "own photos select" on storage.objects for select
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos insert" on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos update" on storage.objects for update
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos delete" on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
