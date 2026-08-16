import React, { useState } from 'react';
import { Calendar, Plus, Trash2, X, Upload, AlertTriangle, Archive, ArchiveRestore, Sparkles } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { suggestNextSeasonName } from '../lib/season-rules';
import type { SeasonRolloverInput } from '../lib/slices/createSeasonSlice';

/**
 * Seasons, and the rollover that starts a new one.
 *
 * "New season = fresh start" is the product's central idea: each year FTC releases a new
 * game, sub-team assignments are redrawn, and the sprint board, scouting data and match
 * plans start empty — while everything from the previous season stays browsable.
 *
 * The wizard below is the only place that idea is expressed as an action. What it does NOT
 * do is as important as what it does: sub-team MEMBERSHIPS are never carried forward. The
 * roster persists at team level; who was on Build last year is last year's decision, and
 * copying it silently re-assigns students who have graduated or moved on.
 */
const SeasonManager: React.FC = () => {
    const seasons = useAppStore((state) => state.seasons);
    const currentSeasonId = useAppStore((state) => state.currentSeasonId);
    const updateSeason = useAppStore((state) => state.updateSeason);
    const deleteSeason = useAppStore((state) => state.deleteSeason);
    const setSeasonArchived = useAppStore((state) => state.setSeasonArchived);
    const rollOverSeason = useAppStore((state) => state.rollOverSeason);
    const subTeams = useAppStore((state) => state.subTeams);
    const checklistTemplates = useAppStore((state) => state.checklistTemplates);
    const entitlement = useAppStore((state) => state.entitlement);

    const currentSeason = seasons.find((s) => s.id === currentSeasonId) ?? null;

    /*
     * THE INHERITED DEFECT THIS GUARD EXISTS FOR.
     *
     * Sprint 3 found that an unlicensed team's writes fail SILENTLY: the row appears in the
     * UI, the server refuses it (`can_manage_structure` requires `team_can_write`), and the
     * sync indicator reads "1 pending" with no reason given. The engine is behaving
     * correctly — it retries on the backoff schedule and then dead-letters — but the user is
     * told nothing and the work never lands.
     *
     * A rollover is a write gated on entitlement, so a lapsed team pressing "Start new
     * season" would get exactly that, and would be the SECOND feature to inherit it. So the
     * action is not offered. The full enforcement UX — the read-only banner and the lock
     * screens — is Sprint 6; this is the narrow half that stops one more feature queueing
     * work it cannot complete.
     *
     * Note the shape of the check: `=== 'read_only'`, not `!== 'active'`. A null entitlement
     * means the client has not managed to READ the view — offline, or the request failed —
     * and "we could not ask" is not the same as "you are not licensed". Blocking on it would
     * take the rollover away from every offline team, which is the one thing this sprint's
     * exit criteria say must keep working. The server is the boundary either way.
     */
    const isReadOnlyTeam = entitlement?.status === 'read_only';

    const [newSeasonName, setNewSeasonName] = useState('');
    const [editingSeasonId, setEditingSeasonId] = useState<string | null>(null);
    const [editSeasonName, setEditSeasonName] = useState('');
    const [editGameTitle, setEditGameTitle] = useState('');
    const [editFieldImageData, setEditFieldImageData] = useState('');
    const [deleteConfirmSeasonId, setDeleteConfirmSeasonId] = useState<string | null>(null);
    const [imageUploadError, setImageUploadError] = useState<string | null>(null);

    // The wizard.
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [rollover, setRollover] = useState<SeasonRolloverInput>({
        name: '',
        gameTitle: '',
        cloneSubTeams: true,
        checklistSource: 'previous',
        archivePrevious: true,
    });

    const openWizard = () => {
        setRollover({
            name: suggestNextSeasonName(currentSeason?.name),
            gameTitle: '',
            cloneSubTeams: true,
            checklistSource: 'previous',
            archivePrevious: true,
        });
        setIsWizardOpen(true);
    };

    const confirmRollover = () => {
        if (!rollover.name.trim() || isReadOnlyTeam) return;
        if (rollOverSeason({ ...rollover, fromSeasonId: currentSeasonId ?? undefined })) {
            setIsWizardOpen(false);
        }
    };

    const clonableSubTeams = subTeams.filter((s) => s.seasonId === currentSeasonId);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, seasonId: string) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImageUploadError(null);

        if (!file.type.startsWith('image/')) {
            setImageUploadError('Please select an image file');
            return;
        }

        if (file.size > 500 * 1024) {
            setImageUploadError('Image must be less than 500KB');
            return;
        }

        const img = document.createElement('img');
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            if (img.width > 1200 || img.height > 800) {
                setImageUploadError('Image must be max 1200×800 pixels');
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                setEditFieldImageData(base64);
                updateSeason(seasonId, { fieldImageData: base64 });
            };
            reader.readAsDataURL(file);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            setImageUploadError('Failed to load image');
        };

        img.src = objectUrl;
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 mt-6">
            <div className="flex items-center justify-between gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                <div className="flex items-center gap-2">
                    <Calendar className="text-orange-600" size={24} />
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Season Manager</h3>
                </div>
                <button
                    data-testid="start-new-season"
                    onClick={openWizard}
                    disabled={isReadOnlyTeam}
                    title={
                        isReadOnlyTeam
                            ? 'Your team’s licence has lapsed — renew it to start a new season'
                            : 'Start a new season'
                    }
                    className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <Sparkles size={16} /> Start New Season
                </button>
            </div>

            {isReadOnlyTeam && (
                <p
                    data-testid="rollover-blocked-reason"
                    className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
                >
                    Your team’s licence has lapsed, so it is read-only. Nothing has been
                    deleted — renew to start a new season.
                </p>
            )}

            {/* Adding a bare season without the rollover flow stays available: a team may
                want a second season in the same year (an off-season project) with none of
                the cloning. */}
            <div className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={newSeasonName}
                    onChange={(e) => setNewSeasonName(e.target.value)}
                    placeholder="Add an empty season (e.g. Off-Season 2027)"
                    disabled={isReadOnlyTeam}
                    className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSeasonName.trim() && !isReadOnlyTeam) {
                            rollOverSeason({
                                name: newSeasonName.trim(),
                                cloneSubTeams: false,
                                checklistSource: 'blank',
                                archivePrevious: false,
                            });
                            setNewSeasonName('');
                        }
                    }}
                />
                <button
                    data-testid="add-empty-season"
                    onClick={() => {
                        if (newSeasonName.trim() && !isReadOnlyTeam) {
                            rollOverSeason({
                                name: newSeasonName.trim(),
                                cloneSubTeams: false,
                                checklistSource: 'blank',
                                archivePrevious: false,
                            });
                            setNewSeasonName('');
                        }
                    }}
                    disabled={isReadOnlyTeam}
                    className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 transition flex items-center justify-center w-10 h-10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <Plus size={20} />
                </button>
            </div>

            <div className="space-y-3">
                {seasons.map((season) => (
                    <div key={season.id} data-testid={`season-row-${season.id}`} className={`border rounded-lg overflow-hidden ${currentSeasonId === season.id ? 'border-orange-400 ring-2 ring-orange-200 dark:ring-orange-900/50' : 'border-slate-200 dark:border-slate-600'}`}>
                        <div className="flex flex-wrap justify-between items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50">
                            <div className="flex items-center gap-2 flex-wrap">
                                {currentSeasonId === season.id && (
                                    <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full font-bold">Active</span>
                                )}
                                {season.isArchived && (
                                    <span
                                        data-testid={`archived-badge-${season.id}`}
                                        className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                    >
                                        <Archive size={11} /> Archived
                                    </span>
                                )}
                                <h4 className="font-bold text-slate-700 dark:text-slate-200">{season.name}</h4>
                                {season.gameTitle && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">· {season.gameTitle}</span>
                                )}
                            </div>
                            <div className="flex gap-2 items-center">
                                {/*
                                  * Archiving is reversible, and has to be. The `seasons` table
                                  * is deliberately NOT gated on its own archive flag
                                  * server-side, so a season closed by mistake can be reopened
                                  * from here rather than needing a database round trip.
                                  */}
                                <button
                                    data-testid={`toggle-archive-${season.id}`}
                                    onClick={() => setSeasonArchived(season.id, !season.isArchived)}
                                    className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:text-orange-600 dark:bg-slate-600 dark:text-slate-300"
                                    title={season.isArchived ? 'Reopen this season for editing' : 'Archive: keep it readable, stop accepting edits'}
                                >
                                    {season.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                                    {season.isArchived ? 'Reopen' : 'Archive'}
                                </button>
                                <button
                                    onClick={() => {
                                        if (editingSeasonId === season.id) {
                                            setEditingSeasonId(null);
                                        } else {
                                            setEditingSeasonId(season.id);
                                            setEditSeasonName(season.name);
                                            setEditGameTitle(season.gameTitle || '');
                                            setEditFieldImageData(season.fieldImageData || '');
                                            setImageUploadError(null);
                                        }
                                    }}
                                    className={`text-xs px-3 py-1.5 rounded-full transition ${editingSeasonId === season.id ? 'bg-orange-100 text-orange-700' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                                >
                                    {editingSeasonId === season.id ? 'Done' : 'Edit'}
                                </button>
                                {seasons.length > 1 && (
                                    <button
                                        onClick={() => setDeleteConfirmSeasonId(season.id)}
                                        className="text-slate-400 hover:text-red-500 p-1"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {editingSeasonId === season.id && (
                            <div className="p-3 bg-white dark:bg-slate-800 space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Season Name</label>
                                    <input
                                        type="text"
                                        value={editSeasonName}
                                        onChange={(e) => setEditSeasonName(e.target.value)}
                                        onBlur={() => editSeasonName.trim() && updateSeason(season.id, { name: editSeasonName.trim() })}
                                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Game</label>
                                    <input
                                        type="text"
                                        data-testid={`edit-game-title-${season.id}`}
                                        value={editGameTitle}
                                        onChange={(e) => setEditGameTitle(e.target.value)}
                                        onBlur={() => updateSeason(season.id, { gameTitle: editGameTitle.trim() })}
                                        placeholder="e.g. DECODE"
                                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Field Image (for Match Planner)</label>
                                    {editFieldImageData && (
                                        <div className="mb-2 relative">
                                            <img
                                                src={editFieldImageData}
                                                alt="Field preview"
                                                className="w-full max-h-40 object-contain rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-900"
                                            />
                                            <button
                                                onClick={() => {
                                                    setEditFieldImageData('');
                                                    updateSeason(season.id, { fieldImageData: '' });
                                                }}
                                                className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                                                title="Remove image"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    )}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => handleImageUpload(e, season.id)}
                                        className="hidden"
                                        id={`field-image-${season.id}`}
                                    />
                                    <label
                                        htmlFor={`field-image-${season.id}`}
                                        className="flex items-center justify-center gap-2 w-full p-3 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition"
                                    >
                                        <Upload size={18} />
                                        <span className="text-sm font-medium">{editFieldImageData ? 'Replace Image' : 'Upload Field Image'}</span>
                                    </label>
                                    {imageUploadError && (
                                        <p className="text-xs text-red-500 mt-1">{imageUploadError}</p>
                                    )}
                                    <p className="text-[10px] text-slate-400 mt-1">Max: 1200×800 pixels, 500KB. Recommended: 3:2 ratio.</p>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {isWizardOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div
                        data-testid="new-season-wizard"
                        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800"
                    >
                        <div className="mb-4 flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
                                <Sparkles className="text-orange-600" size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Start a New Season</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    A clean sprint board, scouting log and match planner. Everything
                                    from {currentSeason?.name ?? 'the current season'} stays readable.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                    Season Name *
                                </label>
                                <input
                                    type="text"
                                    data-testid="wizard-season-name"
                                    value={rollover.name}
                                    onChange={(e) => setRollover({ ...rollover, name: e.target.value })}
                                    placeholder="e.g. 2027-2028 Season"
                                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                    Game
                                </label>
                                <input
                                    type="text"
                                    data-testid="wizard-game-title"
                                    value={rollover.gameTitle ?? ''}
                                    onChange={(e) => setRollover({ ...rollover, gameTitle: e.target.value })}
                                    placeholder="e.g. DECODE"
                                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                                />
                            </div>

                            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-600">
                                <input
                                    type="checkbox"
                                    data-testid="wizard-clone-subteams"
                                    checked={rollover.cloneSubTeams !== false}
                                    onChange={(e) => setRollover({ ...rollover, cloneSubTeams: e.target.checked })}
                                    className="mt-0.5"
                                />
                                <span className="text-sm text-slate-700 dark:text-slate-200">
                                    Copy the sub-team structure
                                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                                        {clonableSubTeams.length > 0
                                            ? `${clonableSubTeams.map((s) => s.name).join(', ')} — names only. `
                                            : 'There are no sub-teams to copy. '}
                                        Member assignments always start empty; your roster is unchanged.
                                    </span>
                                </span>
                            </label>

                            <div>
                                <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                    Pre-Match Checklist
                                </label>
                                <select
                                    data-testid="wizard-checklist-source"
                                    value={rollover.checklistSource ?? 'previous'}
                                    onChange={(e) =>
                                        setRollover({
                                            ...rollover,
                                            checklistSource: e.target.value as SeasonRolloverInput['checklistSource'],
                                        })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                                >
                                    <option value="previous">Copy this season’s items (all unticked)</option>
                                    <option value="blank">Start with an empty checklist</option>
                                    {checklistTemplates.map((template) => (
                                        <option key={template.id} value={`template:${template.id}`}>
                                            From template: {template.name}
                                        </option>
                                    ))}
                                </select>
                                {checklistTemplates.length === 0 && (
                                    <p className="mt-1 text-[11px] text-slate-400">
                                        Save a checklist as a team template from the Pre-Match
                                        Checklist page to reuse it here.
                                    </p>
                                )}
                            </div>

                            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-600">
                                <input
                                    type="checkbox"
                                    data-testid="wizard-archive-previous"
                                    checked={rollover.archivePrevious !== false}
                                    onChange={(e) => setRollover({ ...rollover, archivePrevious: e.target.checked })}
                                    className="mt-0.5"
                                />
                                <span className="text-sm text-slate-700 dark:text-slate-200">
                                    Archive {currentSeason?.name ?? 'the current season'}
                                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                                        It stays fully readable and stops accepting edits. You can
                                        reopen it at any time.
                                    </span>
                                </span>
                            </label>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => setIsWizardOpen(false)}
                                className="rounded-lg px-4 py-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                            >
                                Cancel
                            </button>
                            <button
                                data-testid="wizard-confirm"
                                onClick={confirmRollover}
                                disabled={!rollover.name.trim() || isReadOnlyTeam}
                                className="rounded-lg bg-orange-600 px-4 py-2 font-medium text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Create Season
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteConfirmSeasonId && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                                <AlertTriangle className="text-red-600" size={24} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Delete Season?</h3>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mb-2">
                            <strong>Warning:</strong> This will permanently delete the season <strong>"{seasons.find(s => s.id === deleteConfirmSeasonId)?.name}"</strong> and ALL associated data:
                        </p>
                        <ul className="text-sm text-slate-500 dark:text-slate-400 list-disc list-inside mb-4">
                            <li>All tasks</li>
                            <li>All sub-team assignments</li>
                            <li>All scouting reports</li>
                            <li>All match plans</li>
                            <li>The pre-match checklist</li>
                        </ul>
                        <p className="text-red-600 dark:text-red-400 text-sm font-medium mb-6">This action cannot be undone. To keep the season’s history, archive it instead.</p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirmSeasonId(null)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { deleteSeason(deleteConfirmSeasonId); setDeleteConfirmSeasonId(null); }}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
                            >
                                Delete Season
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SeasonManager;
