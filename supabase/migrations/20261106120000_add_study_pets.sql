-- Study pet: one small creature per participant.
--
-- Only the pet's identity is stored. How hungry or sick it is gets worked out from
-- what the participant already did (study_caption_navigation_events), so there is no
-- second copy of "last fed" that could drift out of sync with their real activity.

create table public.pets (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 20),
  adopted_at  timestamptz not null default now(),
  modified_at timestamptz not null default now()
);

alter table public.pets enable row level security;

create policy "Owners can read their pet"
  on public.pets for select to authenticated
  using (profile_id = (select auth.uid()));

create policy "Owners can adopt a pet"
  on public.pets for insert to authenticated
  with check (profile_id = (select auth.uid()));

create policy "Owners can rename their pet"
  on public.pets for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

revoke all on public.pets from anon;
grant select, insert, update on public.pets to authenticated;

-- Latest captions per person, newest first, for working out the pet's mood.
create index if not exists study_caption_navigation_events_profile_recent_idx
  on public.study_caption_navigation_events (profile_id, created_datetime_utc desc);
