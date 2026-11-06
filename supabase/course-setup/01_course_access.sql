-- COURSE COPY ONLY. Not a production migration.
--
-- The teaching snapshot enables row-level security on the study tables but ships
-- no access rules for them, so a normal signed-in participant sees no studies and
-- cannot vote. These rules restore what funnystudy needs, and no more: a user can
-- read studies and captions, and can read/write only their OWN votes and saves.
--
-- Safe to re-run. Run it in your own new Supabase project's SQL editor (or via psql).

-- Studies: participants can read studies that aren't hidden. (Private studies are
-- still reachable by id, which is how the app links to them.)
drop policy if exists "Participants can read visible studies" on public.studies;
create policy "Participants can read visible studies"
  on public.studies for select to authenticated
  using (is_hidden = false);

-- Which captions belong to which study.
drop policy if exists "Participants can read study caption mappings" on public.study_caption_mappings;
create policy "Participants can read study caption mappings"
  on public.study_caption_mappings for select to authenticated
  using (true);

-- Vote events: own rows only. (delete is used by the app to undo a failed save.)
drop policy if exists "Participants read own vote events" on public.study_caption_vote_events;
create policy "Participants read own vote events"
  on public.study_caption_vote_events for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "Participants add own vote events" on public.study_caption_vote_events;
create policy "Participants add own vote events"
  on public.study_caption_vote_events for insert to authenticated
  with check (profile_id = (select auth.uid()) and created_by_user_id = (select auth.uid()));

drop policy if exists "Participants delete own vote events" on public.study_caption_vote_events;
create policy "Participants delete own vote events"
  on public.study_caption_vote_events for delete to authenticated
  using (profile_id = (select auth.uid()));

-- Legacy votes and saves written alongside study votes: own rows only.
drop policy if exists "Participants manage own caption votes" on public.caption_votes;
create policy "Participants manage own caption votes"
  on public.caption_votes for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "Participants manage own caption saves" on public.caption_saves;
create policy "Participants manage own caption saves"
  on public.caption_saves for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

select pg_notify('pgrst', 'reload schema');
