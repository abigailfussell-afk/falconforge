/**
 * What a game is, as data (P-01 phase S, D4(b)).
 *
 * WHY THIS EXISTS. FTC replaces the game every September, and until now the game was spelled
 * out in TypeScript: `intakeType: 'No Intake' | 'Human Player' | 'Automatic'` in `types.ts`,
 * `FIELD_IMAGE_URL = "DecodeField.png"` in `constants.ts`, "Lifted Park" as a checkbox label in
 * `MatchPlanner.tsx`, and ten enumerated keys in the entity registry's `toRemote`/`fromRemote`.
 * So "support next season's game" meant editing a type, a constant, two components and the sync
 * layer — in September, three weeks before kickoff, on the one code path whose rows a team
 * cannot re-enter afterwards.
 *
 * `scouting_reports.data` has always been a jsonb bag keyed by field name, so **today's DECODE
 * rows are already valid instances of the DECODE schema below** and need no rewrite. What
 * changes is that the registry stops enumerating the keys and the form stops hard-coding them.
 *
 * D4(b): CURATED TEMPLATES PLUS LIGHT OVERRIDES, NOT A FORM BUILDER.
 *
 * Kevin's decision of 2026-08-23. A team may add a field, hide a field, and relabel a field
 * ({@link GamePatch}). It may not invent a field TYPE — the types below are ours, and that is
 * the line that keeps the validation surface finite. The evidence for the shape is that what
 * teams actually do to a template is add two fields and rename one; a builder is a sprint of UI
 * and a new class of validation bugs.
 *
 * WHERE DEFINITIONS LIVE: bundled JSON in `src/games/`, imported at build time. Offline by
 * construction, versioned with the app, no schema change. Phase M moves the base to a global
 * table so the operator can fix a rubric mid-season without a release; the bundled files stay
 * as the cold-start fallback. Nothing here assumes the bundle is the only source — `resolveGame`
 * takes a base and a patch and does not care where either came from.
 */

/** The field types the app knows how to render and validate. Teams cannot add to this list. */
export type FieldType =
    | 'bool'
    | 'int'
    | 'counter'
    | 'select'
    | 'rating'
    | 'text'
    | 'textarea';

export interface GameField {
    /** Stable key into `scouting_reports.data`. Never rendered; never changed by a relabel. */
    key: string;
    label: string;
    type: FieldType;
    /** `select` only. */
    options?: string[];
    /** `int` / `counter` / `rating`. */
    min?: number;
    max?: number;
    /** `text` / `textarea`. */
    maxLength?: number;
    /**
     * What the field is worth when the report is new.
     *
     * `rating` is the cautionary one and it is called out in P-01's own trap line: the DECODE
     * form defaulted to 3 and `fromRemote` defaulted to 0, so a report saved without touching
     * the slider read back as a different number than it was saved with. One default, here.
     */
    default?: string | number | boolean;
    /** Shown on the report CARD as well as in the form. */
    summary?: boolean;
    /** Which phase of the match this belongs to, for grouping. */
    phase?: string;
}

export interface GameSection {
    key: string;
    label: string;
    fields: GameField[];
}

export interface FormSchema {
    sections: GameSection[];
}

export interface GamePhase {
    key: string;
    label: string;
    seconds?: number;
}

export interface GameMetric {
    key: string;
    label: string;
    /**
     * Which field to aggregate. Deliberately a FIELD KEY and not an expression.
     *
     * FEAT §2b sketches `expr: '(shotsTaken-shotsMissed)/max(shotsTaken,1)'`, which needs an
     * expression evaluator — i.e. a parser, or `eval` over operator-supplied text in every
     * team's browser. Neither is worth it for a feature nobody has asked for yet. A metric over
     * one numeric field covers what P-02's summary table needs (mean/max/σ per team), and
     * derived metrics can be added as a `type` on this record when something actually wants one.
     */
    field: string;
    aggregate: 'mean' | 'max' | 'sum';
}

export interface GameDefinition {
    /** Stable across versions. `ftc-2025-decode`. */
    id: string;
    program: 'ftc' | 'frc';
    /** `2025-26`. */
    seasonKey: string;
    /** `DECODE`. What `seasons.game_title` is set from. */
    title: string;
    /** Bumped when the operator changes the shipped template. */
    version: number;
    match: {
        /** 2 for FTC, 3 for FRC. Read by the events entity, not just by scouting. */
        allianceSize: number;
        phases: GamePhase[];
    };
    field: {
        /** A file under `public/`, resolved against `BASE_URL` at render time. */
        image: string;
        width: number;
        height: number;
    };
    scouting: { match: FormSchema };
    scoring: { metrics: GameMetric[] };
    planner: { partnerCapabilities: { key: string; label: string }[] };
}

/**
 * A team's changes to a curated template (D4(b)).
 *
 * THREE OPERATIONS, and no more. Add, hide, relabel — which is the list D4 gives and the list
 * the evidence supports. Notably absent: reorder, retype, and change a field's options. Each
 * would be defensible and none has a reported need, and every one of them widens what a patch
 * can do to a rendered form that a scout is typing into at a venue.
 */
export interface GamePatch {
    /**
     * Fields this team added, appended to a section (or to a new one at the end when the
     * section key is unknown). Their keys are namespaced on write — see `TEAM_FIELD_PREFIX` —
     * so a team's `parking` can never collide with the template's.
     */
    add?: { section: string; field: GameField }[];
    /** Keys the team does not want to see. The DATA is not deleted; only the field is hidden. */
    hide?: string[];
    /** Key → the team's own label. The key is untouched, so the data keeps its meaning. */
    relabel?: Record<string, string>;
}

