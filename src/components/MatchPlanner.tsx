import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { resolveGameForSeason } from '../lib/games';
import { Pen, Save, Trash2, Undo, Redo, FolderOpen, X, CheckCircle } from 'lucide-react';
import { useAppStore, MatchPlan } from '../lib/store';
import { useSeasonScoped } from '../lib/season-scope';
import { useAccessState } from '../lib/entitlement';
import { useMatchPlansQuery } from '../lib/queries';
import { ensureSeasonFieldImage } from '../lib/server-pull';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import Modal from './ui/Modal';
import EmptyState from './ui/EmptyState';
import ConfirmDialog from './ConfirmDialog';

/**
 * The pen palette. Named so the swatch row can render from data, and so the visible dot
 * and its hit area can differ: the dot stays small, the button around it claims the 44px
 * coarse-pointer target — the old 12px `w-3 h-3` dots were the hardest tap in the app on
 * the device the app is for.
 */
const PEN_COLORS = [
    { hex: '#ef4444', bg: 'bg-red-500', name: 'red' },
    { hex: '#3b82f6', bg: 'bg-blue-500', name: 'blue' },
    { hex: '#22c55e', bg: 'bg-green-500', name: 'green' },
    { hex: '#facc15', bg: 'bg-yellow-400', name: 'yellow' },
];

// Fixed viewBox dimensions for consistent coordinate storage
const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 600;

