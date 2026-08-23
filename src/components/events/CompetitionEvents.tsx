import { useMemo, useState } from 'react';
import { CalendarDays, Plus, Trash2, ClipboardPaste, Pencil } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useSeasonScope, useSeasonScoped } from '../../lib/season-scope';
import { useAccessState } from '../../lib/entitlement';
import { resolveGameForSeason } from '../../lib/games';
import { importSchedule } from '../../lib/event-import';
import type { ParsedMatch } from '../../lib/schedule-parse';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import SectionHeader from '../ui/SectionHeader';
import ConfirmDialog from '../ConfirmDialog';
import SchedulePasteImport from './SchedulePasteImport';

/**
 * Competitions, and the schedule at each (D2).
 *
 * MANUAL ENTRY IS THE SUBSTRATE, NOT THE FALLBACK. Kevin, 2026-08-23: *"every field the parser
 * fills must be enterable and editable by hand. A coach with no published schedule yet — normal
 * on the morning of an event — must be able to build the whole thing manually."* So this screen
 * is a complete manual editor that happens to have an import button, rather than an import
 * screen with a manual escape hatch. Every field the parser writes has a control here.
 *
 * AND EVERYTHING STAYS EDITABLE AFTERWARDS, which is the reason D2 gives that matters most at a
 * venue: *"surrogates and mid-event schedule changes are routine, so an imported schedule that
 * cannot be corrected is wrong by lunchtime."*
 */
