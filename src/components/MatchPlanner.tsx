import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { FIELD_IMAGE_URL } from '../constants';
import { Pen, Save, Trash2, Undo, Redo, FolderOpen, X, CheckCircle } from 'lucide-react';
import { useAppStore, MatchPlan } from '../lib/store';
import { useSeasonScope, useSeasonScoped } from '../lib/season-scope';
import { useMatchPlansQuery } from '../lib/queries';
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
              title={canEdit ? 'Save Plan' : 'This season is archived and read-only'}
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
              <label className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-xs text-slate-800 dark:text-slate-200 cursor-pointer transition-colors hover:border-forge-300 dark:hover:border-forge-600">
                <input type="checkbox" className="accent-forge-600" checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} /> Autonomous
              </label>
              <label className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-xs text-slate-800 dark:text-slate-200 cursor-pointer transition-colors hover:border-forge-300 dark:hover:border-forge-600">
                <input type="checkbox" className="accent-forge-600" checked={parked} onChange={(e) => setParked(e.target.checked)} /> Lifted Park
              </label>
            </div>
          </div>
        </div>

        {/* The duplicated "Mobile-only Action Buttons" pair that used to sit here is gone —
            see the toolbar above, which renders one Load and one Save at every width. */}
      </div>

      {/* Save Modal */}
      {isSaveModalOpen && (
        <Modal label="Save Match Plan" width="sm">
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
                className="field mb-4"
              />
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setIsSaveModalOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} busy={saveStatus === 'saving'}>Save</Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Load Modal */}
      {isLoadModalOpen && (
        <Modal label="Saved Plans" width="panel" className="p-6 flex flex-col">
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
                    title={canEdit ? 'Delete plan' : 'This season is archived and read-only'}
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