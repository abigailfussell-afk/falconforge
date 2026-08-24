import React, { useMemo, useState } from 'react';
import { useAppStore, ScoutingReport } from '../lib/store';
import { useSeasonScope, useSeasonScoped } from '../lib/season-scope';
import { useAccessState } from '../lib/entitlement';
import { useScoutingQuery } from '../lib/queries';
import {
    NOTES_MAX_LENGTH,
    TEAM_NUMBER_MAX_DIGITS,
    gameDataErrors,
    scoutingReportErrors,
} from '../lib/scouting-validation';
import { allFields, blankReportData } from '../lib/game-definition';
import { resolveGameForSeason } from '../lib/games';
import { Plus, Trophy, Trash2, Table2, LayoutGrid, Download, X } from 'lucide-react';
import Button from './ui/Button';
import Modal from './ui/Modal';
import EmptyState from './ui/EmptyState';
import ConfirmDialog from './ConfirmDialog';
import SchemaForm from './scouting/SchemaForm';
import TeamSummaryTable from './scouting/TeamSummaryTable';
import { eventsIn } from '../lib/scouting-metrics';
import { scoutingReportsToCsv, scoutingCsvFilename, downloadCsv } from '../lib/scouting-csv';

/**
 * Scouting, rendered from the season's `GameDefinition` (P-01 phase S, D4(b)).
 *
 * WHAT CHANGED AND WHAT DID NOT. Every DECODE-specific control in this file — "Has Autonomous",
 * the three intake types, two ± steppers, the 1–5 rating — is now a row in
 * `src/games/ftc-2025-decode.json` and rendered by `SchemaForm`. Nothing about the identity of
 * a report changed: `teamNumber`, `matchNumber` and `eventName` are still columns, still
 * validated by `scouting-validation.ts`, and WALK-A-06's three rules are untouched. Those are
 * properties of a SCOUTING REPORT, not of a game; the game owns what happened in the match.
 *
 * The report's `data` bag is the same jsonb it has always been, keyed the same way, so existing
 * DECODE rows render unchanged — which is P-01's own exit criterion and the reason the DECODE
 * definition was written to match the old form field for field rather than improved in passing.
 */
