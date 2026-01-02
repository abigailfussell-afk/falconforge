import React, { useState } from 'react';
import { ScoutingReport } from '../types';
import { Plus, Trophy, Minus, Plus as PlusIcon } from 'lucide-react';

const ScoutingReports: React.FC = () => {
  const [scoutingData, setScoutingData] = useState<ScoutingReport[]>([]);
  const [isScoutModalOpen, setIsScoutModalOpen] = useState(false);
  
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

  const saveScoutingReport = () => {
    if(!newScout.teamNumber) return;
    const report: ScoutingReport = {
        id: Date.now().toString(),
        teamNumber: newScout.teamNumber || '',
        matchNumber: newScout.matchNumber || 0,
        hasAutonomous: newScout.hasAutonomous || false,
        autoScore: newScout.autoScore || 0,
        intakeType: newScout.intakeType || 'No Intake',
        autoAim: newScout.autoAim || false,
        farShooting: newScout.farShooting || false,
        shotsTaken: newScout.shotsTaken || 0,
        shotsMissed: newScout.shotsMissed || 0,
        parking: newScout.parking || 'No Park',
        endGameNotes: newScout.endGameNotes || '',
        rating: newScout.rating || 3
    };
    setScoutingData([report, ...scoutingData]);
    setIsScoutModalOpen(false);
    resetForm();
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
        endGameNotes: ''
    });
  }

  const adjustCount = (field: 'shotsTaken' | 'shotsMissed', amount: number) => {
      setNewScout(prev => ({
          ...prev,
          [field]: Math.max(0, (prev[field] || 0) + amount)
      }));
  }

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full p-4 md:p-6">
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">Team Scouting Reports</h2>
                <button 
                    onClick={() => setIsScoutModalOpen(true)}
                    className="bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-orange-700 transition shadow-sm"
                >
                    <Plus size={20} /> Scout Match
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {scoutingData.map(report => (
                    <div key={report.id} className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <div className="text-2xl font-black text-slate-800 dark:text-white">#{report.teamNumber}</div>
                            </div>
                            <div className="bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded text-xs font-bold text-slate-600 dark:text-slate-300">
                                Match {report.matchNumber}
                            </div>
                        </div>
                        
                        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300 mb-4">
                            <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-1">
                                <span>Autonomous</span>
                                <span className={report.hasAutonomous ? "text-green-600 dark:text-green-400 font-bold" : "text-slate-400"}>
                                    {report.hasAutonomous ? `${report.autoScore} pts` : 'No'}
                                </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-1">
                                <span>Intake</span>
                                <span className="font-medium">{report.intakeType}</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-1">
                                <span>Shooting</span>
                                <div className="text-right">
                                    <div>{report.shotsTaken} / {report.shotsTaken + report.shotsMissed} Hits</div>
                                    <div className="text-xs text-slate-400">
                                        {report.farShooting && 'Far '}{report.autoAim && 'Auto-Aim'}
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-1">
                                <span>Parking</span>
                                <span className="font-medium text-orange-600 dark:text-orange-400">{report.parking}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-1 text-yellow-500 mb-2">
                            {[...Array(5)].map((_, i) => (
                                <Trophy key={i} size={14} fill={i < report.rating ? "currentColor" : "none"} className={i < report.rating ? "" : "text-slate-300 dark:text-slate-600"} />
                            ))}
                        </div>
                        {report.endGameNotes && (
                            <p className="text-xs bg-slate-50 dark:bg-slate-700 p-2 rounded text-slate-500 dark:text-slate-300 italic">
                                "{report.endGameNotes}"
                            </p>
                        )}
                    </div>
                ))}
                {scoutingData.length === 0 && (
                    <div className="col-span-full text-center py-12 text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                        No scouting data yet. Click "Scout Match" to begin.
                    </div>
                )}
            </div>
        </div>

      {isScoutModalOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] shadow-2xl">
                  <div className="p-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 font-bold text-lg text-slate-900 dark:text-white">New Scouting Report</div>
                  <div className="p-6 space-y-4 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Team #</label>
                              <input 
                                type="text" 
                                className="w-full border dark:border-slate-600 rounded p-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-white" 
                                value={newScout.teamNumber || ''}
                                onChange={e => setNewScout({...newScout, teamNumber: e.target.value})}
                              />
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Match #</label>
                              <input 
                                type="number" 
                                className="w-full border dark:border-slate-600 rounded p-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-white" 
                                value={newScout.matchNumber || ''}
                                onChange={e => setNewScout({...newScout, matchNumber: parseInt(e.target.value)})}
                              />
                          </div>
                      </div>
                      
                      {/* Autonomous Section */}
                      <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg space-y-3">
                        <h4 className="font-bold text-slate-700 dark:text-white text-sm">Autonomous</h4>
                        <label className="flex items-center gap-3 text-slate-800 dark:text-white">
                            <input 
                                type="checkbox" 
                                className="w-5 h-5 rounded text-orange-600"
                                checked={newScout.hasAutonomous}
                                onChange={e => setNewScout({...newScout, hasAutonomous: e.target.checked})}
                            />
                            <span className="font-medium">Has Autonomous</span>
                        </label>
                        {newScout.hasAutonomous && (
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Auto Score</label>
                                <input 
                                    type="number" 
                                    className="w-full border dark:border-slate-600 rounded p-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                                    value={newScout.autoScore}
                                    onChange={e => setNewScout({...newScout, autoScore: parseInt(e.target.value)})}
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
                                className="w-full border dark:border-slate-600 rounded p-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                                value={newScout.intakeType}
                                onChange={(e) => setNewScout({...newScout, intakeType: e.target.value as any})}
                            >
                                <option>No Intake</option>
                                <option>Human Player</option>
                                <option>Automatic</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                             <label className="flex items-center gap-2 text-slate-800 dark:text-white text-sm">
                                <input type="checkbox" checked={newScout.autoAim} onChange={e => setNewScout({...newScout, autoAim: e.target.checked})} />
                                Auto Aim
                             </label>
                             <label className="flex items-center gap-2 text-slate-800 dark:text-white text-sm">
                                <input type="checkbox" checked={newScout.farShooting} onChange={e => setNewScout({...newScout, farShooting: e.target.checked})} />
                                Far Shooting
                             </label>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Shots Taken</label>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => adjustCount('shotsTaken', -1)} className="p-2 bg-slate-200 dark:bg-slate-600 rounded"><Minus size={14}/></button>
                                    <span className="flex-1 text-center font-mono font-bold text-lg dark:text-white">{newScout.shotsTaken}</span>
                                    <button onClick={() => adjustCount('shotsTaken', 1)} className="p-2 bg-slate-200 dark:bg-slate-600 rounded"><PlusIcon size={14}/></button>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Shots Missed</label>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => adjustCount('shotsMissed', -1)} className="p-2 bg-slate-200 dark:bg-slate-600 rounded"><Minus size={14}/></button>
                                    <span className="flex-1 text-center font-mono font-bold text-lg dark:text-white">{newScout.shotsMissed}</span>
                                    <button onClick={() => adjustCount('shotsMissed', 1)} className="p-2 bg-slate-200 dark:bg-slate-600 rounded"><PlusIcon size={14}/></button>
                                </div>
                            </div>
                        </div>
                      </div>

                      {/* End Game */}
                      <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg space-y-3">
                         <h4 className="font-bold text-slate-700 dark:text-white text-sm">End Game</h4>
                         <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Parking</label>
                            <select 
                                className="w-full border dark:border-slate-600 rounded p-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                                value={newScout.parking}
                                onChange={(e) => setNewScout({...newScout, parking: e.target.value as any})}
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
                            className="w-full accent-orange-600"
                            value={newScout.rating || 3}
                            onChange={e => setNewScout({...newScout, rating: parseInt(e.target.value)})}
                          />
                          <div className="flex justify-between text-xs text-slate-400">
                              <span>Novice</span>
                              <span>Expert</span>
                          </div>
                      </div>

                      <div>
                          <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Notes</label>
                          <textarea 
                             className="w-full border dark:border-slate-600 rounded p-2 h-20 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                             value={newScout.endGameNotes || ''}
                             onChange={e => setNewScout({...newScout, endGameNotes: e.target.value})}
                          ></textarea>
                      </div>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
                      <button onClick={() => setIsScoutModalOpen(false)} className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded">Cancel</button>
                      <button onClick={saveScoutingReport} className="px-6 py-2 bg-orange-600 text-white rounded font-medium hover:bg-orange-700">Save Report</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default ScoutingReports;
