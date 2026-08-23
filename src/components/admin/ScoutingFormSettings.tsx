import { useMemo, useState } from 'react';
import { Eye, EyeOff, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useSeasonScope } from '../../lib/season-scope';
import { useAccessState } from '../../lib/entitlement';
import { gameForSeason } from '../../lib/games';
import {
    allFields,
    resolveGame,
    TEAM_FIELD_PREFIX,
    type FieldType,
    type GameField,
    type GamePatch,
} from '../../lib/game-definition';
import { FIELD_LABEL_MAX_LENGTH, patchIssues } from '../../lib/scouting-validation';
import Button from '../ui/Button';
import SectionHeader from '../ui/SectionHeader';

/**
 * "Your scouting form" — the door to `team_game_overrides` (D4(b)).
 *
 * WITHOUT THIS SCREEN THE PATCH IS A GATE WITH NO DOOR. `docs/failure-modes.md` §7 is four
 * sprints of exactly that: a check with no writer, a column nothing sets, a role that meant
 * nothing for five sprints. The table, the RLS, the registry entry and the resolver would all
 * be correct and no team could ever produce a patch.
 *
 * THREE OPERATIONS AND NO MORE, which is D4's decision rather than a first cut: *"Not (c): no
 * form builder. Field types stay ours."* Add, hide, relabel. Deliberately absent: reorder,
 * retype, and editing a field's options — each defensible, none with a reported need, and every
 * one of them widening what a patch can do to a form a scout is typing into at a venue.
 *
 * NOTHING IS DELETED BY A HIDE. The data stays in the jsonb bag and comes back if the field is
 * shown again; that is what makes hiding a safe thing for a coach to try mid-season.
 */
export default function ScoutingFormSettings() {
    const { season } = useSeasonScope();
    const { canEdit, editRefusalReason } = useAccessState();
    const gameOverrides = useAppStore((s) => s.gameOverrides);
    const saveGameOverride = useAppStore((s) => s.saveGameOverride);

    const base = useMemo(() => gameForSeason(season), [season]);
    const saved = gameOverrides.find((o) => o.seasonId === season?.id);

    /** The patch being edited. Starts from what is saved, so cancel is just "do not save". */
    const [draft, setDraft] = useState<GamePatch>(() => saved?.patch ?? {});
    const [newLabel, setNewLabel] = useState('');
    const [newType, setNewType] = useState<FieldType>('bool');
    const [status, setStatus] = useState<string | null>(null);

    const hidden = new Set(draft.hide ?? []);
    const relabel = draft.relabel ?? {};
    const added = draft.add ?? [];

    /*
     * The form as it would actually render. The SAME `resolveGame` the scouting page uses, on
     * an unsaved draft — which is the whole reason that function is pure and takes both halves
     * as arguments. A preview with its own resolver is a second implementation of the rule, and
     * this project has the seven-display-name story to explain what that costs.
     */
    const preview = useMemo(() => resolveGame(base, draft), [base, draft]);
    const issues = useMemo(() => patchIssues(base, draft), [base, draft]);

    const toggleHidden = (key: string) => {
        setStatus(null);
        setDraft((d) => {
            const next = new Set(d.hide ?? []);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return { ...d, hide: [...next] };
        });
    };

    const setLabel = (key: string, label: string) => {
        setStatus(null);
        setDraft((d) => {
            const next = { ...(d.relabel ?? {}) };
            /*
             * A label matching the template's own is a DELETION of the override, not an
             * override that happens to agree. Otherwise a coach who types the original name
             * back is left with a patch that pins the label for ever — so next September's
             * rename of that field would silently not apply to them.
             */
            const original = allFields(base).find((f) => f.key === key)?.label;
            if (!label.trim() || label.trim() === original) delete next[key];
            else next[key] = label.trim();
            return { ...d, relabel: next };
        });
    };

    const addField = () => {
        const label = newLabel.trim();
        if (!label) return;
        setStatus(null);
        /*
         * The key is DERIVED from the label once, at creation, and never changes again — a
         * relabel edits the label, not the key. A key that tracked the label would rename the
         * jsonb key under every report already written with it, which is `docs/failure-modes.md`
         * §9: an identity chosen for one property and wrong for another.
         */
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const key = `${TEAM_FIELD_PREFIX}${slug || 'field'}-${Math.random().toString(36).slice(2, 6)}`;
        const field: GameField = { key, label, type: newType };
        if (newType === 'select') field.options = ['Yes', 'No'];
        if (newType === 'counter' || newType === 'int') field.min = 0;
        if (newType === 'rating') { field.min = 1; field.max = 5; }

        setDraft((d) => ({
            ...d,
            add: [...(d.add ?? []), { section: base.scouting.match.sections.at(-1)?.key ?? 'team-extra', field }],
        }));
        setNewLabel('');
    };

    const removeAdded = (key: string) => {
        setStatus(null);
        setDraft((d) => ({ ...d, add: (d.add ?? []).filter((a) => a.field.key !== key) }));
    };

    const save = () => {
        if (!season?.id || issues.length > 0) return;
        const id = saveGameOverride({
            seasonId: season.id,
            baseDefinitionId: base.id,
            baseVersion: base.version,
            patch: draft,
        });
        setStatus(id ? 'Saved. Your scouting form now looks like the preview.' : 'Could not save.');
    };

    if (!season) return null;

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
            <SectionHeader icon={SlidersHorizontal} title="Your scouting form" />
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                {/* The base is NAMED, because a coach needs to know which season's form they are
                    editing — a team that has just rolled over has two, a click apart. */}
                Based on <strong>{base.title}</strong>. You can hide fields you do not use,
                rename them, and add up to a few of your own. Hiding never deletes anything
                already recorded.
            </p>

            {status && (
                <p role="status" className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300">
                    {status}
                </p>
            )}

            <ul className="space-y-1" data-testid="form-field-list">
                {allFields(base).map((field) => (
                    <li
                        key={field.key}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700"
                    >
                        <button
                            type="button"
                            data-testid={`toggle-${field.key}`}
                            onClick={() => toggleHidden(field.key)}
                            disabled={!canEdit}
                            title={
                                canEdit
                                    ? hidden.has(field.key)
                                        ? `Show ${field.label} again`
                                        : `Hide ${field.label} — nothing already recorded is deleted`
                                    : editRefusalReason
                            }
                            aria-pressed={hidden.has(field.key)}
                            className="touch-target rounded-lg px-2 text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400"
                        >
                            {hidden.has(field.key) ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                        <input
                            aria-label={`Label for ${field.label}`}
                            data-testid={`label-${field.key}`}
                            className={`field min-w-0 flex-1 py-1 text-sm ${hidden.has(field.key) ? 'opacity-40' : ''}`}
                            maxLength={FIELD_LABEL_MAX_LENGTH}
                            value={relabel[field.key] ?? field.label}
                            disabled={!canEdit || hidden.has(field.key)}
                            title={canEdit ? undefined : editRefusalReason}
                            onChange={(e) => setLabel(field.key, e.target.value)}
                        />
                        <span className="shrink-0 text-2xs uppercase text-slate-400">{field.type}</span>
                    </li>
                ))}

                {added.map(({ field }) => (
                    <li
                        key={field.key}
                        data-testid="added-field"
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-forge-300 bg-forge-500/5 p-2 dark:border-forge-700"
                    >
                        <span className="shrink-0 rounded-full bg-forge-500/20 px-2 py-0.5 text-2xs font-bold text-forge-700 dark:text-forge-300">
                            yours
                        </span>
                        <input
                            aria-label={`Label for ${field.label}`}
                            className="field min-w-0 flex-1 py-1 text-sm"
                            maxLength={FIELD_LABEL_MAX_LENGTH}
                            value={relabel[field.key] ?? field.label}
                            disabled={!canEdit}
                            title={canEdit ? undefined : editRefusalReason}
                            onChange={(e) => setLabel(field.key, e.target.value)}
                        />
                        <span className="shrink-0 text-2xs uppercase text-slate-400">{field.type}</span>
                        <button
                            type="button"
                            onClick={() => removeAdded(field.key)}
                            disabled={!canEdit}
                            title={canEdit ? `Remove ${field.label}` : editRefusalReason}
                            aria-label={`Remove ${field.label}`}
                            className="touch-target rounded-lg px-2 text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Trash2 size={15} />
                        </button>
                    </li>
                ))}
            </ul>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                    data-testid="new-field-label"
                    className="field min-w-0 flex-1"
                    placeholder="Add a field of your own"
                    maxLength={FIELD_LABEL_MAX_LENGTH}
                    value={newLabel}
                    disabled={!canEdit}
                    title={canEdit ? undefined : editRefusalReason}
                    onChange={(e) => setNewLabel(e.target.value)}
                />
                <select
                    aria-label="Field type"
                    data-testid="new-field-type"
                    className="field w-auto shrink-0"
                    value={newType}
                    disabled={!canEdit}
                    title={canEdit ? undefined : editRefusalReason}
                    onChange={(e) => setNewType(e.target.value as FieldType)}
                >
                    {/* The TYPES ARE OURS (D4). This list is the whole vocabulary, which is what
                        keeps the validation surface finite. */}
                    <option value="bool">Yes / no</option>
                    <option value="counter">Counter</option>
                    <option value="int">Number</option>
                    <option value="select">Choice</option>
                    <option value="rating">Rating</option>
                    <option value="text">Short text</option>
                    <option value="textarea">Notes</option>
                </select>
                <Button
                    data-testid="add-field"
                    onClick={addField}
                    disabled={!canEdit || !newLabel.trim()}
                    title={
                        !canEdit
                            ? editRefusalReason
                            : !newLabel.trim()
                              ? 'Name the field first'
                              : 'Add this field to your form'
                    }
                >
                    <Plus size={15} /> Add
                </Button>
            </div>

            {issues.length > 0 && (
                <ul role="alert" data-testid="form-issues" className="mt-3 space-y-1">
                    {issues.map((issue, i) => (
                        <li key={i} className="text-xs text-rose-600 dark:text-rose-400">
                            {issue.message}
                        </li>
                    ))}
                </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                {/* What a scout will see, counted. Cheap, and it is the number that tells a coach
                    whether they have hidden half the form by accident. */}
                <span data-testid="form-preview-count" className="text-xs text-slate-500 dark:text-slate-400">
                    Scouts will see {allFields(preview).length} field
                    {allFields(preview).length === 1 ? '' : 's'}.
                </span>
                <Button
                    data-testid="save-form-overrides"
                    onClick={save}
                    disabled={!canEdit || issues.length > 0}
                    title={
                        !canEdit
                            ? editRefusalReason
                            : issues.length > 0
                              ? issues[0].message
                              : 'Save these changes for this season'
                    }
                >
                    Save form
                </Button>
            </div>
        </div>
    );
}
