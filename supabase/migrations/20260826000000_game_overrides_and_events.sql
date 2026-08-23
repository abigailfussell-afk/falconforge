-- ============================================================================
-- D4(b) — per-team overrides on a curated template
-- D2    — competition events, with matches, and participants as ROWS
-- ============================================================================
--
-- Both land now because both are schema, and the schema freezes when beta teams onboard in
-- September 2026. After that it is forward migrations on live data; before it, this is free.

-- ---------------------------------------------------------------------------
-- 1. seasons: which game, and which version of it
-- ---------------------------------------------------------------------------
--
-- P-01 phase S. `game_title` is a free-text label a coach typed; it is not an identity, so the
-- app cannot use it to decide which form to render without guessing from a string. These two
-- columns are the identity.
--
-- `game_snapshot` is deliberately NOT here. FEAT §2b proposes freezing the resolved definition
-- onto the season row so an archived season renders its own game for ever, and that is right —
-- it is phase M, and phase S's exit criterion says so in as many words. What phase S buys is
-- that a season created from today on RECORDS which template it used, so the snapshot can be
-- back-filled from the bundle rather than guessed.

ALTER TABLE seasons
    ADD COLUMN IF NOT EXISTS game_definition_id text,
    ADD COLUMN IF NOT EXISTS game_definition_version integer;

COMMENT ON COLUMN seasons.game_definition_id IS
    'Which bundled GameDefinition this season plays (src/games/<id>.json). NULL for seasons '
    'created before P-01; those fall back to matching game_title, then to the newest bundle.';

-- ---------------------------------------------------------------------------
-- 2. team_game_overrides — add a field, hide a field, relabel a field
-- ---------------------------------------------------------------------------
--
-- D4(b), Kevin 2026-08-23: "curated templates plus light per-team overrides ... Not (c): no
-- form builder. Field *types* stay ours."
--
-- SEASON-SCOPED, WHICH IS THE HALF THAT NEEDED DECIDING. The decision says the patch "must
-- survive a season roll the same way sub-team structure does — a team that customised its
-- DECODE form does not want it silently carried into BIOBUZZ, nor silently lost". So:
--
--   * one row per (team, season), with the composite FK every season-scoped table here uses;
--   * `base_definition_id` recorded ON THE PATCH, so a patch written against DECODE is
--     recognisably not a patch against BIOBUZZ;
--   * the rollover COPIES it forward and the wizard says it has (client-side, like the
--     sub-team clone) rather than the database carrying it silently.
--
-- The alternative — team-scoped, one patch for ever — is the "silently carried into a new game"
-- half of what D4 rules out, and it cannot express a team that customised one season and not
-- the next.

CREATE TABLE IF NOT EXISTS team_game_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id uuid NOT NULL,
    /* Which template this patch was written against. A patch is only meaningful next to one. */
    base_definition_id text NOT NULL,
    base_version integer,
    /*
     * { add: [{section, field}], hide: [key], relabel: {key: label} }
     *
     * Validated by the CLIENT (`game-definition.ts` / `scouting-validation.ts`) and rendered
     * defensively: `resolveGame` returns the base unchanged for a malformed patch rather than
     * throwing, because a form that refuses to render takes the scouting screen down at a
     * venue and the base is always a correct answer. The database's job here is the tenant
     * boundary and the shape, not the semantics.
     */
    patch jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, season_id),
    FOREIGN KEY (season_id, team_id) REFERENCES seasons (id, team_id) ON DELETE CASCADE,
    CONSTRAINT team_game_overrides_patch_is_object
        CHECK (jsonb_typeof(patch) = 'object')
);

ALTER TABLE team_game_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_game_overrides_select ON team_game_overrides;
CREATE POLICY team_game_overrides_select ON team_game_overrides
    FOR SELECT USING (is_team_member(team_id));

/*
 * WRITES ARE `can_manage_structure`, NOT `can_manage_content`.
 *
 * A patch changes the form every scout on the team types into, and `can_manage_content` means
 * "any approved member" (D8, decided (a) on 2026-08-23) — so content permissions would let any
 * student hide a field mid-competition for everybody. Structure is the capability that already
 * means "decides how the team is organised" (sub-teams, seasons), which is what this is.
 *
 * `team_can_write` and `season_is_open` for the same reasons every other content table has
 * them: a lapsed team and an archived season are read-only, and a form patch is a write.
 */
DROP POLICY IF EXISTS team_game_overrides_write ON team_game_overrides;
CREATE POLICY team_game_overrides_write ON team_game_overrides
    FOR ALL
    USING (can_manage_structure(team_id) AND team_can_write(team_id) AND season_is_open(season_id, team_id))
    WITH CHECK (can_manage_structure(team_id) AND team_can_write(team_id) AND season_is_open(season_id, team_id));

