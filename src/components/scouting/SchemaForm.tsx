import { Minus, Plus } from 'lucide-react';
import type { GameDefinition, GameField } from '../../lib/game-definition';
import { fieldError } from '../../lib/scouting-validation';

/**
 * One form, rendered from a {@link GameDefinition} (P-01 phase S).
 *
 * This replaces about 150 lines of hand-written JSX in `ScoutingReports.tsx` that named
 * DECODE's fields one at a time — a checkbox called "Has Autonomous", a select of three intake
 * types, two ± steppers, a 1–5 range. Supporting next September's game meant editing that JSX,
 * a TypeScript union, `constants.ts` and the sync layer, three weeks before kickoff.
 *
 * THE PRIMITIVES ARE THE ONES ALREADY IN USE. The `.field` class, the ± stepper and the range
 * input are lifted from what was there rather than reinvented, so the rendered form is the form
 * scouts already know. This is a change of where the shape comes from, not a redesign — and a
 * redesign smuggled in alongside would make "existing seeded DECODE rows render unchanged"
 * impossible to check, which is P-01's own exit criterion.
 *
 * `.field` also carries the iOS 16px zoom floor. Every control here goes through it for that
 * reason: `docs/failure-modes.md` §5 records that the floor was silently broken for two sprints
 * by a class that outranked the element selector, and a form built out of bare `<input>`s would
 * miss it again.
 */
export interface SchemaFormProps {
    game: GameDefinition;
    /** The report's `data` bag, keyed by `GameField.key`. */
    value: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    /** False on an archived season or a lapsed licence; the reason goes in `refusalReason`. */
    canEdit: boolean;
    refusalReason?: string;
}