/**
 * Every team-added field key starts with this.
 *
 * WHY A PREFIX AND NOT A UNIQUENESS CHECK. A check compares against the template as it is
 * TODAY; the template is replaced every September, and next year's DECODE successor may well
 * ship a field called `climb` that a team added by hand this year. Without the prefix those two
 * become one key in one jsonb bag, and last season's hand-typed value silently becomes this
 * season's official field — `docs/failure-modes.md` §9, an identity chosen for one property and
 * wrong for another. With it, they cannot collide however the template changes.
 */
export const TEAM_FIELD_PREFIX = 'team.';

export const isTeamField = (key: string): boolean => key.startsWith(TEAM_FIELD_PREFIX);

/** How many fields a team may add. Not a technical limit — see `scouting-validation.ts`. */
export const MAX_TEAM_FIELDS = 10;

/**
 * base ⊕ patch — the schema actually rendered.
 *
 * PURE, and takes both halves as arguments, so the season snapshot, the live template and a
 * preview of an unsaved patch all go through one function. A resolver that read the store would
 * have to be re-implemented for the preview, which is how this project got seven display-name
 * implementations.
 *
 * A null or malformed patch resolves to the base unchanged rather than throwing. The patch is a
 * jsonb column a client wrote; a form that refuses to render because of it takes the whole
 * scouting screen down at a venue, and the base is always a correct answer.
 */
export function resolveGame(base: GameDefinition, patch?: GamePatch | null): GameDefinition {
    if (!patch) return base;

    const hidden = new Set(Array.isArray(patch.hide) ? patch.hide : []);
    const relabel = patch.relabel && typeof patch.relabel === 'object' ? patch.relabel : {};
    const added = Array.isArray(patch.add) ? patch.add : [];

    const sections = base.scouting.match.sections.map((section) => ({
        ...section,
        fields: section.fields
            .filter((f) => !hidden.has(f.key))
            .map((f) =>
                typeof relabel[f.key] === 'string' && relabel[f.key].trim()
                    ? { ...f, label: relabel[f.key].trim() }
                    : f,
            ),
    }));

    for (const entry of added) {
        if (!entry?.field?.key || hidden.has(entry.field.key)) continue;
        const target = sections.find((s) => s.key === entry.section);
        const field = {
            ...entry.field,
            label: relabel[entry.field.key]?.trim() || entry.field.label,
        };
        if (target) {
            target.fields = [...target.fields, field];
        } else {
            /*
             * A section the template no longer has — because the team added a field to it last
             * September and this September's game is shaped differently. The field is kept
             * rather than dropped: the team is still collecting it, and silently losing a
             * column of a scout's data because a section was renamed upstream is the failure
             * this whole patch mechanism exists to avoid.
             */
            sections.push({
                key: entry.section || 'team-extra',
                label: 'Your team’s own',
                fields: [field],
            });
        }
    }

    return { ...base, scouting: { match: { sections } } };
}

/** Every field in render order, which is what the form, the card and the validator all walk. */
export function allFields(game: GameDefinition): GameField[] {
    return game.scouting.match.sections.flatMap((s) => s.fields);
}

export function findField(game: GameDefinition, key: string): GameField | undefined {
    return allFields(game).find((f) => f.key === key);
}

/**
 * A blank report's `data`, from the schema's own defaults.
 *
 * Every field gets a value, including the ones with no `default`, because a jsonb bag missing a
 * key and a bag holding the type's zero are different things to every reader downstream — and
 * "absent" is the one this project has misread five times (`docs/failure-modes.md` §4). The
 * form writes a complete bag; `fromRemote` preserves whatever it finds.
 */
export function blankReportData(game: GameDefinition): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const field of allFields(game)) {
        if (field.default !== undefined) {
            data[field.key] = field.default;
            continue;
        }
        switch (field.type) {
            case 'bool':
                data[field.key] = false;
                break;
            case 'int':
            case 'counter':
            case 'rating':
                data[field.key] = field.min ?? 0;
                break;
            case 'select':
                data[field.key] = field.options?.[0] ?? '';
                break;
            default:
                data[field.key] = '';
        }
    }
    return data;
}

/**
 * Is this object shaped like a `GameDefinition`?
 *
 * Used on the bundled JSON at module load and on a season's stored snapshot, both of which are
 * outside TypeScript's reach — an import of a `.json` file is typed by its literal contents, not
 * checked against this interface, and a snapshot is a jsonb column. The check is structural and
 * shallow on purpose: it is here to catch a truncated or wrong-shaped document, not to
 * re-implement a schema validator.
 */
export function isGameDefinition(value: unknown): value is GameDefinition {
    if (!value || typeof value !== 'object') return false;
    const g = value as Partial<GameDefinition>;
    return (
        typeof g.id === 'string' &&
        (g.program === 'ftc' || g.program === 'frc') &&
        typeof g.title === 'string' &&
        typeof g.version === 'number' &&
        !!g.match &&
        typeof g.match.allianceSize === 'number' &&
        Array.isArray(g.match.phases) &&
        !!g.field &&
        typeof g.field.image === 'string' &&
        !!g.scouting?.match &&
        Array.isArray(g.scouting.match.sections) &&
        g.scouting.match.sections.every(
            (s) => typeof s?.key === 'string' && Array.isArray(s.fields),
        )
    );
}