CREATE INDEX IF NOT EXISTS team_game_overrides_season_idx
    ON team_game_overrides (team_id, season_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_game_overrides TO authenticated;

DROP TRIGGER IF EXISTS update_team_game_overrides_updated_at ON team_game_overrides;
CREATE TRIGGER update_team_game_overrides_updated_at
    BEFORE UPDATE ON team_game_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. competition_events — D2
-- ---------------------------------------------------------------------------
--
-- Kevin, 2026-08-23: "(b), and more than (b) — paste/parse PLUS full manual entry PLUS editing
-- after the fact. FalconForge never calls the API."
--
-- WHY THIS IS A TABLE AND NOT `scouting_reports.event_name`. Today the event is free text on
-- each report, so two scouts typing "Michigan State Champs" and "MI State Championship" produce
-- two events, and there is nothing to hang a schedule off. The events entity is what makes
-- "which matches are we in, and against whom" answerable at all.

CREATE TABLE IF NOT EXISTS competition_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id uuid NOT NULL,
    name text NOT NULL CHECK (char_length(trim(name)) > 0),
    /*
     * FIRST's event code, e.g. `USMIDET1`. Free text and nullable: the coach may not know it,
     * and the app never uses it to fetch anything. It exists so a human can find the event's
     * public page again, and so a second paste against the same event is recognisable.
     */
    event_code text,
    /* Date-only, as text, deliberately. See the comment on the client type: a timestamptz
     * renders one day early at negative UTC offsets, which this project has already shipped
     * twice (failure-modes §10) and which for a competition DATE is the whole value. */
    starts_on date,
    ends_on date,
    location text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    FOREIGN KEY (season_id, team_id) REFERENCES seasons (id, team_id) ON DELETE CASCADE
);

/*
 * One match at one event.
 *
 * `match_number` and `phase` rather than a single label: a qualification 12 and an elimination
 * 12 are different matches, and sorting by a label puts "Qualification 10" before
 * "Qualification 9".
 */
CREATE TABLE IF NOT EXISTS event_matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    phase text NOT NULL DEFAULT 'qualification'
        CHECK (phase IN ('practice', 'qualification', 'playoff')),
    match_number integer NOT NULL CHECK (match_number >= 1),
    /* When it is scheduled. Nullable: a coach building the schedule by hand on the morning of
     * an event knows the order long before the times. */
    scheduled_at timestamptz,
    /* Filled in afterwards, by hand. Nullable, and NULL means "not played yet" rather than 0 —
     * failure-modes §4, which cost this project five corrupted production rows as B18. */
    red_score integer,
    blue_score integer,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    FOREIGN KEY (event_id, team_id) REFERENCES competition_events (id, team_id) ON DELETE CASCADE
);

/*
 * WHO IS IN A MATCH — AS ROWS, WHICH IS D3's KNOCK-ON AND D2's REQUIREMENT.
 *
 * The obvious shape is four columns, `red1 red2 blue1 blue2`. Kevin ruled it out for two
 * reasons and both are load-bearing:
 *
 *   1. "FRC is 3v3 and FTC is 2v2" (D3). Four columns encode FTC's alliance size into the
 *      schema, and `teams.program` exists precisely so that assumption stops being made.
 *   2. "Surrogates and mid-event schedule changes are routine, so an imported schedule that
 *      cannot be corrected is wrong by lunchtime" (D2). A surrogate is a team playing an extra
 *      match that does not count for them — which is a PROPERTY OF A PARTICIPATION, and a
 *      column layout has nowhere to put it.
 *
 * `team_number` is text, not a reference to `teams`: these are OTHER teams at the event, which
 * this platform has never heard of and never will.
 */
CREATE TABLE IF NOT EXISTS match_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    match_id uuid NOT NULL,
    alliance text NOT NULL CHECK (alliance IN ('red', 'blue')),
    /* 1-based within the alliance. Two for FTC, three for FRC; the schema does not care. */
    station integer NOT NULL CHECK (station >= 1 AND station <= 4),
    team_number text NOT NULL CHECK (char_length(trim(team_number)) BETWEEN 1 AND 5),
    /* Whatever the schedule called them. Kept because a coach recognises "Mechanical Mustangs"
     * faster than 22857, and because it is the parser's main check on its own work. */
    team_name text,
    /* A team playing a match that does not count for them. The reason participants are rows. */
    is_surrogate boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    UNIQUE (match_id, alliance, station),
    FOREIGN KEY (match_id, team_id) REFERENCES event_matches (id, team_id) ON DELETE CASCADE
);

-- --------------------------------------------------------------- RLS
--
-- Content tables, so the content capability and the two write gates every other one carries.
-- `can_manage_content` is "any approved member" — D8, answered (a) on 2026-08-23 and recorded
-- as deliberate rather than inherited. A student correcting a surrogate at a venue, or a match
-- number on a schedule that changed at lunchtime, is the case it is for.

