const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'src', 'pages', 'Landing.tsx');
let content = fs.readFileSync(targetFile, 'utf8');

// 1. Add Trophy import
content = content.replace(
    /import \{\s*ArrowRight, ChevronRight, Check, Crown, User, Brain,\s*KanbanSquare, ClipboardCheck, BarChart3, Map, Zap\s*\} from 'lucide-react';/,
    `import { \n    ArrowRight, ChevronRight, Check, Crown, User, Brain, \n    KanbanSquare, ClipboardCheck, BarChart3, Map, Zap, Trophy\n} from 'lucide-react';`
);

// 2. Re-order features mapped cards
const oldCards = `{[
                            {
                                icon: <KanbanSquare className="w-6 h-6 text-orange-400" />,
                                title: "Sprint Planning",
                                desc: "Kanban boards and sprint planning adapted specifically for robotics build seasons."
                            },
                            {
                                icon: <ClipboardCheck className="w-6 h-6 text-blue-400" />,
                                title: "Pre-Match Checklist",
                                desc: "Ensure your robot is ready for every match with customizable, verifiable tasks."
                            },
                            {
                                icon: <BarChart3 className="w-6 h-6 text-emerald-400" />,
                                title: "Scouting Reports",
                                desc: "Detailed match analysis and offline-first data sync for competition scenarios."
                            },
                            {
                                icon: <Map className="w-6 h-6 text-amber-400" />,
                                title: "Match Planner",
                                desc: "Visualize strategies, assign tasks to alliance partners, and win more matches."
                            }
                        ].map((feature, i) => (`;

const newCards = `{[
                            {
                                icon: <KanbanSquare className="w-6 h-6 text-orange-400" />,
                                title: "Sprint Planning",
                                desc: "Kanban boards and sprint planning adapted specifically for robotics build seasons."
                            },
                            {
                                icon: <Map className="w-6 h-6 text-amber-400" />,
                                title: "Match Planner",
                                desc: "Visualize strategies, assign tasks to alliance partners, and win more matches."
                            },
                            {
                                icon: <BarChart3 className="w-6 h-6 text-emerald-400" />,
                                title: "Scouting Reports",
                                desc: "Detailed match analysis and offline-first data sync for competition scenarios."
                            },
                            {
                                icon: <ClipboardCheck className="w-6 h-6 text-blue-400" />,
                                title: "Pre-Match Checklist",
                                desc: "Ensure your robot is ready for every match with customizable, verifiable tasks."
                            }
                        ].map((feature, i) => (`;

if (content.includes(oldCards)) {
    content = content.replace(oldCards, newCards);
}

// 3. Extract the sections based on their exact comment identifiers and block structure.
const getSection = (comment) => {
    const startIdx = content.indexOf(`{/* \${comment} Section */}`);
    if (startIdx === -1) throw new Error("Could not find " + comment + " section start");
    const nextStartIdx = content.indexOf(`{/* `, startIdx + 10);
    if (nextStartIdx === -1) throw new Error("Could not find end of " + comment);
    return content.substring(startIdx, nextStartIdx);
};

const curSprint = getSection('Sprint Planning');
let curScouting = getSection('Scouting Reports');
let curMatchPlanner = getSection('Match Planner');
let curPreMatch = getSection('Pre-Match Checklist');