const MatchPlanner: React.FC = () => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [color, setColor] = useState('#ef4444'); // Red default
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(true);
  // Simple history stack for undo/redo
  const { matchPlans: allMatchPlans, addMatchPlan, updateMatchPlan, deleteMatchPlan, getCurrentSeason, currentTeamId } = useAppStore();
  const { canEdit, editRefusalReason } = useAccessState();

  // Background refresh — fetches latest match plans when this page is visited
  useMatchPlansQuery(currentTeamId);

  const currentSeason = getCurrentSeason();

  /*
   * The field image is not part of the season pull, and this is the screen that wants it.
   *
   * `field_image_data` is base64 in a column — up to ~670 KB of text — and it used to be
   * fetched with every `seasons` read, which is every app open, whether or not anybody opened
   * the match planner (SYNC-03). It is fetched once per season here instead; `undefined` in
   * the store means "not fetched" and `''` means "this season has no image", so the default
   * field is drawn immediately either way and the custom one replaces it when it lands.
   */
  useEffect(() => {
    if (currentSeason?.id) ensureSeasonFieldImage(currentSeason.id).catch(console.warn);
  }, [currentSeason?.id]);

  /**
   * The game this season plays, for the field image and the partner-capability labels.
   *
   * The team's own patch is NOT applied here, deliberately: a patch changes the SCOUTING form,
   * and the planner's two capability checkboxes are database columns (`partner_autonomous`,
   * `partner_park`) rather than schema fields. Resolving the patch would imply they could be
   * hidden or added to, which they cannot — that is a phase-M change to `match_plans`, not a
   * relabel.
   */
  const game = resolveGameForSeason(currentSeason);

  // Field image: can be Base64 data URL, full URL, or local file path
  const customFieldImage = currentSeason?.fieldImageData;
  const fieldImageSrc = customFieldImage
    ? (customFieldImage.startsWith('data:') || customFieldImage.startsWith('http')
      ? customFieldImage
      : `${import.meta.env.BASE_URL}${customFieldImage}`)
    // The season's own game decides the default field, so a new September is a new JSON
    // file rather than an edit to `constants.ts` (P-01 phase S). A season-specific uploaded
    // image still wins: a team that photographed their own field wants that.
    : `${import.meta.env.BASE_URL}${game.field.image}`;
  const matchPlans = useSeasonScoped(allMatchPlans);
  const [paths, setPaths] = useState<{ d: string, stroke: string, width: number }[]>([]);
  const [undoHistory, setUndoHistory] = useState<{ d: string, stroke: string, width: number }[]>([]);
  const [currentPath, setCurrentPath] = useState('');

  // Persisted state
  const [alliancePartner, setAlliancePartner] = useState('');
  const [strategyNotes, setStrategyNotes] = useState('');
  const [autonomous, setAutonomous] = useState(false);
  const [parked, setParked] = useState(false);

  // UI State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  const [planTitle, setPlanTitle] = useState('');
  const [matchNumber, setMatchNumber] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  /**
   * The plan currently on the canvas, if it came from Load (FEAT-05).
   *
   * Without it `handleSave` could only ever `addMatchPlan`, so Load → edit → Save produced a
   * SECOND "Match 3" and left the original untouched — `updateMatchPlan` existed with no
   * caller outside its own test (`docs/failure-modes.md` §7, a door with no gate). The drive
   * team editing a plan between matches is exactly who hit it.
   */
  const [loadedPlanId, setLoadedPlanId] = useState<string | null>(null);

  /**
   * `match_number` is an integer column, and 0 is not "not recorded" (B18).
   *
   * `parseInt('')` is NaN and `NaN || 0` is 0, which is how five of nine live production
   * scouting rows were corrupted. Empty stays undefined here rather than becoming a number.
   */
  const parsedMatchNumber = (): number | undefined => {
    const trimmed = matchNumber.trim();
    if (!trimmed) return undefined;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  /** What Save writes, in both directions. One object, so update and create cannot drift. */
  const planFromCanvas = () => ({
    title: planTitle.trim() || defaultPlanTitle(),
    matchNumber: parsedMatchNumber(),
    drawingData: paths,
    notes: strategyNotes,
    allianceTeam: alliancePartner,
    partnerAutonomous: autonomous,
    partnerPark: parked,
  });

  const defaultPlanTitle = () => {
    const n = parsedMatchNumber();
    return n ? `Match ${n}` : `Match Plan ${new Date().toLocaleString()}`;
  };

  const finishSave = () => {
    setSaveStatus('success');
    // Show success message briefly, then close modal
    setTimeout(() => {
      setIsSaveModalOpen(false);
      setSaveStatus('idle');
    }, 1500);
  };

  /**
   * Save over the plan that was loaded, when there is one (FEAT-05).
   *
   * The title is deliberately NOT cleared afterwards: the canvas still holds that plan, so
   * re-opening Save has to show what it is about to overwrite.
   */
  const handleSave = () => {
    setSaveStatus('saving');
    if (loadedPlanId) {
      updateMatchPlan(loadedPlanId, planFromCanvas());
    } else {
      addMatchPlan(planFromCanvas());
      setPlanTitle('');
    }
    finishSave();
  };

  /** Save the edited canvas as a NEW plan, keeping the one it was loaded from. */
  const handleSaveAsCopy = () => {
    setSaveStatus('saving');
    addMatchPlan(planFromCanvas());
    setLoadedPlanId(null);
    finishSave();
  };

  const handleLoad = (plan: MatchPlan) => {
    setPaths(plan.drawingData);
    setAlliancePartner(plan.allianceTeam);
    setStrategyNotes(plan.notes);
    setAutonomous(plan.partnerAutonomous);
    setParked(plan.partnerPark);
    // Remembering WHICH plan is what makes the next Save an update rather than a duplicate.
    setLoadedPlanId(plan.id);
    setPlanTitle(plan.title);
    setMatchNumber(plan.matchNumber ? String(plan.matchNumber) : '');
    setIsLoadModalOpen(false);
  };

  // Setup D3 drawing logic
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);

    // Drag logic for objects (simple circles representing robots)
    const drag = d3.drag<SVGCircleElement, unknown>()
      .on("start", function (_event) {
        d3.select(this).raise().attr("stroke", "white").attr("stroke-width", 3);
      })
      .on("drag", function (event) {
        if (!isDrawingEnabled) {
          d3.select(this).attr("cx", event.x).attr("cy", event.y);
        }
      })
      .on("end", function (_event) {
        d3.select(this).attr("stroke", "white").attr("stroke-width", 2);
      });

    svg.selectAll(".draggable-robot").call(drag as any);

  }, [isDrawingEnabled]);

  // Convert client coordinates to viewBox coordinates
  const getViewBoxCoords = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const svgPoint = point.matrixTransform(ctm.inverse());
    return { x: svgPoint.x, y: svgPoint.y };
  };

  // Handle Drawing events cleanly
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isDrawingEnabled) return;
    const svg = svgRef.current;
    if (!svg) return;

    const coords = getViewBoxCoords(e);
    if (!coords) return;

    setCurrentPath(`M ${coords.x} ${coords.y}`);
    (svg as any).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawingEnabled || !currentPath) return;

    const coords = getViewBoxCoords(e);
    if (!coords) return;

    // Add point to path using viewBox coordinates
    setCurrentPath(prev => `${prev} L ${coords.x} ${coords.y}`);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDrawingEnabled || !currentPath) return;

    // Commit path and clear redo history
    setPaths([...paths, { d: currentPath, stroke: color, width: 3 }]);
    setUndoHistory([]);
    setCurrentPath('');
    if (svgRef.current) (svgRef.current as any).releasePointerCapture(e.pointerId);
  };

  const handleUndo = () => {
    if (paths.length === 0) return;
    const newPaths = [...paths];
    const removedPath = newPaths.pop();
    if (removedPath) {
      setUndoHistory([...undoHistory, removedPath]);
    }
    setPaths(newPaths);
  };

  const handleRedo = () => {
    if (undoHistory.length === 0) return;
    const newHistory = [...undoHistory];
    const restoredPath = newHistory.pop();
    if (restoredPath) {
      setPaths([...paths, restoredPath]);
    }
    setUndoHistory(newHistory);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-2 md:gap-4 lg:h-full h-auto lg:overflow-hidden overflow-visible">
      <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden relative min-h-canvas lg:min-h-0">
        <div className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-700 p-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-600 shadow-card">
          <div className="flex items-center gap-1 md:gap-2">
            <button
              onClick={() => setIsDrawingEnabled(!isDrawingEnabled)}
              className={`p-2 rounded-lg flex items-center justify-center transition-colors ${isDrawingEnabled ? 'bg-white dark:bg-slate-600 shadow-card text-forge-600 dark:text-forge-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
              title={isDrawingEnabled ? 'Drawing ON (click to toggle)' : 'Drawing OFF (click to toggle)'}
            >
              <Pen size={18} />
            </button>
            <div className="h-6 w-px bg-slate-300 dark:bg-slate-600"></div>
            {PEN_COLORS.map(({ hex, bg, name }) => (
              <button
                key={hex}
                onClick={() => setColor(hex)}
                title={`Draw in ${name}`}
                aria-label={`Draw in ${name}`}
                aria-pressed={color === hex}
                className="touch-target p-1 rounded-full"
              >
                <span className={`block w-4 h-4 md:w-5 md:h-5 rounded-full ${bg} border-2 transition-colors ${color === hex ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <IconButton onClick={handleUndo} disabled={paths.length === 0} title="Undo">
              <Undo size={18} />
            </IconButton>
            <IconButton onClick={handleRedo} disabled={undoHistory.length === 0} title="Redo">
              <Redo size={18} />
            </IconButton>
            <IconButton
              danger
              onClick={() => { setPaths([]); setUndoHistory([]); }}
              disabled={paths.length === 0 && undoHistory.length === 0}
              title="Clear drawing"
            >
              <Trash2 size={18} />
            </IconButton>
            <div className="h-5 w-px bg-slate-300 dark:bg-slate-600 mx-0.5" />
            {/*
             * ONE Load and ONE Save, at every width.
             *
             * There used to be two of each: these, in a toolbar with no `lg:hidden` on it, and
             * a second labelled pair in the notes panel below marked "Mobile-only Action
             * Buttons" — so on a phone BOTH rendered and the plan could be saved from two
             * different controls eight hundred pixels apart. That is the Sidebar's
             * desktop/mobile duplication one level down, and it had the same consequence: the
             * `title` explaining WHY save is disabled on an archived season had to be
             * maintained in two places, which is exactly the kind of thing that goes stale in
             * one of them.
             *
             * The label appears from `sm` up and the icon carries it below that; `touch-target`
             * gives both the 44px hit area a phone needs. `save-plan-desktop` and
             * `save-plan-mobile` are now one `save-plan` — a deliberate test-id change, and no
             * test asserted on either.
             */}
            <button
              data-testid="load-plan"
              onClick={() => setIsLoadModalOpen(true)}
              className="touch-target gap-1.5 px-2 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-forge-600 hover:bg-forge-50 dark:hover:bg-forge-900/30 rounded-lg transition-colors"
              title="Load Plans"
            >
              <FolderOpen size={16} />
              <span className="hidden sm:inline">Load</span>
            </button>
            {/* Primary forge orange, not the old one-off green — Save is the same action
                here as everywhere else in the app, and now wears the same button. */}
            <Button
              size="sm"
              data-testid="save-plan"
              onClick={() => setIsSaveModalOpen(true)}
              disabled={!canEdit}
              className="touch-target gap-1.5 px-2.5"
              /* The one explanation a disabled control gives. Do not strip it. */
              title={canEdit ? 'Save Plan' : editRefusalReason}
            >
              <Save size={16} />
              <span className="hidden sm:inline">Save</span>
            </Button>
          </div>
        </div>

        <div className="relative flex-1 bg-slate-900 overflow-hidden cursor-crosshair">
          {/* Background Field Image */}
          <img
            src={fieldImageSrc}
            className="absolute inset-0 w-full h-full object-contain opacity-50 pointer-events-none select-none"
            alt="Field"
          />

          <svg
            ref={svgRef}
            data-testid="planner-field"
            className="absolute inset-0 w-full h-full z-10 touch-none"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {/* Drawn Paths */}
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                stroke={p.stroke}
                strokeWidth={p.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {/* Current Path being drawn */}
            {currentPath && (
              <path
                d={currentPath}
                stroke={color}
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

          </svg>
        </div>
      </div>

      <div className="w-full lg:w-80 bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 flex flex-col">
        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Match Notes</h3>
        <div className="space-y-3 md:space-y-4 flex-1">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Alliance Partner</label>
            <input
              type="text"
              value={alliancePartner}
              onChange={(e) => setAlliancePartner(e.target.value)}
              placeholder="Team # / Name"
              className="field"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Our Strategy</label>
            <textarea
              value={strategyNotes}
              onChange={(e) => setStrategyNotes(e.target.value)}
              className="field h-32 resize-none"
              placeholder="1. Autonomous path...&#10;2. TeleOp focus..."
            ></textarea>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Partner Capabilities</label>
            <div className="grid grid-cols-2 gap-2">
              {/* The two labels come from the season's game (P-01 phase S). "Lifted Park" was
                  a DECODE literal sitting in this JSX; the columns behind these checkboxes are
                  generic (`partner_autonomous`, `partner_park`) and always were, so only the
                  words were game-specific. The keys are matched, not indexed, so a definition
                  listing them in the other order cannot swap the two checkboxes. */}
              <label className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-xs text-slate-800 dark:text-slate-200 cursor-pointer transition-colors hover:border-forge-300 dark:hover:border-forge-600">
                <input type="checkbox" className="accent-forge-600" checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} />{' '}
                {game.planner.partnerCapabilities.find((c) => c.key === 'partnerAutonomous')?.label ?? 'Autonomous'}
              </label>
              <label className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-xs text-slate-800 dark:text-slate-200 cursor-pointer transition-colors hover:border-forge-300 dark:hover:border-forge-600">
                <input type="checkbox" className="accent-forge-600" checked={parked} onChange={(e) => setParked(e.target.checked)} />{' '}
                {game.planner.partnerCapabilities.find((c) => c.key === 'partnerPark')?.label ?? 'End game'}
              </label>
            </div>
          </div>
        </div>

        {/* The duplicated "Mobile-only Action Buttons" pair that used to sit here is gone —
            see the toolbar above, which renders one Load and one Save at every width. */}
      </div>

      {/* Save Modal */}
      {isSaveModalOpen && (
        <Modal label="Save Match Plan" width="sm" onClose={() => setIsSaveModalOpen(false)}>
          {saveStatus === 'success' ? (
            <div className="flex flex-col items-center py-4">
              <CheckCircle className="w-16 h-16 text-green-500 mb-3" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Plan Saved!</h3>
            </div>
          ) : (
            <>
              <h3 className="text-lg font-bold mb-4 text-slate-900 dark:text-white">
                {loadedPlanId ? 'Update Match Plan' : 'Save Match Plan'}
              </h3>
              {loadedPlanId && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3" data-testid="save-target">
                  Saving over &ldquo;{planTitle}&rdquo;.
                </p>
              )}
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Plan name
              </label>
              <input
                autoFocus
                type="text"
                placeholder="Plan Name (e.g. Match 1)"
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                data-testid="plan-title-input"
                className="field mb-3"
              />
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Match number <span className="font-normal">(optional)</span>
              </label>
              {/*
                * The column has existed since Sprint 3 and nothing could set it — the write
                * path read `data.matchNumber` from a type that had no such property (B10),
                * and then the type got one and the form never did.
                */}
              <input
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="e.g. 3"
                value={matchNumber}
                onChange={(e) => setMatchNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                data-testid="plan-match-number-input"
                className="field mb-4"
              />
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                <Button variant="secondary" onClick={() => setIsSaveModalOpen(false)}>Cancel</Button>
                {loadedPlanId && (
                  <Button
                    variant="secondary"
                    onClick={handleSaveAsCopy}
                    busy={saveStatus === 'saving'}
                    data-testid="save-as-copy"
                  >
                    Save as copy
                  </Button>
                )}
                <Button onClick={handleSave} busy={saveStatus === 'saving'} data-testid="save-plan-confirm">
                  {loadedPlanId ? 'Update' : 'Save'}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Load Modal */}
      {isLoadModalOpen && (
        <Modal label="Saved Plans" width="panel" className="p-6 flex flex-col" onClose={() => setIsLoadModalOpen(false)}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Saved Plans</h3>
            <IconButton
              onClick={() => setIsLoadModalOpen(false)}
              className="touch-target p-1 -mr-1"
              aria-label="Close saved plans"
            >
              <X size={18} />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {matchPlans.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title="No saved plans"
                body="Draw a strategy and hit Save to keep it for match day."
              />
            ) : (
              matchPlans.map(plan => (
                /* The row loads the plan and CONTAINS the delete button, so it stays a div
                   with button semantics rather than nesting buttons. */
                <div
                  key={plan.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleLoad(plan)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleLoad(plan);
                    }
                  }}
                  className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <div className="flex-1">
                    <div className="font-bold text-slate-800 dark:text-white">{plan.title}</div>
                    <div className="text-xs text-slate-500">{new Date(plan.updatedAt).toLocaleDateString()} • {plan.allianceTeam || 'No Team'}</div>
                  </div>
                  <IconButton
                    danger
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(plan.id); }}
                    disabled={!canEdit}
                    title={canEdit ? 'Delete plan' : editRefusalReason}
                    data-testid="delete-matchplan-button"
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <ConfirmDialog
          title="Delete Match Plan?"
          message="This match plan will be permanently deleted. This action cannot be undone."
          cancelTestId="cancel-delete-matchplan"
          confirmTestId="confirm-delete-matchplan"
          onConfirm={() => { deleteMatchPlan(deleteConfirmId); setDeleteConfirmId(null); }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  );
};

export default MatchPlanner;