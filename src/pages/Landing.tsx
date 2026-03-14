import { useNavigate } from 'react-router-dom';
import { ArrowRight, Activity, Users, Zap, Shield, ChevronRight, PenTool, Check, Crown, User, Brain } from 'lucide-react';

export default function LandingPage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-orange-500/30 overflow-x-hidden">
            {/* Navigation Bar */}
            <nav className="fixed top-0 w-full z-50 glass border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-xl border border-slate-700/50 p-1 flex items-center justify-center">
                                <img
                                    src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                                    className="w-full h-full object-contain"
                                    alt="FalconForge Logo"
                                />
                            </div>
                            <span className="text-2xl font-black italic tracking-tighter">
                                <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span>
                                <span className="text-slate-300">FORGE</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => navigate('/login')}
                                className="text-slate-300 hover:text-white font-medium transition-colors hidden sm:block"
                            >
                                Log In
                            </button>
                            <button
                                onClick={() => navigate('/login?mode=signup')}
                                className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white px-5 py-2 rounded-xl font-medium shadow-lg shadow-orange-500/25 transition-all flex items-center gap-2"
                            >
                                Sign Up <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <main className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
                {/* Moving Background Screensaver */}
                <div 
                    className="absolute inset-0 z-0 opacity-40 animate-pan-bg mix-blend-lighten"
                    style={{ backgroundImage: `url('${import.meta.env.BASE_URL}hero_bg.png')` }}
                ></div>
                
                {/* Background Effects Gradient Overlay (fades the edges to blend into the rest of the site) */}
                <div className="absolute inset-0 z-0 bg-gradient-to-b from-slate-900/50 via-slate-900/70 to-slate-900/100 pointer-events-none"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-orange-600/20 rounded-full blur-3xl pointer-events-none z-0"></div>
                
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 backdrop-blur-md text-sm text-amber-400 font-medium mb-8 shadow-xl">
                        <Zap className="w-4 h-4" /> The ultimate agile engineering solution for your robotics team
                    </div>
                    
                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8">
                        Don't just build your robot...<br />
                        <span className="bg-gradient-to-r from-orange-400 via-orange-500 to-amber-500 text-transparent bg-clip-text tracking-tighter italic">
                            FORGE IT
                        </span>
                    </h1>
                    
                    <p className="mt-6 text-xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
                        The complete platform for competitive robotics teams to plan sprints, analyze scouting data, strategize with alliances, and learn real-world agile engineering processes.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            onClick={() => navigate('/login?mode=signup')}
                            className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white rounded-2xl font-bold text-lg shadow-xl shadow-orange-500/25 transition-all flex items-center justify-center gap-2"
                        >
                            Start Forging Now <ChevronRight className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => navigate('/login')}
                            className="w-full sm:w-auto px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold text-lg border border-slate-700 transition-all"
                        >
                            Log In
                        </button>
                    </div>
                </div>
            </main>

            {/* Features Section */}
            <section className="py-24 bg-slate-900/50 border-t border-slate-800 relative z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4">Four modules. One unified workflow.</h2>
                        <p className="text-slate-400 text-lg">Everything your team needs to go from kickoff to world championships.</p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Feature Cards */}
                        {[
                            {
                                icon: <Activity className="w-6 h-6 text-orange-400" />,
                                title: "Agile Planning",
                                desc: "Kanban boards and sprint planning adapted specifically for robotics build seasons."
                            },
                            {
                                icon: <Users className="w-6 h-6 text-blue-400" />,
                                title: "Scouting Reports",
                                desc: "Detailed match analysis and offline-first data sync for competition scenarios."
                            },
                            {
                                icon: <Zap className="w-6 h-6 text-amber-400" />,
                                title: "Match Planner",
                                desc: "Visualize strategies, assign tasks to alliance partners, and win more matches."
                            },
                            {
                                icon: <Shield className="w-6 h-6 text-emerald-400" />,
                                title: "AI Portfolio",
                                desc: "Automatically document your season and generate judging material with our AI."
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
            
            {/* Match Planner Animation Section */}
            <section className="py-24 bg-slate-900 overflow-hidden relative border-t border-slate-800">
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="grid lg:grid-cols-2 gap-16 items-center">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-sm text-orange-400 font-medium mb-6">
                                <PenTool className="w-4 h-4" /> Strategy & Drawing
                            </div>
                            <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-6">
                                Visualize your next move
                            </h2>
                            <p className="text-xl text-slate-400 mb-8 leading-relaxed">
                                Our built-in Match Planner lets you draw, diagram, and formulate complex alliance strategies directly over the season's field map, saving your master plans for the pre-match huddle.
                            </p>
                            <ul className="space-y-4 mb-8">
                                {[
                                    "Save unlimited custom plays",
                                    "Pre-match task checklists",
                                    "Real-time whiteboard feeling"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400">
                                            <Check className="w-4 h-4" />
                                        </div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        
                        {/* Animated Drawing Diagram */}
                        <div className="relative w-full aspect-square md:aspect-video lg:aspect-square bg-slate-800/50 rounded-3xl border border-slate-700 p-8 shadow-2xl flex items-center justify-center overflow-hidden glass">
                            {/* Fake UI Header */}
                            <div className="absolute top-0 left-0 w-full h-12 border-b border-slate-700 bg-slate-800/80 flex items-center px-4 gap-2">
                                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                            </div>
                            
                            <svg viewBox="0 0 400 300" className="w-full h-full drop-shadow-[0_0_15px_rgba(249,115,22,0.4)]">
                                {/* Definitions including Grid and Animated Masks for precisely syncing the stroke drawing to the robots */}
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
                                <g className="drop-shadow-[0_0_8px_rgba(249,115,22,0.8)]">
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
                                        {/* Scaled up 1.5x */}
                                        <rect width="36" height="24" rx="4" fill="#0f172a" stroke="#f97316" strokeWidth="2" x="-18" y="-12" />
                                        <rect width="8" height="14" rx="2" fill="#f97316" x="3" y="-7" />
                                        <rect width="10" height="3" fill="#94a3b8" x="-12" y="-14" />
                                        <rect width="10" height="3" fill="#94a3b8" x="-12" y="11" />
                                        <rect width="10" height="3" fill="#94a3b8" x="2" y="-14" />
                                        <rect width="10" height="3" fill="#94a3b8" x="2" y="11" />
                                    </g>
                                </g>

                                {/* Robot 2 Layout */}
                                <g className="drop-shadow-[0_0_8px_rgba(234,179,8,0.8)]" opacity="0.9">
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
                                        {/* Scaled up 1.5x */}
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
            
            {/* Roles / Pricing Section */}
            <section className="py-24 bg-slate-900/50 relative z-10 border-t border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
                        <div className="p-8 rounded-3xl bg-gradient-to-b from-slate-800 to-slate-900 border-2 border-orange-500 relative transform md:-translate-y-4 shadow-2xl shadow-orange-500/10 flex flex-col h-full">
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider">
                                Team Admin
                            </div>
                            <div className="w-12 h-12 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center mb-6 mt-2">
                                <Crown className="w-6 h-6" />
                            </div>
                            <h3 className="text-2xl font-bold mb-2">Coach</h3>
                            <p className="text-slate-400 mb-8 border-b border-slate-700/50 pb-8">For lead administrators and head teachers managing the overall operation.</p>
                            
                            <ul className="space-y-4 mb-8 flex-1">
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" /><span className="text-slate-300">Manage user roles & permissions</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" /><span className="text-slate-300">Create new seasons & rosters</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" /><span className="text-slate-300">Oversee sprint planning metrics</span></li>
                                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" /><span className="text-slate-300">Generate AI Portfolios</span></li>
                            </ul>
                            
                            <button
                                onClick={() => navigate('/login?mode=signup')}
                                className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold transition-colors"
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
