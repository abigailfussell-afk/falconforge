import React, { useState } from 'react';
import { useAppStore, ScoutingReport } from '../lib/store';
import { useSeasonScope, useSeasonScoped } from '../lib/season-scope';
import { useScoutingQuery } from '../lib/queries';
import { NOTES_MAX_LENGTH, TEAM_NUMBER_MAX_DIGITS, scoutingReportErrors } from '../lib/scouting-validation';
import { Plus, Trophy, Minus, Plus as PlusIcon, Trash2 } from 'lucide-react';
import Button from './ui/Button';
import Modal from './ui/Modal';
import EmptyState from './ui/EmptyState';
import ConfirmDialog from './ConfirmDialog';

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
    const { canEdit } = useSeasonScope();

    // Background refresh — fetches latest scouting data when this page is visited
    useScoutingQuery(currentTeamId);

    const [isScoutModalOpen, setIsScoutModalOpen] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [editingReportId, setEditingReportId] = useState<string | null>(null);

    const [newScout, setNewScout] = useState<Partial<ScoutingReport>>({
        hasAutonomous: false,
        autoScore: 0,
        intakeType: 'No Intake',
        autoAim: false,
        farShooting: false,
        shotsTaken: 0,
        shotsMissed: 0,
        parking: 'No Park',
        rating: 3,
        endGameNotes: ''
    });

    /*
     * Every rule about what a report may contain, asked in one place (WALK-A-06).
     *
     * The save button disables with a title saying why, instead of the old silent early-return
     * that ate the tap and kept the modal open with no explanation — at a venue that read as
     * "the app lost my entry". The same reasoning is why each field shows its own message: a
     * disabled button tells a scout that something is wrong and not which box.
     */
    const errors = scoutingReportErrors(newScout);
    const hasTeamNumber = Boolean(newScout.teamNumber?.trim());
    const canSave = Object.keys(errors).length === 0;

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
            hasAutonomous: newScout.hasAutonomous || false,
            autoScore: newScout.autoScore || 0,
            intakeType: newScout.intakeType || 'No Intake' as const,
            autoAim: newScout.autoAim || false,
            farShooting: newScout.farShooting || false,
            shotsTaken: newScout.shotsTaken || 0,
            shotsMissed: newScout.shotsMissed || 0,
            parking: newScout.parking || 'No Park' as const,
            endGameNotes: newScout.endGameNotes || '',
            rating: newScout.rating || 3
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
            hasAutonomous: report.hasAutonomous,
            autoScore: report.autoScore,
            intakeType: report.intakeType,
            autoAim: report.autoAim,
            farShooting: report.farShooting,
            shotsTaken: report.shotsTaken,
            shotsMissed: report.shotsMissed,
            parking: report.parking,
            rating: report.rating,
            endGameNotes: report.endGameNotes
        });
        setEditingReportId(report.id);
        setIsScoutModalOpen(true);
    };

    const handleDelete = (id: string) => {
        deleteScoutingReport(id);
        setDeleteConfirmId(null);
    };

    const resetForm = () => {
        setNewScout({
            hasAutonomous: false,
            autoScore: 0,
            intakeType: 'No Intake',
            autoAim: false,
            farShooting: false,
            shotsTaken: 0,
            shotsMissed: 0,
            parking: 'No Park',
            rating: 3,
            endGameNotes: '',
            eventName: ''
        });
    }

    const adjustCount = (field: 'shotsTaken' | 'shotsMissed', amount: number) => {
        setNewScout(prev => ({
            ...prev,
            [field]: Math.max(0, (prev[field] || 0) + amount)
        }));
    }

    /**
     * The ± steppers are the most-tapped controls in the scouting flow, so they get the
     * 44px coarse-pointer target, a hover, and a real disabled state at zero — the old
     * ones gave nothing back on any of the three. A render helper rather than a nested
     * component: a component declared per-render remounts its subtree on every keystroke.
     */
    const renderStepper = (field: 'shotsTaken' | 'shotsMissed', label: string) => (
        <div>
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">{label}</label>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => adjustCount(field, -1)}
                    disabled={(newScout[field] || 0) === 0}
                    aria-label={`Decrease ${label.toLowerCase()}`}
                    className="touch-target p-2 bg-slate-200 dark:bg-slate-600 rounded-lg text-slate-700 dark:text-slate-200 transition-colors enabled:hover:bg-slate-300 dark:enabled:hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Minus size={14} />
                </button>
                <span className="flex-1 text-center font-mono font-bold text-lg dark:text-white">{newScout[field]}</span>
                <button
                    type="button"
                    onClick={() => adjustCount(field, 1)}
                    aria-label={`Increase ${label.toLowerCase()}`}
                    className="touch-target p-2 bg-slate-200 dark:bg-slate-600 rounded-lg text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-300 dark:hover:bg-slate-500"
                >
                    <PlusIcon size={14} />
                </button>
            </div>
        </div>
    );

    return (
        <div className="h-full flex flex-col w-full">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Scouting Reports</h2>
                <Button
                    data-testid="scout-match"
                    onClick={() => setIsScoutModalOpen(true)}
                    disabled={!canEdit}
                    title={canEdit ? 'Scout a match' : 'This season is archived and read-only'}
                    className="px-2 md:px-4"
                >
                    <Plus size={20} /><span className="hidden md:inline">Scout Match</span>
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
                {scoutingReports.map(report => (
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
                            <div data-testid="scout-card-match" className="shrink-0 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md text-xs font-bold text-slate-600 dark:text-slate-300">
                                {report.matchNumber ? `Match ${report.matchNumber}` : 'No match #'}
                            </div>
                        </div>

                        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300 mb-4">
                            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-1">
                                <span>Autonomous</span>
                                <span className={report.hasAutonomous ? "text-green-600 dark:text-green-400 font-bold" : "text-slate-400"}>
                                    {report.hasAutonomous ? `${report.autoScore} pts` : 'No'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-1">
                                <span>Intake</span>
                                <span className="font-medium">{report.intakeType}</span>
                            </div>
                            {/* items-center, not the default stretch: this row's right side can be
                                two lines tall, and stretch dragged the left label's baseline down
                                with it while the other rows' labels stayed put. */}
                            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-1">
                                <span>Shooting</span>
                                <div className="text-right">
                                    <div>{report.shotsTaken - report.shotsMissed} / {report.shotsTaken} Shots</div>
                                    <div className="text-xs text-slate-400">
                                        {report.farShooting && 'Far '}{report.autoAim && 'Auto-Aim'}
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-1">
                                <span>Parking</span>
                                <span className="font-medium text-forge-600 dark:text-forge-400">{report.parking}</span>
                            </div>
                        </div>

                        {/* Trophies and Delete button row */}
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1 text-yellow-500">
                                {[...Array(5)].map((_, i) => (
                                    <Trophy key={i} size={14} fill={i < report.rating ? "currentColor" : "none"} className={i < report.rating ? "" : "text-slate-300 dark:text-slate-600"} />
                                ))}
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(report.id); }}
                                disabled={!canEdit}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title={canEdit ? 'Delete report' : 'This season is archived and read-only'}
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                        {report.endGameNotes && (
                            <p data-testid="scout-card-notes" className="text-xs bg-slate-50 dark:bg-slate-700 p-2 rounded-lg text-slate-500 dark:text-slate-300 italic break-words">
                                "{report.endGameNotes}"
                            </p>
                        )}
                    </div>
                ))}
                {scoutingReports.length === 0 && (
                    <div className="col-span-full bg-slate-50 dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                        <EmptyState
                            icon={Trophy}
                            title="No scouting data yet"
                            body="Reports your team scouts this season appear here."
                            action={
                                <Button
                                    size="sm"
                                    onClick={() => setIsScoutModalOpen(true)}
                                    disabled={!canEdit}
                                    title={canEdit ? 'Scout a match' : 'This season is archived and read-only'}
                                >
                                    <Plus size={16} /> Scout Match
                                </Button>
                            }
                        />
                    </div>
                )}
            </div>

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
                >
                    <div className="p-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 font-bold text-lg text-slate-900 dark:text-white">{editingReportId ? 'Edit Scouting Report' : 'New Scouting Report'}</div>
                    <div className="p-4 md:p-6 space-y-4 overflow-y-auto">
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
                                {/* `maxLength` stops typing past five, and a paste on some
                                    browsers gets through it — so the message is not decoration.
                                    It also carries the reason for the ones maxLength cannot
                                    catch at all: a sign, a space, an emoji. */}
                                {hasTeamNumber && errors.teamNumber && (
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
                                    step={1}
                                    aria-invalid={Boolean(errors.matchNumber)}
                                    className="field"
                                    placeholder="Optional"
                                    value={newScout.matchNumber ?? ''}
                                    onChange={e => setNewScout({
                                        ...newScout,
                                        // Clearing the field must yield undefined, not NaN (B18).
                                        matchNumber: e.target.value === ''
                                            ? undefined
                                            : parseInt(e.target.value, 10),
                                    })}
                                />
                                {/* `min` is advice to the browser, not enforcement: typing -5
                                    still puts -5 in the box. It used to be saved as "No match #"
                                    — accepted, discarded, and reported as never entered. */}
                                {errors.matchNumber && (
                                    <p data-testid="scout-match-number-error" className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.matchNumber}</p>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" htmlFor="scout-event-name">Event Name <span className="font-normal normal-case">(optional)</span></label>
                            <input
                                id="scout-event-name"
                                data-testid="scout-event-name"
                                type="text"
                                className="field"
                                placeholder="e.g. League Meet #3"
                                value={newScout.eventName || ''}
                                onChange={e => setNewScout({ ...newScout, eventName: e.target.value })}
                            />
                        </div>

                        {/* Autonomous Section */}
                        <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg space-y-3">
                            <h4 className="font-bold text-slate-700 dark:text-white text-sm">Autonomous</h4>
                            <label className="flex items-center gap-3 text-slate-800 dark:text-white">
                                <input
                                    type="checkbox"
                                    className="w-5 h-5 rounded accent-forge-600"
                                    checked={newScout.hasAutonomous}
                                    onChange={e => setNewScout({ ...newScout, hasAutonomous: e.target.checked })}
                                />
                                <span className="font-medium">Has Autonomous</span>
                            </label>
                            {newScout.hasAutonomous && (
                                <div>
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Auto Score</label>
                                    <input
                                        type="number"
                                        className="field"
                                        value={newScout.autoScore}
                                        onChange={e => setNewScout({ ...newScout, autoScore: parseInt(e.target.value) })}
                                    />
                                </div>
                            )}
                        </div>

                        {/* TeleOp Section */}
                        <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg space-y-3">
                            <h4 className="font-bold text-slate-700 dark:text-white text-sm">TeleOp</h4>

                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Intake Type</label>
                                <select
                                    className="field"
                                    value={newScout.intakeType}
                                    onChange={(e) => setNewScout({ ...newScout, intakeType: e.target.value as ScoutingReport['intakeType'] })}
                                >
                                    <option>No Intake</option>
                                    <option>Human Player</option>
                                    <option>Automatic</option>
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <label className="flex items-center gap-2 text-slate-800 dark:text-white text-sm">
                                    <input type="checkbox" className="accent-forge-600" checked={newScout.autoAim} onChange={e => setNewScout({ ...newScout, autoAim: e.target.checked })} />
                                    Auto Aim
                                </label>
                                <label className="flex items-center gap-2 text-slate-800 dark:text-white text-sm">
                                    <input type="checkbox" className="accent-forge-600" checked={newScout.farShooting} onChange={e => setNewScout({ ...newScout, farShooting: e.target.checked })} />
                                    Far Shooting
                                </label>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {renderStepper('shotsTaken', 'Shots Taken')}
                                {renderStepper('shotsMissed', 'Shots Missed')}
                            </div>
                        </div>

                        {/* End Game */}
                        <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg space-y-3">
                            <h4 className="font-bold text-slate-700 dark:text-white text-sm">End Game</h4>
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Parking</label>
                                <select
                                    className="field"
                                    value={newScout.parking}
                                    onChange={(e) => setNewScout({ ...newScout, parking: e.target.value as ScoutingReport['parking'] })}
                                >
                                    <option>No Park</option>
                                    <option>Partial Park</option>
                                    <option>Full Park</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Driver Rating (1-5)</label>
                            <input
                                type="range"
                                min="1" max="5"
                                className="w-full accent-forge-600"
                                value={newScout.rating || 3}
                                onChange={e => setNewScout({ ...newScout, rating: parseInt(e.target.value) })}
                            />
                            <div className="flex justify-between text-xs text-slate-400">
                                <span>Novice</span>
                                <span>Expert</span>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-baseline justify-between">
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" htmlFor="scout-notes">Notes</label>
                                {/* Shown from three-quarters full rather than always: a counter
                                    on an empty box is a limit announced to someone who was not
                                    going to reach it. */}
                                {(newScout.endGameNotes?.length || 0) > NOTES_MAX_LENGTH * 0.75 && (
                                    <span
                                        data-testid="scout-notes-remaining"
                                        className={errors.endGameNotes ? 'text-xs text-red-600 dark:text-red-400' : 'text-xs text-slate-500 dark:text-slate-400'}
                                    >
                                        {/* "-4500 left" is what this said when a paste got past
                                            `maxLength`, which is a number pretending to be an
                                            allowance. Over the cap it says how far over. */}
                                        {(newScout.endGameNotes?.length || 0) > NOTES_MAX_LENGTH
                                            ? `${(newScout.endGameNotes?.length || 0) - NOTES_MAX_LENGTH} over`
                                            : `${NOTES_MAX_LENGTH - (newScout.endGameNotes?.length || 0)} left`}
                                    </span>
                                )}
                            </div>
                            <textarea
                                id="scout-notes"
                                data-testid="scout-notes"
                                maxLength={NOTES_MAX_LENGTH}
                                aria-invalid={Boolean(errors.endGameNotes)}
                                className="field h-20"
                                value={newScout.endGameNotes || ''}
                                onChange={e => setNewScout({ ...newScout, endGameNotes: e.target.value })}
                            ></textarea>
                            {errors.endGameNotes && (
                                <p data-testid="scout-notes-error" className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.endGameNotes}</p>
                            )}
                        </div>
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
                                    ? 'This season is archived and read-only'
                                    : !hasTeamNumber
                                        ? 'Enter a team number first'
                                        // The field's own message, repeated on the button: on a
                                        // phone the offending box may be scrolled out of sight
                                        // by the time somebody wonders why Save is grey.
                                        : !canSave
                                            ? (errors.teamNumber || errors.matchNumber || errors.endGameNotes)
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
