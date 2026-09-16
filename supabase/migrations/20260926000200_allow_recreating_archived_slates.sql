-- Archived slates should not block creation of a new slate
-- for the same league, sport, and external event.

DROP INDEX IF EXISTS public.slates_league_sport_external_event_id_unique;

CREATE UNIQUE INDEX slates_league_sport_external_event_id_unique
ON public.slates (league_id, sport, external_event_id)
WHERE external_event_id IS NOT NULL
  AND archived_at IS NULL;