const ScoutingReports: React.FC = () => {
    const { scoutingReports: allScoutingReports, addScoutingReport, updateScoutingReport, deleteScoutingReport, currentTeamId } = useAppStore();

    // THIS PAGE WAS NOT SEASON-SCOPED AT ALL.
    //
    // Every other view filtered on the current season; this one rendered the store's whole
    // `scoutingReports` array, so a team's second season showed the first season's scouting
    // data mixed in with its own — with no way to tell which was which, since a report shows
    // an opponent's number and not a season. The dashboard's "Scouting Reports" count and
    // this list disagreed for the same reason. Missed because the filter was duplicated per
    // component, which is precisely what `useSeasonScoped` now prevents.
    const scoutingReports = useSeasonScoped(allScoutingReports);
    const { canEdit, editRefusalReason } = useAccessState();
    const { season } = useSeasonScope();
    const gameOverrides = useAppStore((s) => s.gameOverrides);

    /**
     * The form this season plays, with the team's own additions applied (D4(b)).
     *
     * Memoised on the season and the patch rather than recomputed per render: `resolveGame`
     * rebuilds every section, and a fresh object identity per render would remount every field
     * in `SchemaForm` on each keystroke.
     */
    const game = useMemo(
        () =>
            resolveGameForSeason(
                season,
                gameOverrides.find((o) => o.seasonId === season?.id)?.patch,
            ),
        [season, gameOverrides],
    );

    // Background refresh — fetches latest scouting data when this page is visited
    useScoutingQuery(currentTeamId);

    const [isScoutModalOpen, setIsScoutModalOpen] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [editingReportId, setEditingReportId] = useState<string | null>(null);

    /**
     * Summary or cards, and which event (P-02).
     *
     * SUMMARY IS THE DEFAULT. The cards answer "what did we write down"; the table answers "who
     * is good at what", which is the question somebody opening this page has. A lead who wants
     * the raw entries is one tap away, and a scout entering a report goes straight to the modal
     * from either.
     *
     * The event filter is `null` for "everything this season". A team scouts several
     * competitions in a season and comparing across them is usually wrong — a qualifier field
     * is not a league field — but the filter is not forced, because a team's first event is also
     * their only one and being asked to choose between one option is noise.
     */
    const [view, setView] = useState<'summary' | 'cards'>('summary');
    const [eventFilter, setEventFilter] = useState<string | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

    const events = useMemo(() => eventsIn(scoutingReports), [scoutingReports]);
    const visibleReports = useMemo(
        () =>
            eventFilter === null
                ? scoutingReports
                : scoutingReports.filter((r) => (r.eventName?.trim() ?? '') === eventFilter),
        [scoutingReports, eventFilter],
    );
    /** The selected team's reports, newest first — the detail under the table. */
    const teamReports = useMemo(
        () =>
            selectedTeam === null
                ? []
                : [...visibleReports]
                    .filter((r) => r.teamNumber?.trim() === selectedTeam)
                    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
        [visibleReports, selectedTeam],
    );

    /**
     * The export, which is not a nicety.
     *
     * Every scouting workflow this competes with ends in a Sheet, and a lead who cannot get
     * their data out will keep the Sheet and use the app for nothing. It exports WHAT IS ON
     * SCREEN — the current event filter — because a button that silently exports more than the
     * table shows is a file somebody will trust and be wrong about.
     */
    const exportCsv = () => {
        const csv = scoutingReportsToCsv(visibleReports, game);
        downloadCsv(scoutingCsvFilename(eventFilter, new Date()), csv);
    };

    const [newScout, setNewScout] = useState<Partial<ScoutingReport>>(() => ({
        data: blankReportData(game),
    }));

    /*
     * Every rule about what a report may contain, asked in one place (WALK-A-06, widened to the
     * game's own fields by D4(b)).
     *
     * The save button disables with a title saying why, instead of the old silent early-return
     * that ate the tap and kept the modal open with no explanation — at a venue that read as
     * "the app lost my entry". The same reasoning is why each field shows its own message: a
     * disabled button tells a scout that something is wrong and not which box.
     */
    const errors = scoutingReportErrors(newScout);
    const dataErrors = gameDataErrors(game, newScout.data ?? {});
    const hasTeamNumber = Boolean(newScout.teamNumber?.trim());
    const canSave =
        Object.keys(errors).length === 0 && Object.keys(dataErrors).length === 0;

    /** The fields worth putting on the card, in the order the schema lists them. */
    const summaryFields = useMemo(() => allFields(game).filter((f) => f.summary), [game]);
    /**
     * The one long-form field, rendered as the quoted block at the bottom of a card.
     *
     * By TYPE rather than by key, so it keeps working when the game changes: DECODE calls it
     * `endGameNotes` and next September's will call it something else, and a card that names
     * the key is a card with a game literal in it.
     */
    const notesField = useMemo(
        () => allFields(game).find((f) => f.type === 'textarea'),
        [game],
    );
    const ratingField = useMemo(() => allFields(game).find((f) => f.type === 'rating'), [game]);

    const notesValue = (newScout.data?.[notesField?.key ?? ''] as string | undefined) ?? '';
    const notesCap = notesField?.maxLength ?? NOTES_MAX_LENGTH;

    const saveScoutingReport = () => {
        if (!canSave) return;

        const reportData = {
            teamNumber: newScout.teamNumber || '',
            // Match number is optional. `parseInt('')` yields NaN when the field is cleared,
            // and the old `|| 0` turned that into a fabricated 0 that reached the database
            // and rendered as "Match 0". Undefined means "not recorded" (B18).
            matchNumber:
                typeof newScout.matchNumber === 'number' &&
                    Number.isFinite(newScout.matchNumber) &&
                    newScout.matchNumber > 0
                    ? newScout.matchNumber
                    : undefined,
            eventName: newScout.eventName || '',
            // Undefined, not '' or 0 — "not noted" is a fact and the CHECK constraints refuse
            // both of those anyway (P-02).
            alliance: newScout.alliance,
            station: newScout.station,
            data: newScout.data ?? {},
        };

        if (editingReportId) {
            // Update in-place — preserves ID, createdAt, createdBy
            updateScoutingReport(editingReportId, reportData);
        } else {
            addScoutingReport(reportData);
        }

        setIsScoutModalOpen(false);
        setEditingReportId(null);
        resetForm();
    };

    const openEditModal = (report: ScoutingReport) => {
        setNewScout({
            teamNumber: report.teamNumber,
            matchNumber: report.matchNumber,
            eventName: report.eventName,
            alliance: report.alliance,
            station: report.station,
            /*
             * DEFAULTS UNDERNEATH, THE REPORT'S OWN VALUES ON TOP.
             *
             * A report written before a field existed has no key for it, and an `undefined`
             * into a controlled input is React's uncontrolled-component warning followed by a
             * field that will not type. Spreading the blank bag first fills those in without
             * touching anything the report actually recorded — including keys this template no
             * longer has, which are carried through the edit untouched rather than dropped.
             */
            data: { ...blankReportData(game), ...(report.data ?? {}) },
        });
        setEditingReportId(report.id);
        setIsScoutModalOpen(true);
    };

    const handleDelete = (id: string) => {
        deleteScoutingReport(id);
        setDeleteConfirmId(null);
    };

    const resetForm = () => {
        setNewScout({ data: blankReportData(game), eventName: '' });
    };

    /** A stored value, as something a card can print. */
    const show = (value: unknown): string => {
        if (value === true) return 'Yes';
        if (value === false) return 'No';
        if (value === undefined || value === null || value === '') return '—';
        return String(value);
    };

    return (
        <div className="h-full flex flex-col w-full">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Scouting Reports</h2>
                <div className="flex flex-wrap items-center gap-2">
                    {/* Only when there is more than one event. A picker with one option asks a
                        question that has no other answer. */}
                    {events.length > 1 && (
                        <select
                            data-testid="scout-event-filter"
                            aria-label="Filter by event"
                            className="field py-1.5 w-auto"
                            value={eventFilter ?? ''}
                            onChange={(e) => {
                                setEventFilter(e.target.value === '' ? null : e.target.value);
                                setSelectedTeam(null);
                            }}
                        >
                            <option value="">All events</option>
                            {events.map((ev) => (
                                <option key={ev.name} value={ev.name}>
                                    {ev.name} ({ev.count})
                                </option>
                            ))}
                        </select>
                    )}
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <button
                            type="button"
                            data-testid="scout-view-summary"
                            onClick={() => setView('summary')}
                            aria-pressed={view === 'summary'}
                            title="Team summary"
                            className={`touch-target px-2.5 flex items-center gap-1 text-xs font-medium ${view === 'summary' ? 'bg-forge-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}
                        >
                            <Table2 size={15} /><span className="hidden sm:inline">Summary</span>
                        </button>
                        <button
                            type="button"
                            data-testid="scout-view-cards"
                            onClick={() => setView('cards')}
                            aria-pressed={view === 'cards'}
                            title="Individual reports"
                            className={`touch-target px-2.5 flex items-center gap-1 text-xs font-medium ${view === 'cards' ? 'bg-forge-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}
                        >
                            <LayoutGrid size={15} /><span className="hidden sm:inline">Reports</span>
                        </button>
                    </div>
                    <Button
                        variant="secondary"
                        data-testid="scout-export-csv"
                        onClick={exportCsv}
                        disabled={visibleReports.length === 0}
                        title={
                            visibleReports.length === 0
                                ? 'Nothing to export yet'
                                : `Export ${visibleReports.length} report${visibleReports.length === 1 ? '' : 's'} as CSV`
                        }
                        className="px-2 md:px-3"
                    >
                        <Download size={18} /><span className="hidden md:inline">Export CSV</span>
                    </Button>
                    <Button
                        data-testid="scout-match"
                        onClick={() => { resetForm(); setEditingReportId(null); setIsScoutModalOpen(true); }}
                        disabled={!canEdit}
                        title={canEdit ? 'Scout a match' : editRefusalReason}
                        className="px-2 md:px-4"
                    >
                        <Plus size={20} /><span className="hidden md:inline">Scout Match</span>
                    </Button>
                </div>
            </div>

            {view === 'summary' && (
                <div className="space-y-4 mb-4">
                    <TeamSummaryTable
                        reports={visibleReports}
                        game={game}
                        selectedTeam={selectedTeam}
                        onSelectTeam={setSelectedTeam}
                    />

                    {selectedTeam !== null && (
                        <div
                            data-testid="team-detail"
                            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 md:p-4"
                        >
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                                    Team #{selectedTeam} — {teamReports.length} report{teamReports.length === 1 ? '' : 's'}
                                </h3>
                                <button
                                    type="button"
                                    data-testid="team-detail-close"
                                    onClick={() => setSelectedTeam(null)}
                                    aria-label="Close team detail"
                                    className="touch-target p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <ul className="space-y-2">
                                {teamReports.map((report) => (
                                    <li key={report.id}>
                                        {/* A real button: this row opens the report, and the
                                            scouting cards were keyboard-unreachable for two
                                            sprints for want of one (failure-modes §8). */}
                                        <button
                                            type="button"
                                            data-testid="team-detail-report"
                                            onClick={() => openEditModal(report)}
                                            className="w-full text-left flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-700 px-2.5 py-2 hover:border-forge-300 dark:hover:border-forge-600"
                                        >
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                                                {report.matchNumber ? `Match ${report.matchNumber}` : 'No match #'}
                                            </span>
                                            {report.alliance && (
                                                <span className={`text-2xs font-bold px-1.5 py-0.5 rounded ${report.alliance === 'red' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                                                    {report.alliance === 'red' ? 'Red' : 'Blue'}{report.station ? ` ${report.station}` : ''}
                                                </span>
                                            )}
                                            {report.eventName && (
                                                <span className="text-2xs text-slate-500 dark:text-slate-400 min-w-0 truncate">
                                                    {report.eventName}
                                                </span>
                                            )}
                                            <span className="ml-auto flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-slate-500 dark:text-slate-400">
                                                {game.scoring.metrics.map((m) => (
                                                    <span key={m.key} className="tabular-nums">
                                                        {m.label} {show(report.data?.[m.field])}
                                                    </span>
                                                ))}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {/*
              * CONDITIONAL, not `hidden`. A `display:none` grid keeps every card in the DOM and
              * in the accessibility tree, so a screen reader reads the whole season twice and
              * every `getByText` in the suite becomes ambiguous — which is how this was written
              * first, and the test failures said "Found multiple elements" rather than anything
              * about the feature.
              */}
            {view === 'cards' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
                {visibleReports.map(report => (
                    /*
                     * The card opens the report for editing and CONTAINS a delete button, so
                     * it cannot itself be a <button> (buttons do not nest). role/tabIndex/
                     * onKeyDown make it a real keyboard target — a pit crew on a Bluetooth
                     * keyboard could not open a report at all before.
                     */
                    <div
                        key={report.id}
                        data-testid="scout-card"
                        role="button"
                        tabIndex={0}
                        onClick={() => openEditModal(report)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openEditModal(report);
                            }
                        }}
                        className="bg-white dark:bg-slate-800 p-3 md:p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card hover:shadow-raised hover:border-forge-300 dark:hover:border-forge-600 transition cursor-pointer"
                    >
                        {/* `min-w-0` and `break-words`, because validation only protects reports
                            written from NOW on. The walkthrough's 21-character team number is
                            already in databases, and a flex child defaults to `min-width: auto`
                            — it refuses to shrink below its content, so the long value pushed
                            the match badge out past the card's own edge instead of wrapping.
                            `shrink-0` keeps the badge whole while the number wraps.
                            (Geometry, so jsdom cannot see this: asserted in the e2e pack.) */}
                        <div className="flex justify-between items-start gap-2 mb-4">
                            <div className="min-w-0">
                                <div data-testid="scout-card-team" className="text-2xl font-black text-slate-800 dark:text-white break-words">#{report.teamNumber}</div>
                                {report.eventName && (
                                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">{report.eventName}</div>
                                )}
                            </div>
                            <div className="shrink-0 flex flex-col items-end gap-1">
                                <div data-testid="scout-card-match" className="bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md text-xs font-bold text-slate-600 dark:text-slate-300">
                                    {report.matchNumber ? `Match ${report.matchNumber}` : 'No match #'}
                                </div>
                                {/* Only when it was noted. A badge reading "—" tells nobody
                                    anything and takes the room a real one would need. */}
                                {report.alliance && (
                                    <div
                                        data-testid="scout-card-alliance"
                                        className={`px-2 py-0.5 rounded-md text-2xs font-bold ${report.alliance === 'red'
                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}
                                    >
                                        {report.alliance === 'red' ? 'Red' : 'Blue'}
                                        {report.station ? ` ${report.station}` : ''}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* The card's rows come from the schema's `summary` flags, so a new game
                            changes what a card shows without touching this file. `items-center`,
                            not the default stretch: a right-hand value can be two lines tall and
                            stretch dragged the left label's baseline down with it. */}
                        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300 mb-4">
                            {summaryFields
                                .filter((f) => f.type !== 'rating')
                                .map((field) => (
                                    <div
                                        key={field.key}
                                        data-testid={`scout-card-${field.key}`}
                                        className="flex justify-between items-center gap-2 border-b border-slate-100 dark:border-slate-700 pb-1"
                                    >
                                        <span className="min-w-0 truncate">{field.label}</span>
                                        <span className="shrink-0 font-medium text-right">
                                            {show(report.data?.[field.key])}
                                        </span>
                                    </div>
                                ))}
                        </div>

                        {/* Trophies and Delete button row */}
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1 text-yellow-500">
                                {ratingField &&
                                    [...Array((ratingField.max ?? 5) - (ratingField.min ?? 1) + 1)].map((_, i) => {
                                        const value = Number(report.data?.[ratingField.key] ?? 0);
                                        return (
                                            <Trophy
                                                key={i}
                                                size={14}
                                                fill={i < value ? 'currentColor' : 'none'}
                                                className={i < value ? '' : 'text-slate-300 dark:text-slate-600'}
                                            />
                                        );
                                    })}
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(report.id); }}
                                disabled={!canEdit}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title={canEdit ? 'Delete report' : editRefusalReason}
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                        {notesField && report.data?.[notesField.key] ? (
                            <p data-testid="scout-card-notes" className="text-xs bg-slate-50 dark:bg-slate-700 p-2 rounded-lg text-slate-500 dark:text-slate-300 italic break-words">
                                "{String(report.data[notesField.key])}"
                            </p>
                        ) : null}
                    </div>
                ))}
                {visibleReports.length === 0 && (
                    <div className="col-span-full bg-slate-50 dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                        <EmptyState
                            icon={Trophy}
                            title="No scouting data yet"
                            body="Reports your team scouts this season appear here."
                            action={
                                <Button
                                    size="sm"
                                    onClick={() => { resetForm(); setEditingReportId(null); setIsScoutModalOpen(true); }}
                                    disabled={!canEdit}
                                    title={canEdit ? 'Scout a match' : editRefusalReason}
                                >
                                    <Plus size={16} /> Scout Match
                                </Button>
                            }
                        />
                    </div>
                )}
            </div>
            )}

            {deleteConfirmId && (
                <ConfirmDialog
                    title="Delete Report?"
                    message="This scouting report will be permanently deleted. This action cannot be undone."
                    onConfirm={() => handleDelete(deleteConfirmId)}
                    onCancel={() => setDeleteConfirmId(null)}
                />
            )}

            {isScoutModalOpen && (
                <Modal
                    label={editingReportId ? 'Edit Scouting Report' : 'New Scouting Report'}
                    width="dialog"
                    className="overflow-hidden flex flex-col"
                    onClose={() => setIsScoutModalOpen(false)}
                >
                    <div className="p-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 font-bold text-lg text-slate-900 dark:text-white">
                        {editingReportId ? 'Edit Scouting Report' : 'New Scouting Report'}
                        {/* Which game's form this is. Not decoration: a team that has just rolled
                            over has two seasons a click apart with different fields, and a form
                            that does not say which one it is invites a report against the wrong
                            season's rubric. */}
                        <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                            {game.title}
                        </span>
                    </div>
                    <div className="p-4 md:p-6 space-y-4 overflow-y-auto">
                        {/* The report's IDENTITY — who, which match, which event. Not part of the
                            game: these are properties of a scouting report and they are the same
                            every September, which is why they stay hand-written here and
                            validated by the same three WALK-A-06 rules. */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" htmlFor="scout-team-number">Team # <span className="text-forge-600 dark:text-forge-400">*</span></label>
                                {/* `inputMode` rather than `type="number"`: the value is text
                                    (a leading zero is not a rounding error), but a phone should
                                    still open the number pad for it. */}
                                <input
                                    id="scout-team-number"
                                    data-testid="scout-team-number"
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={TEAM_NUMBER_MAX_DIGITS}
                                    aria-invalid={Boolean(errors.teamNumber)}
                                    className="field"
                                    value={newScout.teamNumber || ''}
                                    onChange={e => setNewScout({ ...newScout, teamNumber: e.target.value })}
                                />
                                {errors.teamNumber && (
                                    <p data-testid="scout-team-number-error" className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.teamNumber}</p>
                                )}
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" htmlFor="scout-match-number">Match #</label>
                                <input
                                    id="scout-match-number"
                                    data-testid="scout-match-number"
                                    type="number"
                                    min={1}
                                    aria-invalid={Boolean(errors.matchNumber)}
                                    className="field"
                                    value={newScout.matchNumber ?? ''}
                                    onChange={e => {
                                        const parsed = parseInt(e.target.value, 10);
                                        setNewScout({
                                            ...newScout,
                                            matchNumber: Number.isNaN(parsed) ? undefined : parsed,
                                        });
                                    }}
                                />
                                {errors.matchNumber && (
                                    <p data-testid="scout-match-number-error" className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.matchNumber}</p>
                                )}
                            </div>
                        </div>

                        {/*
                          * WHERE, as well as who and when (P-02).
                          *
                          * Both optional and both a `select` with a blank first option, because
                          * "not noted" is a real answer and the commonest one — a scout is
                          * watching a match, not filling in a form, and every field that insists
                          * is a reason for a report not to exist at all. `matchNumber` is
                          * optional for the same reason and B18 is what happened when an
                          * optional number was made to look mandatory.
                          *
                          * The station count comes from the GAME, not from a literal 2: FTC is
                          * 2v2 and FRC is 3v3, and `match.allianceSize` is the number the events
                          * entity already reads for exactly this.
                          */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" htmlFor="scout-alliance">Alliance</label>
                                <select
                                    id="scout-alliance"
                                    data-testid="scout-alliance"
                                    className="field"
                                    value={newScout.alliance ?? ''}
                                    onChange={e => setNewScout({
                                        ...newScout,
                                        alliance: e.target.value === '' ? undefined : (e.target.value as 'red' | 'blue'),
                                    })}
                                >
                                    <option value="">Not noted</option>
                                    <option value="red">Red</option>
                                    <option value="blue">Blue</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" htmlFor="scout-station">Station</label>
                                <select
                                    id="scout-station"
                                    data-testid="scout-station"
                                    className="field"
                                    value={newScout.station ?? ''}
                                    onChange={e => setNewScout({
                                        ...newScout,
                                        station: e.target.value === '' ? undefined : Number(e.target.value),
                                    })}
                                >
                                    <option value="">Not noted</option>
                                    {Array.from({ length: game.match.allianceSize }, (_, i) => i + 1).map((n) => (
                                        <option key={n} value={n}>{n}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" htmlFor="scout-event-name">Event</label>
                            <input
                                id="scout-event-name"
                                data-testid="scout-event-name"
                                type="text"
                                className="field"
                                value={newScout.eventName || ''}
                                onChange={e => setNewScout({ ...newScout, eventName: e.target.value })}
                            />
                        </div>

                        {/* ...and everything the GAME defines. */}
                        <SchemaForm
                            game={game}
                            value={newScout.data ?? {}}
                            onChange={(data) => setNewScout({ ...newScout, data })}
                            canEdit={canEdit}
                            refusalReason={editRefusalReason}
                        />

                        {/* The notes counter lives here rather than in `SchemaForm` because it is
                            WALK-A-06's, not the game's: shown from three-quarters full rather
                            than always, because a counter on an empty box is a limit announced
                            to somebody who was not going to reach it. */}
                        {notesField && notesValue.length > notesCap * 0.75 && (
                            <p
                                data-testid="scout-notes-remaining"
                                className={
                                    notesValue.length > notesCap
                                        ? 'text-right text-xs text-red-600 dark:text-red-400'
                                        : 'text-right text-xs text-slate-500 dark:text-slate-400'
                                }
                            >
                                {/* "-4500 left" is what this said when a paste got past
                                    `maxLength`, which is a number pretending to be an
                                    allowance. Over the cap it says how far over. */}
                                {notesValue.length > notesCap
                                    ? `${notesValue.length - notesCap} over`
                                    : `${notesCap - notesValue.length} left`}
                            </p>
                        )}
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
                        <Button variant="secondary" onClick={() => setIsScoutModalOpen(false)}>Cancel</Button>
                        {/* The modal still OPENS on an archived season — "full history
                            backward" means a past report stays readable. Only saving is
                            unavailable, which is the write the database refuses. */}
                        <Button
                            data-testid="save-scouting-report"
                            onClick={saveScoutingReport}
                            disabled={!canEdit || !canSave}
                            title={
                                !canEdit
                                    ? editRefusalReason
                                    : !hasTeamNumber
                                        ? 'Enter a team number first'
                                        // The field's own message, repeated on the button: on a
                                        // phone the offending box may be scrolled out of sight
                                        // by the time somebody wonders why Save is grey.
                                        : !canSave
                                            ? (errors.teamNumber || errors.matchNumber || Object.values(dataErrors)[0])
                                            : 'Save report'
                            }
                            className="px-6"
                        >
                            Save Report
                        </Button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default ScoutingReports;
