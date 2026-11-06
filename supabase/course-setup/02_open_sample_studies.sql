-- COURSE COPY ONLY. The snapshot was taken on 2026-10-19 and every study in it has
-- already ended, so the home page says "No active studies". This re-opens two of the
-- biggest ones (330 and 320 captions) for local development. Safe to re-run.

update public.studies
set start_datetime_utc = now() - interval '1 day',
    end_datetime_utc   = now() + interval '90 days'
where id in (3, 4)
  and is_private = false;
