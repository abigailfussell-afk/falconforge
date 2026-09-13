import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ATTESTATION_VERSIONS } from '../../lib/attestations';
import type { AttestationType } from '../../types';

/**
 * The chrome every legal document shares.
 *
 * Three pages carried three copies of the same header, card and back link, which is how the
 * "pending legal review" notice ended up on none of them and the effective date ended up
 * hardcoded to January 2026 on all of them. One shell means a document is a title, a version and
 * its prose.
 *
 * THE VERSION IS READ FROM `ATTESTATION_VERSIONS`, NOT WRITTEN HERE. That constant is what
 * decides whether somebody has to re-accept, so a page that stated its own version could say 2.0
 * while the app still accepted 1.0 — and nobody would notice, because both numbers look right on
 * their own. Reading it from the same place makes the document and the re-attestation rule
 * incapable of disagreeing.
 */
export interface LegalPageProps {
    title: string;
    icon: LucideIcon;
    /** Which attestation this document is the text of. Drives the version shown. */
    attestation: AttestationType;
    /** When this version took effect. Bump alongside the version in `ATTESTATION_VERSIONS`. */
    effective: string;
    children: ReactNode;
}

export default function LegalPage({
    title,
    icon: Icon,
    attestation,
    effective,
    children,
}: LegalPageProps) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 md:p-8">
            <div className="mx-auto max-w-3xl">
                <div className="mb-8 flex items-center gap-4">
                    <Link
                        to="/login"
                        className="rounded-lg bg-slate-700/50 p-2 text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                        aria-label="Back"
                    >
                        <ArrowLeft size={20} />
                    </Link>
                    <div className="flex items-center gap-3">
                        <Icon className="text-forge-500" size={28} />
                        <h1 className="text-2xl font-bold text-white">{title}</h1>
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6 shadow-xl backdrop-blur-xl md:p-8">
                    {/*
                      * NO "Draft — pending legal review" NOTICE, and its removal is a decision
                      * rather than a tidy-up (Kevin, 2026-09-05).
                      *
                      * It was added when these documents had been read by nobody outside the
                      * project. The 2026-08-22 review that cleared the COPPA design is judged to
                      * cover them, so the banner now overstates the uncertainty: a coach being
                      * asked to ACCEPT a document should not be told in the same breath that
                      * nobody has checked it. The version-and-effective-date line below, and the
                      * re-acceptance promise at the foot, are what a reader actually needs.
                      *
                      * Restoring it is a one-component change if a real review comes back with
                      * findings — which is why this note stays instead of the history being
                      * silently lost.
                      */}
                    <p
                        data-testid="legal-version"
                        className="mb-6 text-sm text-slate-400"
                    >
                        Version {ATTESTATION_VERSIONS[attestation]} · Effective {effective}
                    </p>

                    <div className="prose prose-invert prose-slate max-w-none">{children}</div>

                    <div className="mt-8 border-t border-slate-700/50 pt-6">
                        <p className="text-xs text-slate-500">
                            When we change a document in a way that affects what you agreed to, we
                            raise its version and ask you to accept it again the next time you sign
                            in. We keep a record of every version you have accepted and when — we do
                            not overwrite the old one.
                        </p>
                        <nav className="mt-3 flex flex-wrap gap-4 text-xs">
                            <Link to="/legal/terms" className="text-forge-400 hover:text-forge-300">
                                Terms &amp; Conditions
                            </Link>
                            <Link to="/legal/privacy" className="text-forge-400 hover:text-forge-300">
                                Privacy Policy
                            </Link>
                            <Link to="/legal/community" className="text-forge-400 hover:text-forge-300">
                                Acceptable Use
                            </Link>
                        </nav>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** A numbered section. Kept here so the three documents cannot drift apart typographically. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
    return (
        <section className="mb-6">
            <h2 className="mb-2 text-lg font-semibold text-white">{heading}</h2>
            <div className="space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
        </section>
    );
}
