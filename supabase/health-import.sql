-- Pinche Güey: Apple Health import (calories + protein from MyFitnessPal via a Shortcut).
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- Safe to run more than once. Needs setup.sql to have been run first.
--
-- How it works: the app creates a random "import key" and stores only its SHA-256 hash
-- here. An iPhone Shortcut sends the key plus today's totals to ingest_nutrition(), which
-- finds whose key it is and merges calories/protein into that day's log record. Other
-- fields (weight, plan, debrief…) are left alone, and the newer timestamp makes every
-- signed-in device pick the change up on its next sync.

create extension if not exists pgcrypto with schema extensions;

-- One import key per account (only the hash is stored, never the key itself).
create table if not exists public.ingest_keys (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  key_hash   text not null unique,
  created_at timestamptz not null default now()
);
alter table public.ingest_keys enable row level security;
drop policy if exists "own ingest key" on public.ingest_keys;
create policy "own ingest key" on public.ingest_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Called by the Shortcut. "security definer" lets it write the row for the key's owner
-- even though the Shortcut isn't signed in; the key check is what protects it.
create or replace function public.ingest_nutrition(
  p_key text, p_date text, p_calories numeric default null, p_protein numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid  uuid;
  rkey text;
  cur  jsonb;
  ms   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'p_date must look like 2026-10-04';
  end if;
  select user_id into uid from public.ingest_keys
    where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if uid is null then
    raise exception 'invalid import key';
  end if;

  rkey := 'e:' || p_date;
  select data into cur from public.records where user_id = uid and key = rkey and not deleted;
  cur := coalesce(cur, jsonb_build_object('date', p_date, 'weight', null, 'steps', null, 'onPlan', null));
  -- 0 or missing means Health had nothing for that day yet, so leave the field as it was.
  if p_calories is not null and p_calories > 0 then cur := cur || jsonb_build_object('calories', round(p_calories)); end if;
  if p_protein  is not null and p_protein  > 0 then cur := cur || jsonb_build_object('protein',  round(p_protein));  end if;
  cur := cur || jsonb_build_object('date', p_date);

  insert into public.records (user_id, key, data, updated_ms, deleted)
    values (uid, rkey, cur, ms, false)
  on conflict (user_id, key) do update
    set data = excluded.data, updated_ms = excluded.updated_ms, deleted = false;

  return jsonb_build_object('ok', true, 'date', p_date, 'calories', cur->'calories', 'protein', cur->'protein');
end
$$;

revoke all on function public.ingest_nutrition(text, text, numeric, numeric) from public;
grant execute on function public.ingest_nutrition(text, text, numeric, numeric) to anon, authenticated;