ALTER TABLE competition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS competition_events_select ON competition_events;
CREATE POLICY competition_events_select ON competition_events
    FOR SELECT USING (is_team_member(team_id));

DROP POLICY IF EXISTS competition_events_write ON competition_events;
CREATE POLICY competition_events_write ON competition_events
    FOR ALL
    USING (can_manage_content(team_id) AND team_can_write(team_id) AND season_is_open(season_id, team_id))
    WITH CHECK (can_manage_content(team_id) AND team_can_write(team_id) AND season_is_open(season_id, team_id));

/*
 * Matches and participants have no `season_id` of their own — they hang off the event, which
 * has one. So `season_is_open` is checked THROUGH the event, which is also what stops a match
 * being attached to another team's event: the composite FK makes that impossible structurally,
 * and this makes it impossible by policy as well.
 */
DROP POLICY IF EXISTS event_matches_select ON event_matches;
CREATE POLICY event_matches_select ON event_matches
    FOR SELECT USING (is_team_member(team_id));

DROP POLICY IF EXISTS event_matches_write ON event_matches;
CREATE POLICY event_matches_write ON event_matches
    FOR ALL
    USING (
        can_manage_content(team_id) AND team_can_write(team_id)
        AND EXISTS (
            SELECT 1 FROM competition_events e
            WHERE e.id = event_matches.event_id AND e.team_id = event_matches.team_id
              AND season_is_open(e.season_id, e.team_id)
        )
    )
    WITH CHECK (
        can_manage_content(team_id) AND team_can_write(team_id)
        AND EXISTS (
            SELECT 1 FROM competition_events e
            WHERE e.id = event_matches.event_id AND e.team_id = event_matches.team_id
              AND season_is_open(e.season_id, e.team_id)
        )
    );

DROP POLICY IF EXISTS match_participants_select ON match_participants;
CREATE POLICY match_participants_select ON match_participants
    FOR SELECT USING (is_team_member(team_id));

DROP POLICY IF EXISTS match_participants_write ON match_participants;
CREATE POLICY match_participants_write ON match_participants
    FOR ALL
    USING (
        can_manage_content(team_id) AND team_can_write(team_id)
        AND EXISTS (
            SELECT 1 FROM event_matches m
            JOIN competition_events e ON e.id = m.event_id AND e.team_id = m.team_id
            WHERE m.id = match_participants.match_id AND m.team_id = match_participants.team_id
              AND season_is_open(e.season_id, e.team_id)
        )
    )
    WITH CHECK (
        can_manage_content(team_id) AND team_can_write(team_id)
        AND EXISTS (
            SELECT 1 FROM event_matches m
            JOIN competition_events e ON e.id = m.event_id AND e.team_id = m.team_id
            WHERE m.id = match_participants.match_id AND m.team_id = match_participants.team_id
              AND season_is_open(e.season_id, e.team_id)
        )
    );

CREATE INDEX IF NOT EXISTS competition_events_season_idx
    ON competition_events (team_id, season_id, starts_on);
CREATE INDEX IF NOT EXISTS event_matches_event_idx
    ON event_matches (team_id, event_id, phase, match_number);
CREATE INDEX IF NOT EXISTS match_participants_match_idx
    ON match_participants (team_id, match_id, alliance, station);
/* The question the whole entity exists to answer: "when do WE play?" */
CREATE INDEX IF NOT EXISTS match_participants_team_number_idx
    ON match_participants (team_id, team_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.competition_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_matches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_participants TO authenticated;

DROP TRIGGER IF EXISTS update_competition_events_updated_at ON competition_events;
CREATE TRIGGER update_competition_events_updated_at
    BEFORE UPDATE ON competition_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_matches_updated_at ON event_matches;
CREATE TRIGGER update_event_matches_updated_at
    BEFORE UPDATE ON event_matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_match_participants_updated_at ON match_participants;
CREATE TRIGGER update_match_participants_updated_at
    BEFORE UPDATE ON match_participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

/*
 * REPLICA IDENTITY FULL, and it is not optional.
 *
 * B22: `seasons` lacked it, so season DELETIONS never reached other devices — and the assertion
 * written to prevent exactly that was itself built from a stale hand-written list. Realtime
 * sends only the primary key on a DELETE without it, and `handleRealtimeDelete` needs the
 * `team_id` to know whose row it was. Four tables in one migration is four chances to forget.
 */
ALTER TABLE team_game_overrides REPLICA IDENTITY FULL;
ALTER TABLE competition_events REPLICA IDENTITY FULL;
ALTER TABLE event_matches REPLICA IDENTITY FULL;
ALTER TABLE match_participants REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE team_game_overrides;
ALTER PUBLICATION supabase_realtime ADD TABLE competition_events;
ALTER PUBLICATION supabase_realtime ADD TABLE event_matches;
ALTER PUBLICATION supabase_realtime ADD TABLE match_participants;
