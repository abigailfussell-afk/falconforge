import { Link } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';

export default function CommunityGuidelines() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 md:p-8">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <Link
                        to="/login"
                        className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </Link>
                    <div className="flex items-center gap-3">
                        <Users className="text-orange-500" size={28} />
                        <h1 className="text-2xl font-bold text-white">Community Guidelines & Code of Conduct</h1>
                    </div>
                </div>

                {/* Content */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 md:p-8 shadow-xl">
                    <p className="text-slate-400 text-sm mb-6">
                        All users must follow these guidelines to ensure a safe and respectful environment.
                    </p>

                    <div className="prose prose-invert prose-slate max-w-none">
                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">1. Respect Others</h2>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Treat all users with respect</li>
                            <li>No harassment, bullying, or discrimination</li>
                            <li>No abusive or threatening behavior</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">2. Appropriate Content</h2>
                        <p className="text-slate-300 mb-4">Do not post or share:</p>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Offensive or explicit content</li>
                            <li>Hate speech</li>
                            <li>Illegal material</li>
                            <li>Personal information without consent</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">3. Safety and Privacy</h2>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Do not attempt to access private data</li>
                            <li>Do not share login credentials</li>
                            <li>Respect team and school privacy expectations</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">4. Appropriate Use</h2>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Use the Service only for educational and team-related purposes</li>
                            <li>Do not spam, disrupt, or misuse features</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">5. Enforcement</h2>
                        <p className="text-slate-300 mb-4">Violations may result in:</p>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Content removal</li>
                            <li>Account suspension</li>
                            <li>Removal from teams</li>
                            <li>Termination of access</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">6. Reporting</h2>
                        <p className="text-slate-300">
                            Users should report violations to their coach or through the app's reporting tools.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">7. Acknowledgment</h2>
                        <p className="text-slate-300">
                            By using the Service, users agree to follow these Community Guidelines.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
