import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { FIELD_IMAGE_URL } from '../constants';
import { Pen, Save, Trash2, Undo, Redo, FolderOpen, X, CheckCircle } from 'lucide-react';
import { useAppStore, MatchPlan } from '../lib/store';
import { useSeasonScope, useSeasonScoped } from '../lib/season-scope';
import { useMatchPlansQuery } from '../lib/queries';

// Fixed viewBox dimensions for consistent coordinate storage
const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 600;

const MatchPlanner: React.FC = () => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [color, setColor] = useState('#ef4444'); // Red default
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(true);
  // Simple history stack for undo/redo
  const { matchPlans: allMatchPlans, addMatchPlan, deleteMatchPlan, getCurrentSeason, currentTeamId } = useAppStore();
  const { canEdit } = useSeasonScope();

  // Background refresh — fetches latest match plans when this page is visited
  useMatchPlansQuery(currentTeamId);

  const currentSeason = getCurrentSeason();
  // Field image: can be Base64 data URL, full URL, or local file path
  const customFieldImage = currentSeason?.fieldImageData;
  const fieldImageSrc = customFieldImage
    ? (customFieldImage.startsWith('data:') || customFieldImage.startsWith('http')
      ? customFieldImage
      : `${import.meta.env.BASE_URL}${customFieldImage}`)
    : `${import.meta.env.BASE_URL}${FIELD_IMAGE_URL}`;
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleSave = () => {
    setSaveStatus('saving');
    addMatchPlan({
      title: planTitle || `Match Plan ${new Date().toLocaleString()}`,
      drawingData: paths,
      notes: strategyNotes,
      allianceTeam: alliancePartner,
      partnerAutonomous: autonomous,
      partnerPark: parked
    });
    setSaveStatus('success');
    // Show success message briefly, then close modal
    setTimeout(() => {
      setIsSaveModalOpen(false);
      setPlanTitle('');
      setSaveStatus('idle');
    }, 1500);
  };

  const handleLoad = (plan: MatchPlan) => {
    setPaths(plan.drawingData);
    setAlliancePartner(plan.allianceTeam);
    setStrategyNotes(plan.notes);
    setAutonomous(plan.partnerAutonomous);
    setParked(plan.partnerPark);
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
      <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden relative min-h-[500px] lg:min-h-0">
        <div className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-700 p-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-600 shadow-sm">
          <div className="flex items-center gap-1 md:gap-2">
            <button
              onClick={() => setIsDrawingEnabled(!isDrawingEnabled)}
              className={`p-2 rounded flex items-center justify-center ${isDrawingEnabled ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
              title={isDrawingEnabled ? 'Drawing ON (click to toggle)' : 'Drawing OFF (click to toggle)'}
            >
              <Pen size={18} />
            </button>
            <div className="h-6 w-px bg-slate-300 dark:bg-slate-600"></div>
            <button onClick={() => setColor('#ef4444')} className={`w-3 h-3 md:w-5 md:h-5 rounded-full bg-red-500 border-2 ${color === '#ef4444' ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
            <button onClick={() => setColor('#3b82f6')} className={`w-3 h-3 md:w-5 md:h-5 rounded-full bg-blue-500 border-2 ${color === '#3b82f6' ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
            <button onClick={() => setColor('#22c55e')} className={`w-3 h-3 md:w-5 md:h-5 rounded-full bg-green-500 border-2 ${color === '#22c55e' ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
            <button onClick={() => setColor('#facc15')} className={`w-3 h-3 md:w-5 md:h-5 rounded-full bg-yellow-400 border-2 ${color === '#facc15' ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleUndo}
              disabled={paths.length === 0}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-600 rounded disabled:opacity-30"
              title="Undo"
            >
              <Undo size={18} />
            </button>
            <button
              onClick={handleRedo}
              disabled={undoHistory.length === 0}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-600 rounded disabled:opacity-30"
              title="Redo"
            >
              <Redo size={18} />
            </button>
            <button
              onClick={() => { setPaths([]); setUndoHistory([]); }}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
              title="Clear"
            >
              <Trash2 size={18} />
            </button>
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
            <button
              data-testid="save-plan"
              onClick={() => setIsSaveModalOpen(true)}
              disabled={!canEdit}
              className="touch-target gap-1.5 px-2.5 py-1.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-card transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-600"
              /* The one explanation a disabled control gives. Do not strip it. */
              title={canEdit ? 'Save Plan' : 'This season is archived and read-only'}
            >
              <Save size={16} />
              <span className="hidden sm:inline">Save</span>
            </button>
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

      <div className="w-full lg:w-80 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-3 md:p-4 flex flex-col">
        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Match Notes</h3>
        <div className="space-y-3 md:space-y-4 flex-1">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Alliance Partner</label>
            <input
              type="text"
              value={alliancePartner}
              onChange={(e) => setAlliancePartner(e.target.value)}
              placeholder="Team # / Name"
              className="w-full p-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Our Strategy</label>
            <textarea
              value={strategyNotes}
              onChange={(e) => setStrategyNotes(e.target.value)}
              className="w-full h-32 p-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm resize-none text-slate-900 dark:text-white"
              placeholder="1. Autonomous path...&#10;2. TeleOp focus..."
            ></textarea>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Partner Capabilities</label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-700 text-xs text-slate-800 dark:text-slate-200">
                <input type="checkbox" checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} /> Autonomous
              </label>
              <label className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-700 text-xs text-slate-800 dark:text-slate-200">
                <input type="checkbox" checked={parked} onChange={(e) => setParked(e.target.checked)} /> Lifted Park
              </label>
            </div>
          </div>
        </div>

        {/* The duplicated "Mobile-only Action Buttons" pair that used to sit here is gone —
            see the toolbar above, which renders one Load and one Save at every width. */}
      </div>

      {/* Save Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-sm">
            {saveStatus === 'success' ? (
              <div className="flex flex-col items-center py-4">
                <CheckCircle className="w-16 h-16 text-green-500 mb-3" />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Plan Saved!</h3>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold mb-4 text-slate-900 dark:text-white">Save Match Plan</h3>
                <input
                  autoFocus
                  type="text"
                  placeholder="Plan Name (e.g. Match 1)"
                  value={planTitle}
                  onChange={(e) => setPlanTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded mb-4 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setIsSaveModalOpen(false)} className="px-4 py-2 text-slate-600 dark:text-slate-300">Cancel</button>
                  <button onClick={handleSave} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">Save</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Load Modal */}
      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Saved Plans</h3>
              <button
                onClick={() => setIsLoadModalOpen(false)}
                className="touch-target p-1 -mr-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                aria-label="Close saved plans"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {matchPlans.length === 0 ? (
                <div className="text-center text-slate-500 py-8">No saved plans found.</div>
              ) : (
                matchPlans.map(plan => (
                  <div key={plan.id} className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <div className="cursor-pointer flex-1" onClick={() => handleLoad(plan)}>
                      <div className="font-bold text-slate-800 dark:text-white">{plan.title}</div>
                      <div className="text-xs text-slate-500">{new Date(plan.updatedAt).toLocaleDateString()} • {plan.allianceTeam || 'No Team'}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(plan.id); }}
                      disabled={!canEdit}
                      title={canEdit ? 'Delete plan' : 'This season is archived and read-only'}
                      className="p-2 text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      data-testid="delete-matchplan-button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Delete Match Plan?</h3>
            <p className="text-slate-600 dark:text-slate-300 mb-6">
              This match plan will be permanently deleted. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                data-testid="cancel-delete-matchplan"
              >
                Cancel
              </button>
              <button
                onClick={() => { deleteMatchPlan(deleteConfirmId); setDeleteConfirmId(null); }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
                data-testid="confirm-delete-matchplan"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchPlanner;