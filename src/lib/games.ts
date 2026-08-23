/**
 * The bundled game definitions, and how a season gets one.
 *
 * SEPARATE FROM `game-definition.ts` ON PURPOSE. That file is types and pure functions and
 * imports nothing; this one imports JSON and reads the store. Keeping the resolver pure is what
 * lets the season snapshot, the live template and an unsaved patch preview all go through the
 * same `resolveGame` — a resolver that reached for the store would have to be re-implemented
 * for the preview, which is how this project ended up with seven display-name implementations.
 */
import decode from '../games/ftc-2025-decode.json';
import biobuzz from '../games/ftc-2026-biobuzz.json';
import {
    isGameDefinition,
    resolveGame,
    type GameDefinition,
    type GamePatch,
} from './game-definition';

/*
 * VALIDATED AT MODULE LOAD, not trusted.
 *
 * `import x from './x.json'` types the value by its literal contents; TypeScript never checks it
 * against `GameDefinition`. So a file with a typo'd key compiles, ships, and fails at render
 * time on the scouting screen — at a venue, since that is where scouting happens. Throwing here
 * turns it into a build-time failure instead: `harness-invariants` imports this module, so the
 * Gate goes red.
 */
function load(raw: unknown, name: string): GameDefinition {
    if (!isGameDefinition(raw)) {
        throw new Error(
            `src/games/${name}.json is not a valid GameDefinition. ` +
                'A malformed template takes the scouting screen down at a venue, so this is a ' +
                'build failure rather than a render one.',
        );
    }
    return raw;
}

export const DECODE = load(decode, 'ftc-2025-decode');
export const BIOBUZZ = load(biobuzz, 'ftc-2026-biobuzz');

/**
 * Every definition the app ships, newest first.
 *
 * The order is the order the season form offers them, and "newest first" is what makes the
 * default right in September without anybody choosing.
 */
export const BUNDLED_GAMES: GameDefinition[] = [BIOBUZZ, DECODE];

/** The one a brand-new season should get. */
export const CURRENT_GAME: GameDefinition = BUNDLED_GAMES[0];

export function gameById(id: string | null | undefined): GameDefinition | undefined {
    return BUNDLED_GAMES.find((g) => g.id === id);
}

/**
 * Which definition a season plays.
 *
 * ORDER OF PREFERENCE, and the last one is the interesting case:
 *
 *   1. The season's `gameDefinitionId`, if it names something we ship.
 *   2. A match on `gameTitle`, for every season created before this column existed — which is
 *      every season in production today. Without this, opening an existing DECODE season after
 *      the upgrade would render it as BIOBUZZ, silently relabelling a year of scouting.
 *   3. The newest bundled definition.
 *
 * (3) is a guess and it is the wrong answer for an ARCHIVED season whose game we no longer
 * ship — the season renders with this year's fields over last year's data. That is what the
 * `game_snapshot` column in phase M is for; phase S cannot fix it, and the S-phase exit
 * criterion says as much ("in phase S it can be satisfied by storing the definition id +
 * version on the season"). Recorded rather than hidden: `docs/sprint-18-report.md` says so and
 * the plan's §8 carries the line.
 */
export function gameForSeason(season: {
    gameDefinitionId?: string | null;
    gameTitle?: string | null;
} | null | undefined): GameDefinition {
    if (!season) return CURRENT_GAME;

    const byId = gameById(season.gameDefinitionId);
    if (byId) return byId;

    const title = (season.gameTitle ?? '').trim().toUpperCase();
    if (title) {
        const byTitle = BUNDLED_GAMES.find((g) => g.title.toUpperCase() === title);
        if (byTitle) return byTitle;
    }

    return CURRENT_GAME;
}

/** base ⊕ patch for a season, in one call. Re-exported so callers need one import. */
export function resolveGameForSeason(
    season: { gameDefinitionId?: string | null; gameTitle?: string | null } | null | undefined,
    patch?: GamePatch | null,
): GameDefinition {
    return resolveGame(gameForSeason(season), patch);
}
