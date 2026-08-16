import { FileText } from 'lucide-react';
import LegalPage, { LegalSection } from './LegalPage';

/**
 * Terms of service.
 *
 * Rewritten in Sprint 6 to say the things the sprint brief asked for and the previous draft did
 * not: no uptime guarantee, discontinuation at any time, what a licence actually is, and that
 * refunds are discretionary. The old version was written as though FalconForge were an
 * established service with obligations it cannot currently meet — a solo maintainer running a
 * free beta on GitHub Pages should not promise availability, and promising it is worse than
 * saying plainly that there is none.
 */
export default function TermsAndConditions() {
    return (
        <LegalPage
            title="Terms and Conditions"
            icon={FileText}
            attestation="terms"
            effective="16 August 2026"
        >
            <p className="mb-6 text-sm text-slate-300">
                These Terms govern your use of FalconForge (&quot;the Service&quot;). FalconForge is
                built and run by one person as a tool for FTC robotics teams. By creating an
                account, creating a team, or using the Service, you agree to these Terms. If you do
                not agree, do not use the Service.
            </p>

            <LegalSection heading="1. Who may use FalconForge">
                <p>
                    You must be 13 or older to hold your own account. Creating and administering a
                    team requires you to be 18 or older, because the team admin takes on
                    responsibilities for the young people on the team.
                </p>
                <p>
                    Members under 13 do not hold accounts. A parent or guardian holds the account and
                    the child appears as a managed profile under it. See the Privacy Policy for what
                    that means in practice.
                </p>
            </LegalSection>

            <LegalSection heading="2. The team admin's responsibilities">
                <p>Each team has exactly one admin. If that is you, you are agreeing that:</p>
                <ul className="list-inside list-disc space-y-1">
                    <li>
                        You decide who joins the team, and you approve each request. Approving a
                        member uses one of your team&apos;s licensed seats.
                    </li>
                    <li>
                        You are responsible for obtaining parental consent for members under 13, and
                        you act as the parent&apos;s agent for the purposes of COPPA. FalconForge
                        relies on you for this and cannot verify it.
                    </li>
                    <li>
                        You are the billing contact for the team, if and when the Service starts
                        charging.
                    </li>
                    <li>
                        You will hand the role over if you leave, using the handover flow in Admin
                        Settings. If you leave without doing so, contact us and we can reassign it.
                    </li>
                </ul>
            </LegalSection>

            <LegalSection heading="3. Licences and seats">
                <p>
                    A team needs a current licence to make changes. A licence grants a number of
                    seats, or an unlimited number, for a period of time or open-ended.
                </p>
                <p>
                    A seat is used by each approved member of the team, including the admin.
                    Approving a member when no seat is free is refused. Removing a member frees
                    their seat immediately.
                </p>
                <p>
                    <strong>
                        When a licence ends, the team becomes read-only. Nothing is deleted.
                    </strong>{' '}
                    Every task, scouting report, match plan and checklist stays exactly where it is
                    and stays readable. You get your data back the moment the team is licensed
                    again. We will not hold your work hostage.
                </p>
                <p>
                    During the beta, licences are gifts and cost nothing. We may end the beta and
                    begin charging, and we will tell you before we do.
                </p>
            </LegalSection>

            <LegalSection heading="4. No uptime guarantee">
                <p>
                    <strong>
                        The Service is provided as-is, with no guarantee of availability whatsoever.
                    </strong>{' '}
                    There is no service level agreement, no uptime commitment and no support
                    response time. It may be unavailable, slow, or broken at any moment, including
                    during your competition.
                </p>
                <p>
                    This is a genuine warning rather than boilerplate. FalconForge works offline
                    precisely because you should not depend on our servers being reachable from a
                    venue — your device keeps working and syncs when it can. Do not make your
                    team&apos;s competition depend on the Service being up.
                </p>
            </LegalSection>

            <LegalSection heading="5. We may discontinue the Service at any time">
                <p>
                    FalconForge may be discontinued, in whole or in part, at any time and for any
                    reason, including because maintaining it stops being practical for one person.
                </p>
                <p>
                    If we discontinue it, we will make a reasonable effort to give notice and to
                    provide a way to export your team&apos;s data first. We cannot promise a
                    specific amount of notice.
                </p>
            </LegalSection>

            <LegalSection heading="6. Payment and refunds">
                <p>
                    Paid plans do not exist yet. When they do, they will be charged per named member
                    per team, and prices will be published before they take effect.
                </p>
                <p>
                    <strong>Refunds are at our discretion.</strong> We are not promising a refund
                    policy. If something goes wrong and you think a refund is fair, tell us and we
                    will consider it in good faith. We would rather refund somebody than argue with
                    them.
                </p>
                <p>
                    Reducing your seat count is always allowed. You may end up with more approved
                    members than seats, in which case nobody loses access and no new member can be
                    approved until you are back within your seat count.
                </p>
            </LegalSection>

            <LegalSection heading="7. Your content is yours">
                <p>
                    Everything your team puts into FalconForge belongs to your team. We claim no
                    ownership of it and we do not sell it. We use it to run the Service for you and
                    for nothing else.
                </p>
                <p>
                    We may look at your team&apos;s data when you ask us to help with a problem, or
                    when we have to in order to keep the Service working or to investigate a
                    credible report of abuse. If we do so for any reason other than helping you, we
                    keep a record of it.
                </p>
            </LegalSection>

            <LegalSection heading="8. Acceptable use">
                <p>
                    The Acceptable Use policy is part of these Terms. Briefly: this is a tool used by
                    minors, and behaviour that would be unacceptable in a school robotics workshop is
                    unacceptable here.
                </p>
            </LegalSection>

            <LegalSection heading="9. Suspension and termination">
                <p>
                    We may suspend or remove an account or a team that breaks these Terms or the
                    Acceptable Use policy, or where we believe there is a risk to a young person.
                    Where it is safe and practical to do so, we will explain why and give you a
                    chance to respond first.
                </p>
                <p>You may stop using the Service and delete your account at any time.</p>
            </LegalSection>

            <LegalSection heading="10. Liability">
                <p>
                    To the fullest extent the law allows, FalconForge is not liable for indirect or
                    consequential loss, lost data, or lost competition outcomes arising from your use
                    of the Service. Where liability cannot be excluded, it is limited to the amount
                    you have paid us in the twelve months before the claim — which, during the beta,
                    is nothing.
                </p>
                <p>
                    Nothing here limits liability that cannot lawfully be limited, including for
                    death or personal injury caused by negligence, or for fraud.
                </p>
            </LegalSection>

            <LegalSection heading="11. Changes to these Terms">
                <p>
                    We may change these Terms. When a change affects what you agreed to, we raise the
                    version of this document and ask you to accept it again the next time you sign
                    in. We keep a record of each version you accepted and when, and accepting a new
                    version does not erase that record.
                </p>
                <p>
                    If you do not accept a new version, you can still read everything your team has
                    made; you will not be able to make changes.
                </p>
            </LegalSection>

            <LegalSection heading="12. Contact">
                <p>
                    FalconForge is run by one person and you can reach them directly. Questions,
                    complaints, requests to reassign an abandoned team, or anything about a
                    child&apos;s data: get in touch through the address published on
                    falcon-forge.com.
                </p>
            </LegalSection>
        </LegalPage>
    );
}