// 4. Update Scouting Graphic
const oldScoutingUiRight = `{/* Animated Charts Right */}
                        <div className="order-2 relative w-full aspect-square md:aspect-video lg:aspect-square bg-slate-800/50 rounded-3xl border border-slate-700 p-8 shadow-2xl flex flex-col justify-center overflow-hidden glass">
                            {/* Fake UI Header */}
                            <div className="absolute top-0 left-0 w-full h-12 border-b border-slate-700 bg-slate-800/80 flex items-center px-4 gap-2 text-slate-400 font-medium text-sm">
                                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                                <span className="ml-4">Team 118 Analysis</span>
                            </div>
                            
                            <div className="w-full flex flex-col gap-6 mt-6">
                                {/* Bar Chart */}
                                <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-lg h-48 flex items-end justify-between gap-2 px-8">
                                    {[30, 70, 45, 90, 60, 85, 40].map((h, i) => (
                                        <div key={i} className="w-full bg-slate-800 rounded-t-md relative group">
                                            <div 
                                                className="absolute bottom-0 w-full bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-md transition-all duration-1000 animate-bar-grow"
                                                style={{ '--target-height': \`\${h}%\`, animationDelay: \`\${i * 0.1}s\` } as React.CSSProperties}
                                            ></div>
                                        </div>
                                    ))}
                                </div>
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-lg flex items-center justify-center h-32 relative overflow-hidden">
                                        {/* Circular Progress Indicator */}
                                        <svg viewBox="0 0 36 36" className="w-20 h-20 animate-spin-slow">
                                            <path
                                                className="text-slate-800"
                                                strokeWidth="3"
                                                stroke="currentColor"
                                                fill="none"
                                                d="M18 2.0845
                                                  a 15.9155 15.9155 0 0 1 0 31.831
                                                  a 15.9155 15.9155 0 0 1 0 -31.831"
                                            />
                                            <path
                                                className="text-emerald-500 animate-circle-draw"
                                                strokeWidth="3"
                                                strokeDasharray="100, 100"
                                                strokeLinecap="round"
                                                stroke="currentColor"
                                                fill="none"
                                                d="M18 2.0845
                                                  a 15.9155 15.9155 0 0 1 0 31.831
                                                  a 15.9155 15.9155 0 0 1 0 -31.831"
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center font-bold text-xl text-white">87%</div>
                                    </div>
                                    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-lg flex flex-col justify-center h-32 space-y-3">
                                        <div className="h-3 w-1/2 bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500 w-3/4 animate-sub-bar"></div>
                                        </div>
                                        <div className="h-3 w-3/4 bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-amber-500 w-5/6 animate-sub-bar" style={{ animationDelay: '0.2s' }}></div>
                                        </div>
                                        <div className="h-3 w-2/3 bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-orange-500 w-1/2 animate-sub-bar" style={{ animationDelay: '0.4s' }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;

const newScoutingUiRight = `{/* Animated Scouting UI Right */}
                        <div className="order-2 relative w-full aspect-square md:aspect-video lg:aspect-square bg-slate-800/50 rounded-3xl border border-slate-700 p-6 shadow-2xl flex flex-col justify-center overflow-hidden glass">
                            {/* Fake UI Header */}
                            <div className="absolute top-0 left-0 w-full h-12 border-b border-slate-700 bg-slate-800/80 flex items-center px-4 gap-2 text-slate-400 font-medium text-sm z-20">
                                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                                <span className="ml-4 flex items-center gap-2"><Trophy size={14} className="text-amber-500"/> Scouting Dashboard</span>
                            </div>
                            
                            <div className="w-full flex-1 mt-10 relative">
                                {/* Report Card 2 (Floating behind) */}
                                <div className="absolute top-20 left-6 right-6 bg-slate-900 border border-slate-700 p-5 rounded-xl shadow-xl transform scale-95 opacity-50 z-0">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <div className="text-xl font-black text-white">#254</div>
                                        </div>
                                        <div className="bg-slate-800 px-2 py-1 rounded text-xs font-bold text-slate-400">Match 41</div>
                                    </div>
                                    <div className="space-y-2 text-sm text-slate-400 mb-4">
                                        <div className="flex justify-between border-b border-slate-800 pb-1">
                                            <span>Autonomous</span><span className="text-emerald-500 font-bold">20 pts</span>
                                        </div>
                                        <div className="flex justify-between border-b border-slate-800 pb-1">
                                            <span>Shooting</span><span>12 / 12 Shots</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Report Card 1 */}
                                <div className="absolute top-4 left-2 right-2 bg-slate-900 border border-slate-600 p-5 rounded-xl shadow-2xl z-10 animate-[kanbanCardFlow_6s_ease-in-out_infinite]" style={{ animationName: 'none', transform: 'translateY(0)' }}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <div className="text-2xl font-black text-white">#118</div>
                                            <div className="text-xs text-slate-400 mt-0.5">District Championship</div>
                                        </div>
                                        <div className="bg-slate-800 px-2 py-1 rounded text-xs font-bold text-slate-300">
                                            Match 42
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-3 text-sm text-slate-300 mb-4">
                                        <div className="flex justify-between border-b border-slate-800 pb-1">
                                            <span>Autonomous</span>
                                            <span className="text-emerald-400 font-bold">15 pts</span>
                                        </div>
                                        <div className="flex justify-between border-b border-slate-800 pb-1">
                                            <span>Intake</span>
                                            <span className="font-medium text-slate-300">Automatic</span>
                                        </div>
                                        <div className="flex justify-between border-b border-slate-800 pb-1">
                                            <span>Shooting</span>
                                            <div className="text-right">
                                                <div>9 / 10 Shots</div>
                                                <div className="text-xs text-slate-400">Far Auto-Aim</div>
                                            </div>
                                        </div>
                                        <div className="flex justify-between border-b border-slate-800 pb-1">
                                            <span>Parking</span>
                                            <span className="font-medium text-emerald-400">Full Park</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1 text-yellow-500">
                                        <Trophy size={14} fill="currentColor" />
                                        <Trophy size={14} fill="currentColor" />
                                        <Trophy size={14} fill="currentColor" />
                                        <Trophy size={14} fill="currentColor" />
                                        <Trophy size={14} fill="none" className="text-slate-600" />
                                    </div>
                                </div>
                            </div>
                        </div>`;

if (curScouting.includes(oldScoutingUiRight)) {
    curScouting = curScouting.replace(oldScoutingUiRight, newScoutingUiRight);
}

// 5. Update Pre-Match Checklist Content
curPreMatch = curPreMatch.replace(
    'Never forget a battery again',
    'Arrive at each match with confidence'
);

// We need to exactly match this array block inside Pre-Match section
const oldChecklistItems = `{[
                                    { label: "Install fresh battery", delay: "0s" },
                                    { label: "Turn on main breaker", delay: "1.2s" },
                                    { label: "Verify DS connection", delay: "2.4s" },
                                    { label: "Set starting configuration", delay: "3.6s" }
                                ]`;
const newChecklistItems = `{[
                                    { label: "Install fresh battery", delay: "0s" },
                                    { label: "Charge driver hub", delay: "1.2s" },
                                    { label: "Check all connections and screws", delay: "2.4s" },
                                    { label: "Turn on robot", delay: "3.6s" }
                                ]`;
if (curPreMatch.includes(oldChecklistItems)) {
    curPreMatch = curPreMatch.replace(oldChecklistItems, newChecklistItems);
} else {
    console.log("Warning: Could not find oldChecklistItems exact match!");
}

// 6. Stitch it together
let beforeSections = content.substring(0, content.indexOf('{/* Sprint Planning Section */}'));
let afterSections = content.substring(content.indexOf('{/* Roles / Pricing Section */}'));

const newContent = beforeSections + curSprint + curMatchPlanner + curScouting + curPreMatch + afterSections;

fs.writeFileSync(targetFile, newContent);
console.log("Successfully run");
