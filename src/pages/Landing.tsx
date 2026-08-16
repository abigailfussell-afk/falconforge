import { useNavigate } from 'react-router-dom';
import { 
    ArrowRight, ChevronRight, Check, Crown, User, Brain, 
    KanbanSquare, ClipboardCheck, BarChart3, Map, Zap, Trophy
} from 'lucide-react';

export default function LandingPage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-forge-500/30 overflow-x-hidden">
            <style>{`
                /* Kanban Animations */
                @keyframes kanbanCardFlow {
                    0%, 15% { transform: translate(0, 0); opacity: 1; }
                    30%, 45% { transform: translate(calc(100% + 1rem), 20px); opacity: 1; }
                    60%, 80% { transform: translate(calc(200% + 2rem), -10px); opacity: 1; }
                    95%, 100% { transform: translate(calc(200% + 2rem), -10px); opacity: 0; }
                }
                @media (max-width: 639px) {
                    @keyframes kanbanCardFlow {
                        0%, 15% { transform: translate(0, 0); opacity: 1; }
                        30%, 45% { transform: translate(10px, calc(100% + 1rem)); opacity: 1; }
                        60%, 80% { transform: translate(-5px, calc(200% + 2rem)); opacity: 1; }
                        95%, 100% { transform: translate(-5px, calc(200% + 2rem)); opacity: 0; }
                    }
                }
                .animate-kanban-card {
                    animation: kanbanCardFlow 8s ease-in-out infinite;
                }
                
                /* Checklist Animations */
                @keyframes checkmarkAppear {
                    0%, 30% { opacity: 0; transform: scale(0.5); }
                    40%, 90% { opacity: 1; transform: scale(1); }
                    100% { opacity: 0; transform: scale(0.5); }
                }
                .animate-checkmark {
                    animation: checkmarkAppear 6s infinite;
                }
                @keyframes strikethrough {
                    0%, 30% { color: #cbd5e1; text-decoration: none; opacity: 1; }
                    40%, 90% { color: #64748b; text-decoration: line-through; opacity: 0.5; }
                    100% { color: #cbd5e1; text-decoration: none; opacity: 1; }
                }
                .animate-strikethrough {
                    animation: strikethrough 6s infinite;
                }
                @keyframes progressFill {
                    0% { width: 0%; }
                    35% { width: 25%; }
                    55% { width: 50%; }
                    75% { width: 75%; }
                    90%, 100% { width: 100%; }
                }
                .animate-progress-bar {
                    animation: progressFill 6s ease-in-out infinite;
                }

                /* Scouting Charts Animations */
                @keyframes barGrow {
                    0%, 10% { height: 10%; }
                    50%, 90% { height: var(--target-height, 100%); }
                    100% { height: 10%; }
                }
                .animate-bar-grow {
                    animation: barGrow 4s ease-in-out infinite alternate;
                }
                @keyframes circleDraw {
                    0%, 10% { stroke-dasharray: 0, 100; }
                    50%, 90% { stroke-dasharray: 87, 100; }
                    100% { stroke-dasharray: 0, 100; }
                }
                .animate-circle-draw {
                    animation: circleDraw 4s ease-in-out infinite alternate;
                }
                @keyframes subBarFill {
                    0%, 10% { transform: scaleX(0); transform-origin: left; }
                    50%, 90% { transform: scaleX(1); transform-origin: left; }
                    100% { transform: scaleX(0); transform-origin: left; }
                }
                .animate-sub-bar {
                    animation: subBarFill 4s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
                }
                .animate-spin-slow {
                    animation: spin 12s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                /* Scouting Report Flow Animations */
                @keyframes scoutingFormFade {
                    0%, 35% { opacity: 1; transform: scale(1); pointer-events: auto; }
                    40%, 100% { opacity: 0; transform: scale(0.95); pointer-events: none; }
                }
                .animate-scouting-form {
                    animation: scoutingFormFade 12s ease-in-out infinite;
                }

                @keyframes scoutingListFade {
                    0%, 40% { opacity: 0; transform: scale(0.95); pointer-events: none; }
                    45%, 95% { opacity: 1; transform: scale(1); pointer-events: auto; }
                    100% { opacity: 0; transform: scale(0.95); pointer-events: none; }
                }
                .animate-scouting-list {
                    animation: scoutingListFade 12s ease-in-out infinite;
                }

                @keyframes scoutingTypewriter {
                    0%, 5% { width: 0; opacity: 1; }
                    25%, 100% { width: 100%; opacity: 1; }
                }
                .animate-scouting-typewriter {
                    display: inline-block;
                    overflow: hidden;
                    white-space: nowrap;
                    animation: scoutingTypewriter 12s steps(40, end) infinite;
                }

                @keyframes scoutingButtonPress {
                    0%, 30% { transform: scale(1); background-color: rgb(234, 88, 12); } /* forge-600 */
                    32% { transform: scale(0.95); background-color: rgb(194, 65, 12); } /* forge-700 */
                    35%, 100% { transform: scale(1); background-color: rgb(234, 88, 12); }
                }
                .animate-scouting-btn {
                    animation: scoutingButtonPress 12s ease-in-out infinite;
                }

                @keyframes scoutingCardSlideIn {
                    0%, 40% { transform: translateY(-20px); opacity: 0; }
                    45%, 95% { transform: translateY(0); opacity: 1; }
                    100% { transform: translateY(-20px); opacity: 0; }
                }
                .animate-scouting-card-in {
                    animation: scoutingCardSlideIn 12s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
                }

                @keyframes scoutingCardShiftDown1 {
                    0%, 40% { transform: translateY(0) scale(1); opacity: 1; z-index: 10; }
                    45%, 95% { transform: translateY(80px) scale(0.95); opacity: 0.5; z-index: 0; }
                    100% { transform: translateY(0) scale(1); opacity: 0; }
                }
                .animate-scouting-card-shift-1 {
                    animation: scoutingCardShiftDown1 12s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
                    transform-origin: top center;
                }

                @keyframes scoutingCardShiftDown2 {
                    0%, 40% { transform: translateY(80px) scale(0.95); opacity: 0.5; }
                    45%, 100% { transform: translateY(160px) scale(0.9); opacity: 0; }
                }
                .animate-scouting-card-shift-2 {
                    animation: scoutingCardShiftDown2 12s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
                    transform-origin: top center;
                }
            `}</style>
            
            {/* Navigation Bar */}
            <nav className="fixed top-0 w-full z-50 glass border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-xl border border-slate-700/50 p-1 flex items-center justify-center">
                                <img
                                    src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                                    className="w-full h-full object-contain"
                                    alt="FalconForge Logo"
                                />
                            </div>
                            <span className="text-xl sm:text-2xl font-black italic tracking-tighter">
                                <span className="bg-gradient-to-r from-forge-500 to-amber-500 bg-clip-text text-transparent">FALCON</span>
                                <span className="text-slate-300">FORGE</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-4">
                            <button
                                onClick={() => navigate('/login')}
                                className="text-slate-300 hover:text-white font-medium transition-colors hidden sm:block"
                            >
                                Log In
                            </button>
                            <button
                                onClick={() => navigate('/login?mode=signup')}
                                className="bg-gradient-to-r from-forge-500 to-amber-600 hover:from-forge-600 hover:to-amber-700 text-white px-4 sm:px-5 py-2 rounded-xl text-sm sm:text-base font-medium shadow-lg shadow-forge-500/25 transition-all flex items-center gap-1 sm:gap-2"
                            >
                                Sign Up <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <main className="relative pt-32 pb-16 lg:pt-48 lg:pb-32 overflow-hidden">
                {/* Moving Background Screensaver */}
                <div
                    className="absolute inset-0 z-0 opacity-40 animate-pan-bg mix-blend-lighten"
                    style={{ backgroundImage: `url('${import.meta.env.BASE_URL}hero_bg.png')` }}
                ></div>

                {/* Background Effects Gradient Overlay */}
                <div className="absolute inset-0 z-0 bg-gradient-to-b from-slate-900/50 via-slate-900/70 to-slate-900/100 pointer-events-none"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-band h-band sm:w-orb-lg sm:h-orb-lg bg-forge-600/20 rounded-full blur-3xl pointer-events-none z-0"></div>

                <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-8 relative z-10 text-center">
                    <div className="inline-flex items-center gap-1 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 backdrop-blur-md text-2xs sm:text-sm text-amber-400 font-medium mb-6 sm:mb-8 shadow-xl text-center">
                        <Zap className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span>The ultimate agile engineering solution for your robotics team</span>
                    </div>

                    <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight mb-6 sm:mb-8 leading-none sm:leading-tight">
                        Don't just build your robot...<br />
                        <span className="bg-gradient-to-r from-forge-400 via-forge-500 to-amber-500 text-transparent bg-clip-text tracking-tighter italic">
                            FORGE IT
                        </span>
                    </h1>

                    <p className="mt-6 text-xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
                        The complete platform for competitive robotics teams to plan sprints, analyze scouting data, strategize with alliances, and learn real-world agile engineering processes.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            onClick={() => navigate('/login?mode=signup')}
                            className="w-full sm:w-auto px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-forge-500 to-amber-600 hover:from-forge-600 hover:to-amber-700 text-white rounded-2xl font-bold text-lg shadow-xl shadow-forge-500/25 transition-all flex items-center justify-center gap-2"
                        >
                            Start Forging Now <ChevronRight className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => navigate('/login')}
                            className="w-full sm:w-auto px-6 py-3 sm:px-8 sm:py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold text-lg border border-slate-700 transition-all"
                        >
                            Log In
                        </button>
                    </div>
                </div>
            </main>

            {/* Features Section */}
            <section className="py-16 lg:py-24 bg-slate-900/50 border-t border-slate-800 relative z-10">
                <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">Everything your team needs to go from kickoff to world championships.</h2>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Feature Cards */}
                        {[
                            {
                                icon: <KanbanSquare className="w-6 h-6 text-forge-400" />,
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
                        ].map((feature, i) => (
                            <div key={i} className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors">
                                <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center mb-4">
                                    {feature.icon}
                                </div>
                                <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                                <p className="text-slate-400 leading-relaxed">{feature.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Sprint Planning Section */}
            <section className="py-16 lg:py-24 bg-slate-900 overflow-hidden relative border-t border-slate-800">
                <div className="absolute top-0 right-0 w-band h-band sm:w-orb sm:h-orb bg-forge-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-8 relative z-10">
                    <div className="grid lg:grid-cols-2 gap-16 items-center flex-col-reverse lg:flex-row">
                        <div className="order-1">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-sm text-forge-400 font-medium mb-6">
                                <KanbanSquare className="w-4 h-4" /> Sprint Planning
                            </div>
                            <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-6">
                                Keep the build season on track
                            </h2>
                            <p className="text-xl text-slate-400 mb-8 leading-relaxed">
                                Organize your subteams, track tasks, and monitor progress with our integrated robotics-specific Kanban boards. Make sure you hit your deadlines before competition week.
                            </p>
                            <ul className="space-y-4 mb-8">
                                {[
                                    "Custom robotics workflow states",
                                    "Assign tasks to specific subteams",
                                    "Track progress across systems"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-6 h-6 rounded-full bg-forge-500/20 flex items-center justify-center text-forge-400">
                                            <Check className="w-4 h-4" />
                                        </div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Animated Kanban */}
                        <div className="order-2 relative w-full aspect-auto sm:aspect-square md:aspect-video lg:aspect-square bg-slate-800/50 rounded-3xl border border-slate-700 p-4 sm:p-8 shadow-2xl flex items-center justify-center overflow-hidden glass min-h-canvas sm:min-h-0">
                            {/* Fake UI Header */}
                            <div className="absolute top-0 left-0 w-full h-12 border-b border-slate-700 bg-slate-800/80 flex items-center px-4 gap-2">
                                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                            </div>

                            <div className="w-full flex flex-col sm:flex-row gap-4 h-full pt-12 sm:pt-8 relative">
                                {/* Columns */}
                                {["To Do", "In Progress", "Done"].map((col, idx) => (
                                    <div key={idx} className="flex-1 bg-slate-900/50 rounded-xl border border-slate-700 p-4 flex flex-col gap-3 relative min-h-40 sm:min-h-0">
                                        <div className="text-slate-400 font-semibold text-sm uppercase tracking-wider">{col}</div>
                                        {/* Static Cards */}
                                        {idx === 0 && <div className="w-full h-16 bg-slate-800 rounded-lg border border-slate-700/50 mt-16 sm:mt-28"></div>}
                                        {idx === 0 && <div className="w-full h-20 bg-slate-800 rounded-lg border border-slate-700/50 hidden sm:block"></div>}
                                        {idx === 1 && <div className="w-full h-20 bg-slate-800 rounded-lg border border-slate-700/50 hidden sm:block"></div>}
                                        {idx === 2 && <div className="w-full h-16 sm:h-24 bg-slate-800 rounded-lg border border-slate-700/50"></div>}
                                        {idx === 2 && <div className="w-full h-16 bg-slate-800 rounded-lg border border-slate-700/50 hidden sm:block"></div>}
                                    </div>
                                ))}

                                {/* Animated Ticket */}
                                {/* The one arbitrary value left in the app, and it earns it: this
                                    is not a size, it is the width of one of the three flex
                                    columns above minus their gap, so the animated card lands
                                    exactly on a column as it travels. A token would name a
                                    number that only means anything relative to that layout. */}
                                <div className="absolute left-4 right-4 sm:right-auto sm:left-4 top-24 sm:top-20 sm:w-[calc(33.33%-1.5rem)] h-24 bg-gradient-to-br from-forge-500 to-amber-600 rounded-lg border border-forge-400/50 p-3 shadow-raised flex flex-col justify-between animate-kanban-card z-10 pointer-events-none">
                                    <div className="w-1/2 h-2 bg-white/30 rounded-full"></div>
                                    <div className="w-full space-y-2">
                                        <div className="w-5/6 h-2 bg-white/20 rounded-full"></div>
                                        <div className="w-4/6 h-2 bg-white/20 rounded-full"></div>
                                    </div>
                                    <div className="flex justify-between items-center mt-2">
                                        <div className="w-6 h-6 rounded-full bg-white/20"></div>
                                        <div className="w-6 h-4 bg-white/20 rounded-sm"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Match Planner Section */}
            <section className="py-16 lg:py-24 bg-slate-900 overflow-hidden relative border-t border-slate-800">
                <div className="absolute top-0 left-0 w-band h-band sm:w-orb sm:h-orb bg-amber-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-8 relative z-10">
                    <div className="grid lg:grid-cols-2 gap-16 items-center flex-col-reverse lg:flex-row-reverse">
                        
                        <div className="order-1 lg:order-2">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-sm text-amber-400 font-medium mb-6">
                                <Map className="w-4 h-4" /> Match Planner
                            </div>
                            <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-6">
                                Visualize your next move
                            </h2>
                            <p className="text-xl text-slate-400 mb-8 leading-relaxed">
                                Our built-in Match Planner lets you draw, diagram, and formulate complex alliance strategies directly over the season's field map. Record crucial strategy notes, tag key starting positions, and build a unified game plan for your entire alliance.
                            </p>
                            <ul className="space-y-4 mb-8">
                                {[
                                    "Save unlimited custom plays",
                                    "Coordinate alliance synergy & routing",
                                    "Real-time whiteboard feeling"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400">
                                            <Check className="w-4 h-4" />
                                        </div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Animated Drawing Diagram */}
                        <div className="order-2 lg:order-1 relative w-full aspect-square md:aspect-video lg:aspect-square bg-slate-800/50 rounded-3xl border border-slate-700 p-4 sm:p-8 shadow-2xl flex items-center justify-center overflow-hidden glass">
                            {/* Fake UI Header */}
                            <div className="absolute top-0 left-0 w-full h-12 border-b border-slate-700 bg-slate-800/80 flex items-center px-4 gap-2 text-slate-400 font-medium text-xs sm:text-sm">
                                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                                <span className="ml-2 sm:ml-4 truncate">Alliance Pre-Match Huddle</span>
                            </div>

                            <svg viewBox="0 0 400 300" className="w-full h-full drop-shadow-forge mt-12">
// ...
                                {/* Definitions including Grid and Animated Masks */}
                                <defs>
                                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148, 163, 184, 0.1)" strokeWidth="1" />
                                    </pattern>

                                    <mask id="draw-mask-1">
                                        <path d="M 50 250 C 100 250, 150 150, 200 150 S 300 100, 350 50" fill="none" stroke="white" strokeWidth="10" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset="100">
                                            <animate attributeName="stroke-dashoffset" from="100" to="0" dur="4s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.42 0 0.58 1" />
                                        </path>
                                    </mask>

                                    <mask id="draw-mask-2">
                                        <path d="M 100 50 C 150 50, 150 200, 220 200 C 290 200, 250 100, 350 250" fill="none" stroke="white" strokeWidth="10" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset="100">
                                            <animate attributeName="stroke-dashoffset" from="100" to="0" dur="5s" begin="0.5s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.42 0 0.58 1" />
                                        </path>
                                    </mask>
                                </defs>
                                <rect width="100%" height="100%" fill="url(#grid)" />

                                {/* Start Points */}
                                <circle cx="50" cy="250" r="10" fill="#f97316" />
                                <text x="35" y="275" fill="#f97316" fontSize="12" fontWeight="bold">START</text>

                                <circle cx="100" cy="50" r="10" fill="#eab308" />
                                <text x="85" y="75" fill="#eab308" fontSize="12" fontWeight="bold">START</text>

                                {/* Animated paths masked by drawing masks */}
                                <path
                                    mask="url(#draw-mask-1)"
                                    d="M 50 250 C 100 250, 150 150, 200 150 S 300 100, 350 50"
                                    fill="none"
                                    stroke="#f97316"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                                <path
                                    mask="url(#draw-mask-2)"
                                    style={{ opacity: 0.7 }}
                                    d="M 100 50 C 150 50, 150 200, 220 200 C 290 200, 250 100, 350 250"
                                    fill="none"
                                    stroke="#eab308"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                />

                                {/* End Points */}
                                <path d="M 330 50 L 350 50 L 350 70" fill="none" stroke="#f97316" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M 330 250 L 350 250 L 350 230" fill="none" stroke="#eab308" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />

                                {/* Robot 1 Layout */}
                                <g className="drop-shadow-forge-dot">
                                    <g>
                                        <animateMotion
                                            dur="4s"
                                            repeatCount="indefinite"
                                            path="M 50 250 C 100 250, 150 150, 200 150 S 300 100, 350 50"
                                            rotate="auto"
                                            calcMode="spline"
                                            keyTimes="0;1"
                                            keySplines="0.42 0 0.58 1"
                                        />
                                        <rect width="36" height="24" rx="4" fill="#0f172a" stroke="#f97316" strokeWidth="2" x="-18" y="-12" />
                                        <rect width="8" height="14" rx="2" fill="#f97316" x="3" y="-7" />
                                        <rect width="10" height="3" fill="#94a3b8" x="-12" y="-14" />
                                        <rect width="10" height="3" fill="#94a3b8" x="-12" y="11" />
                                        <rect width="10" height="3" fill="#94a3b8" x="2" y="-14" />
                                        <rect width="10" height="3" fill="#94a3b8" x="2" y="11" />
                                    </g>
                                </g>

                                {/* Robot 2 Layout */}
                                <g className="drop-shadow-gold-dot" opacity="0.9">
                                    <g>
                                        <animateMotion
                                            dur="5s"
                                            begin="0.5s"
                                            repeatCount="indefinite"
                                            path="M 100 50 C 150 50, 150 200, 220 200 C 290 200, 250 100, 350 250"
                                            rotate="auto"
                                            calcMode="spline"
                                            keyTimes="0;1"
                                            keySplines="0.42 0 0.58 1"
                                        />
                                        <rect width="36" height="24" rx="4" fill="#0f172a" stroke="#eab308" strokeWidth="2" x="-18" y="-12" />
                                        <rect width="8" height="14" rx="2" fill="#eab308" x="3" y="-7" />
                                        <rect width="10" height="3" fill="#94a3b8" x="-12" y="-14" />
                                        <rect width="10" height="3" fill="#94a3b8" x="-12" y="11" />
                                        <rect width="10" height="3" fill="#94a3b8" x="2" y="-14" />
                                        <rect width="10" height="3" fill="#94a3b8" x="2" y="11" />
                                    </g>
                                </g>
                            </svg>
                        </div>
                    </div>
                </div>
            </section>

            {/* Scouting Reports Section */}
            <section className="py-16 lg:py-24 bg-slate-900 overflow-hidden relative border-t border-slate-800">
                <div className="absolute top-0 right-0 w-band h-band sm:w-orb sm:h-orb bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-8 relative z-10">
                    <div className="grid lg:grid-cols-2 gap-16 items-center">
                        <div className="order-1">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-sm text-emerald-400 font-medium mb-6">
                                <BarChart3 className="w-4 h-4" /> Scouting Reports
                            </div>
                            <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-6">
                                Data-driven alliance selection
                            </h2>
                            <p className="text-xl text-slate-400 mb-8 leading-relaxed">
                                Move beyond pen and paper. Empower your scouts to log match data seamlessly, even without Wi-Fi. Sync to the cloud and uncover powerful metrics for your picklist.
                            </p>
                            <ul className="space-y-4 mb-8">
                                {[
                                    "Deep quantitative analysis",
                                    "Offline-first pit & stand data entry",
                                    "Team progression charts"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                                            <Check className="w-4 h-4" />
                                        </div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Animated Scouting UI Right */}
                        <div className="order-2 relative w-full aspect-square md:aspect-video lg:aspect-square bg-slate-800/50 rounded-3xl border border-slate-700 p-4 sm:p-6 shadow-2xl flex flex-col justify-center overflow-hidden glass">
                            {/* Fake UI Header */}
                            <div className="absolute top-0 left-0 w-full h-12 border-b border-slate-700 bg-slate-800/80 flex items-center px-4 gap-2 text-slate-400 font-medium text-xs sm:text-sm z-20">
                                <div className="w-3 h-3 rounded-full bg-red-500/80 shrink-0"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/80 shrink-0"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/80 shrink-0"></div>
                                <span className="ml-2 sm:ml-4 flex items-center gap-2 truncate"><Trophy size={14} className="text-amber-500 shrink-0"/> Scouting Dashboard</span>
                            </div>
                            
                            <div className="w-full flex-1 mt-12 relative">
                                {/* Form View */}
                                <div className="absolute inset-0 z-10 animate-scouting-form flex flex-col justify-center px-1 sm:px-2">
                                    <div className="bg-slate-800 rounded-xl w-full border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
                                        <div className="p-3 bg-slate-900 border-b border-slate-700 font-bold text-sm text-white">New Scouting Report</div>
                                        <div className="p-4 space-y-3 bg-slate-800">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-2xs sm:text-xs font-bold text-slate-400 uppercase">Team #</label>
                                                    <div className="w-full border border-slate-600 rounded p-1.5 bg-slate-700 text-white text-sm">330</div>
                                                </div>
                                                <div>
                                                    <label className="text-2xs sm:text-xs font-bold text-slate-400 uppercase">Match #</label>
                                                    <div className="w-full border border-slate-600 rounded p-1.5 bg-slate-700 text-white text-sm">43</div>
                                                </div>
                                            </div>

                                            <div className="bg-slate-700/50 p-3 rounded-lg space-y-2">
                                                <h4 className="font-bold text-white text-xs">Autonomous</h4>
                                                <label className="flex items-center gap-2 text-white text-sm">
                                                    <div className="w-4 h-4 rounded bg-forge-600 flex items-center justify-center">
                                                        <Check size={12} className="text-white" />
                                                    </div>
                                                    <span className="font-medium">Has Autonomous</span>
                                                </label>
                                            </div>
                                            
                                            <div>
                                                <label className="text-2xs sm:text-xs font-bold text-slate-400 uppercase">Notes</label>
                                                <div className="w-full border border-slate-600 rounded p-2 h-12 bg-slate-700 text-white text-sm flex items-start">
                                                    <span className="animate-scouting-typewriter border-r-2 border-slate-400 pr-1 block leading-tight">Fast auto, solid defense.</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="p-3 bg-slate-900 border-t border-slate-700 flex justify-end gap-2">
                                            <div className="px-3 py-1.5 text-slate-300 rounded text-xs">Cancel</div>
                                            <div className="px-4 py-1.5 bg-forge-600 text-white rounded text-xs font-medium animate-scouting-btn shadow-lg shadow-forge-500/20">Save Report</div>
                                        </div>
                                    </div>
                                </div>

                                {/* List View */}
                                <div className="absolute inset-0 z-0 animate-scouting-list px-2 sm:px-4 pt-2">
                                    {/* Card 3 (Oldest - 254) */}
                                    <div className="absolute top-4 left-6 right-6 bg-slate-800 border border-slate-700 p-4 rounded-xl shadow-xl animate-scouting-card-shift-2">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <div className="text-xl font-black text-white">#254</div>
                                            </div>
                                            <div className="bg-slate-700 px-2 py-1 rounded text-xs font-bold text-slate-300">Match 41</div>
                                        </div>
                                        <div className="space-y-1.5 text-xs text-slate-300">
                                            <div className="flex justify-between border-b border-slate-700 pb-1">
                                                <span>Shooting</span><span>12 / 12 Shots</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Card 2 (Previous - 118) */}
                                    <div className="absolute top-4 left-4 right-4 bg-slate-800 border border-slate-700 p-4 rounded-xl shadow-2xl animate-scouting-card-shift-1 bg-slate-800/95 backdrop-blur">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <div className="text-xl font-black text-white">#118</div>
                                                <div className="text-2xs text-slate-400 mt-0.5">District Championship</div>
                                            </div>
                                            <div className="bg-slate-700 px-2 py-1 rounded text-xs font-bold text-slate-300">Match 42</div>
                                        </div>
                                        <div className="space-y-1.5 text-xs text-slate-300 mb-3">
                                            <div className="flex justify-between border-b border-slate-700 pb-1">
                                                <span>Autonomous</span><span className="text-green-400 font-bold">15 pts</span>
                                            </div>
                                            <div className="flex justify-between border-b border-slate-700 pb-1">
                                                <span>Shooting</span><span>9 / 10 Shots</span>
                                            </div>
                                            <div className="flex justify-between border-b border-slate-700 pb-1">
                                                <span>Parking</span><span className="text-forge-400 font-medium">Full Park</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 text-yellow-500">
                                            <Trophy size={12} fill="currentColor" />
                                            <Trophy size={12} fill="currentColor" />
                                            <Trophy size={12} fill="currentColor" />
                                            <Trophy size={12} fill="currentColor" />
                                            <Trophy size={12} fill="none" className="text-slate-600" />
                                        </div>
                                    </div>

                                    {/* Card 1 (New - 330) */}
                                    <div className="absolute top-4 left-2 right-2 bg-slate-800 border border-slate-600 p-4 rounded-xl shadow-2xl animate-scouting-card-in z-20 hover:border-forge-600 transition-colors">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <div className="text-xl sm:text-2xl font-black text-white">#330</div>
                                            </div>
                                            <div className="bg-slate-700 px-2 py-1 rounded text-xs font-bold text-slate-300">Match 43</div>
                                        </div>
                                        
                                        <div className="space-y-1.5 text-xs text-slate-300 mb-3">
                                            <div className="flex justify-between border-b border-slate-700 pb-1">
                                                <span>Autonomous</span><span className="text-green-400 font-bold">10 pts</span>
                                            </div>
                                            <div className="flex justify-between border-b border-slate-700 pb-1">
                                                <span>Parking</span><span className="text-forge-400 font-medium">Full Park</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-1 text-yellow-500 mb-2">
                                            <Trophy size={12} fill="currentColor" />
                                            <Trophy size={12} fill="currentColor" />
                                            <Trophy size={12} fill="currentColor" />
                                            <Trophy size={12} fill="none" className="text-slate-600" />
                                            <Trophy size={12} fill="none" className="text-slate-600" />
                                        </div>
                                        <p className="text-2xs bg-slate-700 p-2 rounded text-slate-300 italic">
                                            "Fast auto, solid defense."
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Pre-Match Checklist Section */}
            <section className="py-16 lg:py-24 bg-slate-900 overflow-hidden relative border-t border-slate-800">
                <div className="absolute top-0 left-0 w-band h-band sm:w-orb sm:h-orb bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-8 relative z-10">
                    <div className="grid lg:grid-cols-2 gap-16 items-center flex-col-reverse lg:flex-row-reverse">
                        
                        {/* Text Right */}
                        <div className="order-1 lg:order-2">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-sm text-blue-400 font-medium mb-6">
                                <ClipboardCheck className="w-4 h-4" /> Pre-Match Checklist
                            </div>
                            <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-6">
                                Arrive at each match with confidence
                            </h2>
                            <p className="text-xl text-slate-400 mb-8 leading-relaxed">
                                Queue up with confidence. Custom checklists ensure your drive team completes every crucial step before placing the robot on the field, resulting in fewer disconnected wires and uncharged batteries.
                            </p>
                            <ul className="space-y-4 mb-8">
                                {[
                                    "Customizable by subsystem",
                                    "Accountability & connection verification",
                                    "Works fully offline in the pits"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                                            <Check className="w-4 h-4" />
                                        </div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Animated Checklist Left */}
                        <div className="order-2 lg:order-1 relative w-full aspect-square md:aspect-video lg:aspect-square bg-slate-800/50 rounded-3xl border border-slate-700 p-4 sm:p-8 shadow-2xl flex items-center justify-center overflow-hidden glass">
                            {/* Fake UI Header */}
                            <div className="absolute top-0 left-0 w-full h-12 border-b border-slate-700 bg-slate-800/80 flex items-center px-4 gap-2 text-slate-400 font-medium text-xs sm:text-sm">
                                <div className="w-3 h-3 rounded-full bg-red-500/80 shrink-0"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/80 shrink-0"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/80 shrink-0"></div>
                                <span className="ml-2 sm:ml-4 truncate">Match 42 Preparation</span>
                            </div>
                            
                            <div className="w-full max-w-sm mt-12 space-y-4 relative">
                                {/* Progress Bar Header */}
                                <div className="mb-6">
                                    <div className="flex justify-between text-sm text-slate-300 mb-2">
                                        <span className="font-bold">Team Readiness</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 animate-progress-bar rounded-full"></div>
                                    </div>
                                </div>

                                {/* Checklist Items */}
                                {[
                                    { label: "Install fresh battery", delay: "0s" },
                                    { label: "Charge driver hub", delay: "1.2s" },
                                    { label: "Check all connections and screws", delay: "2.4s" },
                                    { label: "Turn on robot", delay: "3.6s" }
                                ].map((item, idx) => (
                                    <div key={idx} className="flex items-center gap-4 bg-slate-900 border border-slate-700 p-3 sm:p-4 rounded-xl shadow-lg relative overflow-hidden group">
                                        <div className="relative w-6 h-6 border-2 border-slate-600 rounded-md flex items-center justify-center flex-shrink-0 animate-checkbox" style={{ animationDelay: item.delay }}>
                                            <Check className="w-4 h-4 text-white opacity-0 animate-checkmark" style={{ animationDelay: item.delay }} />
                                        </div>
                                        <span className="font-medium text-slate-300 animate-strikethrough" style={{ animationDelay: item.delay }}>
                                            {item.label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Roles / Pricing Section */}
            <section className="py-16 lg:py-24 bg-slate-900/50 relative z-10 border-t border-slate-800">
                <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4">Built for the whole team</h2>
                        <p className="text-slate-400 text-lg">Specific tools tailored for the specific roles on your roster.</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        {/* Student Tier */}
                        <div className="p-8 rounded-3xl bg-slate-800/40 border border-slate-700 hover:border-blue-500/50 transition-all flex flex-col h-full">
                            <div className="w-12 h-12 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-6">
                                <User className="w-6 h-6" />
                            </div>
                            <h3 className="text-2xl font-bold mb-2">Student</h3>
                            <p className="text-slate-400 mb-8 border-b border-slate-700/50 pb-8">For builders, programmers, and drivers executing the plan.</p>

                            <ul className="space-y-4 mb-8 flex-1">
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" /><span className="text-slate-300">Complete assigned sprint tasks</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" /><span className="text-slate-300">Submit match scouting data offline</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" /><span className="text-slate-300">Review Match Planner strategies</span></li>
                            </ul>
                        </div>

                        {/* Coach Tier */}
                        <div className="p-8 rounded-3xl bg-gradient-to-b from-slate-800 to-slate-900 border-2 border-forge-500 relative transform md:-translate-y-4 shadow-2xl shadow-forge-500/10 flex flex-col h-full">
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-forge-500 to-amber-500 text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider">
                                Team Admin
                            </div>
                            <div className="w-12 h-12 rounded-full bg-forge-500/20 text-forge-400 flex items-center justify-center mb-6 mt-2">
                                <Crown className="w-6 h-6" />
                            </div>
                            <h3 className="text-2xl font-bold mb-2">Coach</h3>
                            <p className="text-slate-400 mb-8 border-b border-slate-700/50 pb-8">For lead administrators and head teachers managing the overall operation.</p>

                            <ul className="space-y-4 mb-8 flex-1">
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-forge-400 shrink-0 mt-0.5" /><span className="text-slate-300">Manage user roles & permissions</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-forge-400 shrink-0 mt-0.5" /><span className="text-slate-300">Create new seasons & rosters</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-forge-400 shrink-0 mt-0.5" /><span className="text-slate-300">Oversee sprint planning metrics</span></li>
                            </ul>

                            <button
                                onClick={() => navigate('/login?mode=signup')}
                                className="w-full py-4 bg-forge-500 hover:bg-forge-600 text-white rounded-xl font-bold transition-colors"
                            >
                                Register a Team
                            </button>
                        </div>

                        {/* Mentor Tier */}
                        <div className="p-8 rounded-3xl bg-slate-800/40 border border-slate-700 hover:border-emerald-500/50 transition-all flex flex-col h-full">
                            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-6">
                                <Brain className="w-6 h-6" />
                            </div>
                            <h3 className="text-2xl font-bold mb-2">Mentor</h3>
                            <p className="text-slate-400 mb-8 border-b border-slate-700/50 pb-8">For parent volunteers and industry professionals guiding the team.</p>

                            <ul className="space-y-4 mb-8 flex-1">
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" /><span className="text-slate-300">Create & distribute Kanban tasks</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" /><span className="text-slate-300">Draw Match Planner diagrams</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" /><span className="text-slate-300">Analyze aggregate scouting data</span></li>
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-8 border-t border-slate-800 text-center text-slate-500">
                <p>© {new Date().getFullYear()} FalconForge platform. Built for competitive robotics.</p>
            </footer>
        </div>
    );
}
