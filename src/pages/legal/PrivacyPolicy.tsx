import { Link } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';

export default function PrivacyPolicy() {
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
                        <Shield className="text-orange-500" size={28} />
                        <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
                    </div>
                </div>

                {/* Content */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 md:p-8 shadow-xl">
                    <p className="text-slate-400 text-sm mb-6">Effective Date: January 2026</p>

                    <div className="prose prose-invert prose-slate max-w-none">
                        <p className="text-slate-300 mb-6">
                            This Privacy Policy describes how FalconForge ("we," "us," or "our") collects, uses, and protects your personal information when you use our service.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">1. Information We Collect</h2>
                        <p className="text-slate-300 mb-4">We collect information you provide directly to us, including:</p>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Account information (email address, name, password)</li>
                            <li>Team information (team name, team number, member roles)</li>
                            <li>Content you create (tasks, scouting reports, match plans, etc.)</li>
                            <li>Communications with us</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">2. How We Use Your Information</h2>
                        <p className="text-slate-300 mb-4">We use the information we collect to:</p>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Provide, maintain, and improve our services</li>
                            <li>Process transactions and send related information</li>
                            <li>Send technical notices and support messages</li>
                            <li>Respond to your comments and questions</li>
                            <li>Protect against fraudulent or illegal activity</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">3. Information Sharing</h2>
                        <p className="text-slate-300 mb-4">We do not sell your personal information. We may share information:</p>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>With other members of your team as part of the service functionality</li>
                            <li>With service providers who assist in our operations</li>
                            <li>When required by law or to protect rights</li>
                            <li>In connection with a merger or acquisition</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">4. Data Security</h2>
                        <p className="text-slate-300">
                            We implement appropriate security measures to protect your personal information. However, no method of transmission over the Internet is 100% secure.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">5. Children's Privacy (COPPA)</h2>
                        <p className="text-slate-300">
                            Our service is designed for use by FTC robotics teams, which may include users under 13. We comply with COPPA requirements by requiring coach consent and supervision for minor users. Coaches are responsible for obtaining appropriate parental consent.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">6. Data Retention</h2>
                        <p className="text-slate-300">
                            We retain your information for as long as your account is active or as needed to provide services. You may request deletion of your account and associated data.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">7. Your Rights</h2>
                        <p className="text-slate-300 mb-4">You have the right to:</p>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Access your personal information</li>
                            <li>Correct inaccurate information</li>
                            <li>Request deletion of your information</li>
                            <li>Object to processing of your information</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">8. Changes to This Policy</h2>
                        <p className="text-slate-300">
                            We may update this Privacy Policy from time to time. We will notify you of changes by posting the new policy on this page.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">9. Contact Us</h2>
                        <p className="text-slate-300">
                            If you have questions about this Privacy Policy, please contact us at: support@falconforge.app
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
