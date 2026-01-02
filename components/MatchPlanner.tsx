import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { FIELD_IMAGE_URL } from '../constants';
import { Pen, Save, Trash2, Undo, FolderOpen, X } from 'lucide-react';
import { useAppStore, MatchPlan } from '../src/lib/store';

const MatchPlanner: React.FC = () => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [color, setColor] = useState('#ef4444'); // Red default
  const [mode, setMode] = useState<'draw' | 'drag'>('draw');
  // Simple history stack for undo
  const { matchPlans, addMatchPlan, deleteMatchPlan } = useAppStore();
  const [paths, setPaths] = useState<{ d: string, stroke: string, width: number }[]>([]);
  const [currentPath, setCurrentPath] = useState('');

  // Persisted state
  const [alliancePartner, setAlliancePartner] = useState('');
  const [strategyNotes, setStrategyNotes] = useState('');
  const [autonomous, setAutonomous] = useState(false);
  const [parked, setParked] = useState(false);

  // UI State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [planTitle, setPlanTitle] = useState('');

  const handleSave = () => {
    addMatchPlan({
      title: planTitle || `Match Plan ${new Date().toLocaleString()}`,
      drawingData: paths,
      notes: strategyNotes,
      allianceTeam: alliancePartner,
      partnerAutonomous: autonomous,
      partnerPark: parked
    });
    setIsSaveModalOpen(false);
    setPlanTitle('');
    alert('Plan saved!');
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
        if (mode === 'drag') {
          d3.select(this).attr("cx", event.x).attr("cy", event.y);
        }
      })
      .on("end", function (_event) {
        d3.select(this).attr("stroke", "white").attr("stroke-width", 2);
      });

    svg.selectAll(".draggable-robot").call(drag as any);

  }, [mode]);

  // Handle Drawing events cleanly
  const handlePointerDown = (e: React.PointerEvent) => {
    if (mode !== 'draw') return;
    const svg = svgRef.current;
    if (!svg) return;

    const point = svg.createSVGPoint();
    point.x = e.nativeEvent.offsetX;
    point.y = e.nativeEvent.offsetY;

    setCurrentPath(`M ${point.x} ${point.y}`);
    (svg as any).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (mode !== 'draw' || !currentPath) return;

    // Add point to path
    setCurrentPath(prev => `${prev} L ${e.nativeEvent.offsetX} ${e.nativeEvent.offsetY}`);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (mode !== 'draw' || !currentPath) return;

    // Commit path
    setPaths([...paths, { d: currentPath, stroke: color, width: 3 }]);
    setCurrentPath('');
    if (svgRef.current) (svgRef.current as any).releasePointerCapture(e.pointerId);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-full h-auto lg:overflow-hidden overflow-visible">
      <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden relative min-h-[500px] lg:min-h-0">
        <div className="bg-slate-100 dark:bg-slate-700 p-2 flex items-center justify-between border-b border-slate-200 dark:border-slate-600">
          <div className="flex gap-2">
            <button
              onClick={() => setMode('draw')}
              className={`p-2 rounded ${mode === 'draw' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
            >
              <Pen size={18} />
            </button>
            <div className="h-8 w-px bg-slate-300 dark:bg-slate-600 mx-1"></div>
            <button onClick={() => setColor('#ef4444')} className={`w-6 h-6 rounded-full bg-red-500 border-2 ${color === '#ef4444' ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
            <button onClick={() => setColor('#3b82f6')} className={`w-6 h-6 rounded-full bg-blue-500 border-2 ${color === '#3b82f6' ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
            <button onClick={() => setColor('#22c55e')} className={`w-6 h-6 rounded-full bg-green-500 border-2 ${color === '#22c55e' ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
            <button onClick={() => setColor('#facc15')} className={`w-6 h-6 rounded-full bg-yellow-400 border-2 ${color === '#facc15' ? 'border-slate-800 dark:border-white' : 'border-transparent'}`} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const newPaths = [...paths];
                newPaths.pop();
                setPaths(newPaths);
              }}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-600 rounded"
              title="Undo"
            >
              <Undo size={18} />
            </button>
            <button
              onClick={() => setPaths([])}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
              title="Clear"
            >
              <Trash2 size={18} />
            </button>
            <div className="h-8 w-px bg-slate-300 dark:bg-slate-600 mx-1"></div>
            <button
              onClick={() => setIsLoadModalOpen(true)}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded"
              title="Load Plans"
            >
              <FolderOpen size={18} />
            </button>
            <button
              onClick={() => setIsSaveModalOpen(true)}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"
              title="Save Plan"
            >
              <Save size={18} />
            </button>
          </div>
        </div>

        <div className="relative flex-1 bg-slate-900 overflow-hidden cursor-crosshair">
          {/* Background Field Image */}
          <img
            src={FIELD_IMAGE_URL}
            className="absolute inset-0 w-full h-full object-contain opacity-50 pointer-events-none select-none"
            alt="Field"
          />

          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full z-10 touch-none"
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

            {/* Draggable Robots (Mode toggle to enable dragging needed strictly speaking, but SVG events overlap. 
                    Simple implementation: Only draggable when clicking specifically on them) */}
            <circle className="draggable-robot cursor-move" cx="50" cy="50" r="15" fill="#ef4444" stroke="white" strokeWidth="2" />
            <circle className="draggable-robot cursor-move" cx="90" cy="50" r="15" fill="#3b82f6" stroke="white" strokeWidth="2" />
          </svg>
        </div>
      </div>

      <div className="w-full lg:w-80 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 flex flex-col">
        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Match Notes</h3>
        <div className="space-y-4 flex-1">
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
      </div>

      {/* Save Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-sm">
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
          </div>
        </div>
      )}

      {/* Load Modal */}
      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Saved Plans</h3>
              <button onClick={() => setIsLoadModalOpen(false)}><X /></button>
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
                      onClick={() => {
                        deleteMatchPlan(plan.id);
                      }}
                      className="p-2 text-red-400 hover:text-red-600"
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
    </div>
  );
};

export default MatchPlanner;