export default function SchemaForm({
    game,
    value,
    onChange,
    canEdit,
    refusalReason,
}: SchemaFormProps) {
    const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });

    return (
        <div className="space-y-4" data-testid="schema-form">
            {game.scouting.match.sections.map((section) => (
                <section key={section.key} data-testid={`schema-section-${section.key}`}>
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {section.label}
                    </h4>
                    <div className="space-y-3">
                        {section.fields.map((field) => (
                            <Field
                                key={field.key}
                                field={field}
                                value={value[field.key]}
                                onChange={(next) => set(field.key, next)}
                                canEdit={canEdit}
                                refusalReason={refusalReason}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function Field({
    field,
    value,
    onChange,
    canEdit,
    refusalReason,
}: {
    field: GameField;
    value: unknown;
    onChange: (next: unknown) => void;
    canEdit: boolean;
    refusalReason?: string;
}) {
    /*
     * The field's OWN error, from the same module the Save button asks (WALK-A-06, widened to
     * team-added fields by D4(b)). A disabled Save tells a scout that something is wrong and
     * not which box; this is which box.
     */
    const error = fieldError(field, value);
    const testId = `field-${field.key}`;
    const common = {
        id: testId,
        'data-testid': testId,
        disabled: !canEdit,
        title: canEdit ? undefined : refusalReason,
    };

    const label = (
        <label
            htmlFor={testId}
            className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300"
        >
            {field.label}
        </label>
    );

    const errorLine = error ? (
        <p
            role="alert"
            data-testid={`${testId}-error`}
            className="mt-1 text-2xs text-rose-600 dark:text-rose-400"
        >
            {error}
        </p>
    ) : null;

    switch (field.type) {
        case 'bool':
            /*
             * A real `<label>` wrapping a real `<input type="checkbox">`, not a clickable div.
             * `docs/failure-modes.md` §8 counts keyboard-unreachable controls as a repeated
             * defect class in this repo — including on the checklist page, whose entire job is
             * ticking things.
             */
            return (
                <div>
                    <label
                        className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
                        title={canEdit ? undefined : refusalReason}
                    >
                        <input
                            type="checkbox"
                            {...common}
                            className="h-5 w-5 accent-forge-600"
                            checked={value === true}
                            onChange={(e) => onChange(e.target.checked)}
                        />
                        {field.label}
                    </label>
                    {errorLine}
                </div>
            );

        case 'counter': {
            const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
            const min = field.min ?? 0;
            return (
                <div>
                    {label}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            data-testid={`${testId}-minus`}
                            disabled={!canEdit || n <= min}
                            title={
                                canEdit
                                    ? n <= min
                                        ? `Already at the minimum (${min})`
                                        : `One fewer ${field.label}`
                                    : refusalReason
                            }
                            onClick={() => onChange(Math.max(min, n - 1))}
                            className="touch-target flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        >
                            <Minus size={16} />
                        </button>
                        <input
                            type="number"
                            {...common}
                            inputMode="numeric"
                            value={n}
                            min={min}
                            max={field.max}
                            onChange={(e) => {
                                /*
                                 * NaN when the box is cleared, and it must not become 0 —
                                 * B18, where `parseInt('') → NaN → || 0` put a fabricated 0
                                 * into five of nine live production rows. A cleared counter
                                 * goes back to its minimum, which is a value the scout can
                                 * see, rather than to a zero that looks like data.
                                 */
                                const parsed = Number.parseInt(e.target.value, 10);
                                onChange(Number.isNaN(parsed) ? min : parsed);
                            }}
                            className="field w-20 text-center"
                        />
                        <button
                            type="button"
                            data-testid={`${testId}-plus`}
                            disabled={!canEdit || (field.max !== undefined && n >= field.max)}
                            title={canEdit ? `One more ${field.label}` : refusalReason}
                            onClick={() =>
                                onChange(field.max !== undefined ? Math.min(field.max, n + 1) : n + 1)
                            }
                            className="touch-target flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                    {errorLine}
                </div>
            );
        }

        case 'int': {
            const n = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
            return (
                <div>
                    {label}
                    <input
                        type="number"
                        {...common}
                        inputMode="numeric"
                        value={n ?? ''}
                        min={field.min}
                        max={field.max}
                        onChange={(e) => {
                            const parsed = Number.parseInt(e.target.value, 10);
                            // `undefined`, not 0: a blank number field means "not recorded",
                            // which is a different fact from zero (failure-modes §4).
                            onChange(Number.isNaN(parsed) ? undefined : parsed);
                        }}
                        className="field w-full"
                    />
                    {errorLine}
                </div>
            );
        }

        case 'select':
            return (
                <div>
                    {label}
                    <select
                        {...common}
                        value={typeof value === 'string' ? value : (field.options?.[0] ?? '')}
                        onChange={(e) => onChange(e.target.value)}
                        className="field w-full"
                    >
                        {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                    {errorLine}
                </div>
            );

        case 'rating': {
            const min = field.min ?? 1;
            const max = field.max ?? 5;
            const n = typeof value === 'number' && Number.isFinite(value) ? value : min;
            return (
                <div>
                    <label
                        htmlFor={testId}
                        className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                        {field.label}: {n}
                    </label>
                    <input
                        type="range"
                        {...common}
                        min={min}
                        max={max}
                        value={n}
                        onChange={(e) => onChange(Number(e.target.value))}
                        className="w-full accent-forge-600"
                    />
                    {errorLine}
                </div>
            );
        }

        case 'textarea':
            return (
                <div>
                    {label}
                    <textarea
                        {...common}
                        rows={3}
                        value={typeof value === 'string' ? value : ''}
                        maxLength={field.maxLength}
                        onChange={(e) => onChange(e.target.value)}
                        className="field w-full"
                    />
                    {/*
                      * A VISIBLE COUNTER RATHER THAN A SILENT TRUNCATION (WALK-A-06). The cap
                      * exists to stop one report owning the grid, not to ration what a scout
                      * has to say, so it has to be legible while they type.
                      */}
                    {field.maxLength !== undefined && (
                        <p
                            data-testid={`${testId}-count`}
                            className="mt-1 text-right text-2xs text-slate-400"
                        >
                            {(typeof value === 'string' ? value.length : 0)}/{field.maxLength}
                        </p>
                    )}
                    {errorLine}
                </div>
            );

        default:
            return (
                <div>
                    {label}
                    <input
                        type="text"
                        {...common}
                        value={typeof value === 'string' ? value : ''}
                        maxLength={field.maxLength}
                        onChange={(e) => onChange(e.target.value)}
                        className="field w-full"
                    />
                    {errorLine}
                </div>
            );
    }
}
