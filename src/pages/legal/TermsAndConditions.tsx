import { Link } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';

export default function TermsAndConditions() {
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
                        <FileText className="text-orange-500" size={28} />
                        <h1 className="text-2xl font-bold text-white">Terms and Conditions</h1>
                    </div>
                </div>

                {/* Content */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 md:p-8 shadow-xl">
                    <p className="text-slate-400 text-sm mb-6">Effective Date: January 2026</p>

                    <div className="prose prose-invert prose-slate max-w-none">
                        <p className="text-slate-300 mb-6">
                            These Terms and Conditions ("Terms") govern access to and use of FalconForge ("Service," "we," "us").
                            By creating a coach account or using the Service as a coach, you agree to these Terms.
                            If you do not agree, do not use the Service.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">1. Eligibility</h2>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>The Service may only be contracted by individuals 18 years of age or older</li>
                            <li>Coaches must have legal authority to manage students and teams</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">2. Responsibility for Minors and COPPA</h2>
                        <p className="text-slate-300 mb-4">By creating teams or inviting users, you represent and warrant that:</p>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>You are at least 18 years old</li>
                            <li>You are a coach, mentor, teacher, or authorized adult</li>
                            <li>You have obtained all necessary parental, guardian, or school consent for minors</li>
                            <li>You agree to act as the parent's or guardian's agent for purposes of the Children's Online Privacy Protection Act (COPPA)</li>
                        </ul>
                        <p className="text-slate-300 mt-4">
                            Students under 18 may only use the Service as part of a team managed by an authorized adult.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">3. Accounts and Teams</h2>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Coaches may create and manage one or more teams</li>
                            <li>Users may belong to multiple teams</li>
                            <li>Access and permissions are determined per team</li>
                            <li>Coaches control team membership and approval</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">4. Subscriptions and Billing</h2>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Subscriptions are billed monthly to coaches or organizations</li>
                            <li>Billing is based on approved team members</li>
                            <li>Coaches may add or remove members at any time</li>
                            <li>Removed members immediately lose access and are no longer billed</li>
                            <li>Fees are non-refundable except as required by law</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">5. Acceptable Use</h2>
                        <p className="text-slate-300 mb-4">You agree not to:</p>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Violate laws or school policies</li>
                            <li>Harass, bully, or harm others</li>
                            <li>Upload inappropriate or illegal content</li>
                            <li>Attempt unauthorized access</li>
                            <li>Reverse engineer or misuse the Service</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">6. Data and Privacy</h2>
                        <ul className="list-disc list-inside text-slate-300 space-y-2">
                            <li>Personal data is handled according to the Privacy Policy</li>
                            <li>User information is only visible within the same team</li>
                            <li>No public directory of users is provided</li>
                        </ul>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">7. Termination</h2>
                        <p className="text-slate-300">
                            We may suspend or terminate access for violations of these Terms, misuse, or legal requirements.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">8. Disclaimer</h2>
                        <p className="text-slate-300">
                            The Service is provided "as is" and "as available" without warranties of any kind.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">9. Limitation of Liability</h2>
                        <p className="text-slate-300">
                            To the maximum extent permitted by law, FalconForge is not liable for indirect or consequential damages.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">10. Changes to Terms</h2>
                        <p className="text-slate-300">
                            We may update these Terms. Continued use constitutes acceptance.
                        </p>

                        <h2 className="text-lg font-semibold text-white mt-8 mb-4">11. Contact</h2>
                        <p className="text-slate-300">
                            Email: support@falconforge.app
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