export default function CompetitionEvents() {
    const { season } = useSeasonScope();
    const { canEdit, editRefusalReason } = useAccessState();

    const events = useSeasonScoped(useAppStore((s) => s.competitionEvents));
    const allMatches = useAppStore((s) => s.eventMatches);
    const allParticipants = useAppStore((s) => s.matchParticipants);
    const currentTeam = useAppStore((s) => s.teams.find((t) => t.id === s.currentTeamId));

    const addCompetitionEvent = useAppStore((s) => s.addCompetitionEvent);
    const deleteCompetitionEvent = useAppStore((s) => s.deleteCompetitionEvent);
    const addEventMatch = useAppStore((s) => s.addEventMatch);
    const updateEventMatch = useAppStore((s) => s.updateEventMatch);
    const deleteEventMatch = useAppStore((s) => s.deleteEventMatch);
    const addMatchParticipant = useAppStore((s) => s.addMatchParticipant);
    const updateMatchParticipant = useAppStore((s) => s.updateMatchParticipant);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [newCode, setNewCode] = useState('');
    const [newDate, setNewDate] = useState('');
    const [importNote, setImportNote] = useState<string | null>(null);

    /*
     * FTC is 2v2 and FRC is 3v3 (D3's knock-on), and the number comes from the game rather than
     * from a constant here. It decides how many teams the parser looks for on a line and how
     * many station slots a hand-built match gets.
     */
    const allianceSize = (resolveGameForSeason(season).match.allianceSize === 3 ? 3 : 2) as 2 | 3;

    const selected = events.find((e) => e.id === selectedId) ?? null;

    const matches = useMemo(
        () =>
            allMatches
                .filter((m) => m.eventId === selectedId)
                /*
                 * Phase then number, both explicitly. A qualification 12 and a playoff 12 are
                 * different matches, and sorting by a rendered label puts "Qualification 10"
                 * before "Qualification 9" — `docs/failure-modes.md` §13 is three instances of
                 * relying on an ordering nothing promised.
                 */
                .sort((a, b) => {
                    const order = { practice: 0, qualification: 1, playoff: 2 };
                    return order[a.phase] - order[b.phase] || a.matchNumber - b.matchNumber;
                }),
        [allMatches, selectedId],
    );

    const participantsFor = (matchId: string) =>
        allParticipants
            .filter((p) => p.matchId === matchId)
            .sort(
                (a, b) =>
                    (a.alliance === 'red' ? 0 : 1) - (b.alliance === 'red' ? 0 : 1) ||
                    a.station - b.station,
            );

    const createEvent = () => {
        const id = addCompetitionEvent({
            name: newName,
            eventCode: newCode,
            startsOn: newDate,
        });
        if (id) {
            setSelectedId(id);
            setNewName('');
            setNewCode('');
            setNewDate('');
        }
    };

    /** Add a match by hand, with an empty slot per station — D2's substrate. */
    const addBlankMatch = () => {
        if (!selectedId) return;
        const next =
            matches
                .filter((m) => m.phase === 'qualification')
                .reduce((max, m) => Math.max(max, m.matchNumber), 0) + 1;
        const matchId = addEventMatch({
            eventId: selectedId,
            phase: 'qualification',
            matchNumber: next,
        });
        if (!matchId) return;
        for (const alliance of ['red', 'blue'] as const) {
            for (let station = 1; station <= allianceSize; station++) {
                addMatchParticipant({
                    matchId,
                    alliance,
                    station,
                    // '0' rather than '': `team_number` is NOT NULL with a length CHECK of 1-5,
                    // so an empty string is a row the database refuses and the queue parks. A
                    // placeholder the coach overwrites is a row that exists.
                    teamNumber: '0',
                    isSurrogate: false,
                });
            }
        }
    };

    const confirmImport = (parsed: ParsedMatch[]) => {
        const store = useAppStore.getState();
        const result = importSchedule(store, {
            eventId: selectedId ?? undefined,
            newEvent: selectedId ? undefined : { name: newName || 'Imported event' },
            matches: parsed,
        });
        setIsImporting(false);
        if (result.eventId) setSelectedId(result.eventId);
        setImportNote(
            `Imported ${result.matchesCreated} match${result.matchesCreated === 1 ? '' : 'es'}` +
                (result.duplicatesSkipped
                    ? `, skipped ${result.duplicatesSkipped} already here`
                    : '') +
                '. Everything below is editable.',
        );
    };

    return (
        <div className="space-y-4" data-testid="competition-events">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Competitions</h2>
                <Button
                    data-testid="import-schedule"
                    variant="secondary"
                    onClick={() => setIsImporting(true)}
                    disabled={!canEdit}
                    title={canEdit ? 'Paste a schedule from the FIRST event page' : editRefusalReason}
                >
                    <ClipboardPaste size={15} /> Import a schedule
                </Button>
            </div>

            {importNote && (
                <p
                    role="status"
                    data-testid="import-note"
                    className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300"
                >
                    {importNote}
                </p>
            )}

            {/* ---------------------------------------------------------- the events */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={CalendarDays} title="Events this season" />

                {events.length === 0 ? (
                    <EmptyState
                        icon={CalendarDays}
                        title="No competitions yet"
                        body="Add the event first, then paste its schedule — or build the schedule by hand if it has not been published."
                    />
                ) : (
                    <ul className="space-y-2" data-testid="event-list">
                        {events.map((event) => (
                            <li key={event.id} className="flex items-stretch gap-2">
                                <button
                                    type="button"
                                    data-testid="event-row"
                                    onClick={() => setSelectedId(event.id === selectedId ? null : event.id)}
                                    aria-current={selectedId === event.id}
                                    className={`min-w-0 flex-1 rounded-lg border p-3 text-left transition-colors ${
                                        selectedId === event.id
                                            ? 'border-forge-500 bg-forge-500/10'
                                            : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-700/50'
                                    }`}
                                >
                                    <span className="block truncate font-semibold text-slate-800 dark:text-white">
                                        {event.name}
                                    </span>
                                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                                        {/* The date as STORED, never re-parsed: a `YYYY-MM-DD`
                                            round-tripped through a Date renders one day early at
                                            negative UTC offsets (failure-modes §10). */}
                                        {event.startsOn || 'no date'}
                                        {event.eventCode ? ` · ${event.eventCode}` : ''}
                                        {' · '}
                                        {allMatches.filter((m) => m.eventId === event.id).length}{' '}
                                        matches
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    data-testid="delete-event"
                                    onClick={() => setDeleteEventId(event.id)}
                                    disabled={!canEdit}
                                    title={canEdit ? `Delete ${event.name}` : editRefusalReason}
                                    aria-label={`Delete ${event.name}`}
                                    className="touch-target shrink-0 rounded-lg border border-slate-200 px-3 text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {/* Manual creation, always available. D2's substrate. */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                        data-testid="new-event-name"
                        className="field min-w-0 flex-1"
                        placeholder="Event name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        disabled={!canEdit}
                        title={canEdit ? undefined : editRefusalReason}
                    />
                    <input
                        data-testid="new-event-code"
                        className="field w-32 shrink-0"
                        placeholder="Code (optional)"
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value)}
                        disabled={!canEdit}
                        title={canEdit ? undefined : editRefusalReason}
                    />
                    <input
                        aria-label="Event date"
                        data-testid="new-event-date"
                        className="field w-auto shrink-0"
                        type="date"
                        value={newDate}
                        onChange={(e) => setNewDate(e.target.value)}
                        disabled={!canEdit}
                        title={canEdit ? undefined : editRefusalReason}
                    />
                    <Button
                        data-testid="add-event"
                        onClick={createEvent}
                        disabled={!canEdit || !newName.trim()}
                        title={
                            !canEdit
                                ? editRefusalReason
                                : !newName.trim()
                                  ? 'Give the event a name'
                                  : 'Add this event'
                        }
                    >
                        <Plus size={15} /> Add
                    </Button>
                </div>
            </div>

            {/* ---------------------------------------------------------- one event */}
            {selected && (
                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                    <SectionHeader icon={Pencil} title={`${selected.name} — schedule`} />

                    {matches.length === 0 ? (
                        <EmptyState
                            icon={CalendarDays}
                            title="No matches yet"
                            body="Paste the schedule, or add matches one at a time — a schedule that has not been published yet is the normal case on the morning of an event."
                        />
                    ) : (
                        <ul className="space-y-2" data-testid="match-list">
                            {matches.map((match) => (
                                <li
                                    key={match.id}
                                    data-testid="match-row"
                                    className="rounded-lg border border-slate-200 p-2 dark:border-slate-700"
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <select
                                            aria-label="Phase"
                                            className="field w-auto py-1 text-xs"
                                            value={match.phase}
                                            disabled={!canEdit}
                                            title={canEdit ? undefined : editRefusalReason}
                                            onChange={(e) =>
                                                updateEventMatch(match.id, {
                                                    phase: e.target.value as typeof match.phase,
                                                })
                                            }
                                        >
                                            <option value="practice">Practice</option>
                                            <option value="qualification">Qualification</option>
                                            <option value="playoff">Playoff</option>
                                        </select>
                                        <input
                                            aria-label="Match number"
                                            type="number"
                                            min={1}
                                            className="field w-20 py-1 text-xs"
                                            value={match.matchNumber}
                                            disabled={!canEdit}
                                            title={canEdit ? undefined : editRefusalReason}
                                            onChange={(e) => {
                                                const parsed = Number.parseInt(e.target.value, 10);
                                                if (!Number.isNaN(parsed) && parsed >= 1) {
                                                    updateEventMatch(match.id, { matchNumber: parsed });
                                                }
                                            }}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
                                            {match.notes || 'no time'}
                                        </span>
                                        <button
                                            type="button"
                                            data-testid="delete-match"
                                            onClick={() => deleteEventMatch(match.id)}
                                            disabled={!canEdit}
                                            title={canEdit ? 'Delete this match' : editRefusalReason}
                                            aria-label={`Delete match ${match.matchNumber}`}
                                            className="touch-target rounded-lg px-2 text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>

                                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                        {(['red', 'blue'] as const).map((alliance) => (
                                            <div key={alliance}>
                                                <span
                                                    className={
                                                        alliance === 'red'
                                                            ? 'text-2xs font-bold uppercase text-red-600 dark:text-red-400'
                                                            : 'text-2xs font-bold uppercase text-blue-600 dark:text-blue-400'
                                                    }
                                                >
                                                    {alliance}
                                                </span>
                                                {participantsFor(match.id)
                                                    .filter((p) => p.alliance === alliance)
                                                    .map((p) => (
                                                        <div
                                                            key={p.id}
                                                            className="mt-1 flex items-center gap-1"
                                                            data-testid="participant-row"
                                                        >
                                                            <input
                                                                aria-label={`${alliance} station ${p.station} team number`}
                                                                className="field w-20 py-1 text-xs"
                                                                inputMode="numeric"
                                                                maxLength={5}
                                                                value={p.teamNumber}
                                                                disabled={!canEdit}
                                                                title={canEdit ? undefined : editRefusalReason}
                                                                onChange={(e) =>
                                                                    updateMatchParticipant(p.id, {
                                                                        teamNumber: e.target.value.replace(/\D/g, '').slice(0, 5),
                                                                    })
                                                                }
                                                            />
                                                            <input
                                                                aria-label={`${alliance} station ${p.station} team name`}
                                                                className="field min-w-0 flex-1 py-1 text-xs"
                                                                value={p.teamName ?? ''}
                                                                disabled={!canEdit}
                                                                title={canEdit ? undefined : editRefusalReason}
                                                                onChange={(e) =>
                                                                    updateMatchParticipant(p.id, {
                                                                        teamName: e.target.value.slice(0, 60),
                                                                    })
                                                                }
                                                            />
                                                            {/*
                                                              * THE REASON PARTICIPANTS ARE ROWS.
                                                              * A surrogate plays a match that
                                                              * does not count for them, and D2
                                                              * calls it routine — so it is a
                                                              * checkbox on the row rather than
                                                              * something the schema cannot say.
                                                              */}
                                                            <label
                                                                className="flex shrink-0 items-center gap-1 text-2xs text-slate-500 dark:text-slate-400"
                                                                title={
                                                                    canEdit
                                                                        ? 'Playing a match that does not count for them'
                                                                        : editRefusalReason
                                                                }
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    className="accent-forge-600"
                                                                    checked={p.isSurrogate}
                                                                    disabled={!canEdit}
                                                                    onChange={(e) =>
                                                                        updateMatchParticipant(p.id, {
                                                                            isSurrogate: e.target.checked,
                                                                        })
                                                                    }
                                                                />
                                                                sur
                                                            </label>
                                                        </div>
                                                    ))}
                                            </div>
                                        ))}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="mt-3">
                        <Button
                            data-testid="add-match"
                            variant="secondary"
                            size="sm"
                            onClick={addBlankMatch}
                            disabled={!canEdit}
                            title={canEdit ? 'Add a match by hand' : editRefusalReason}
                        >
                            <Plus size={14} /> Add a match
                        </Button>
                    </div>
                </div>
            )}

            {isImporting && (
                <SchedulePasteImport
                    ourTeamNumber={currentTeam?.teamNumber ?? undefined}
                    allianceSize={allianceSize}
                    onCancel={() => setIsImporting(false)}
                    onConfirm={confirmImport}
                />
            )}

            {deleteEventId && (
                <ConfirmDialog
                    title="Delete this event?"
                    message="The event and its whole schedule are removed. Scouting reports are not touched — they carry their own event name."
                    onConfirm={() => {
                        deleteCompetitionEvent(deleteEventId);
                        if (selectedId === deleteEventId) setSelectedId(null);
                        setDeleteEventId(null);
                    }}
                    onCancel={() => setDeleteEventId(null)}
                />
            )}
        </div>
    );
}
