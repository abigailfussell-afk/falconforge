import { Shield } from 'lucide-react';
import LegalPage, { LegalSection } from './LegalPage';

/**
 * Privacy policy, with the COPPA posture the sprint brief asked for stated explicitly.
 *
 * The substance here is the under-13 model, because that is the part with legal weight and the
 * part the schema is actually built around: a child under 13 has NO account, no credentials and no
 * row in `auth.users`. Their membership is a `team_members` row whose `user_id` is the guardian
 * and whose `managed_profile_id` points at the child. This document has to describe that
 * accurately, because it is the claim a parent is relying on.
 */
export default function PrivacyPolicy() {
    return (
        <LegalPage
            title="Privacy Policy"
            icon={Shield}
            attestation="privacy"
            effective="16 August 2026"
        >
            <p className="mb-6 text-sm text-slate-300">
                FalconForge is used by school-age robotics teams, so a lot of the people in it are
                minors. This policy says what we collect, why, and what we do not do. It is written
                to be read rather than to be defensible.
            </p>

            <LegalSection heading="1. What we collect">
                <p>For a person with their own account:</p>
                <ul className="list-inside list-disc space-y-1">
                    <li>Email address and display name — to identify you and let your team find you.</li>
                    <li>
                        An age bracket (under 13, 13–17, or 18+) — not a date of birth. We need to
                        know which rules apply to you, not how old you are.
                    </li>
                    <li>
                        Which teams you belong to, your role, and whether your membership is
                        approved.
                    </li>
                    <li>
                        Which legal documents you have accepted, at which version, and when.
                    </li>
                    <li>
                        The work you do in the app: tasks, scouting reports, match plans, checklists,
                        meeting attendance.
                    </li>
                </ul>
                <p>
                    We do not collect location, contacts, advertising identifiers or behavioural
                    analytics. There are no third-party trackers in FalconForge.
                </p>
            </LegalSection>

            <LegalSection heading="2. Members under 13 — our COPPA posture">
                <p>
                    <strong>
                        A member under 13 does not have a FalconForge account and cannot create one.
                    </strong>{' '}
                    There are no credentials for them to hold and no way for them to sign in.
                </p>
                <p>
                    Instead, a parent or guardian holds an account, and the child appears on the team
                    as a <em>managed profile</em> under that account. The guardian signs in; the
                    child does not. For a managed profile we store a display name and a birth year —
                    not an email address, because the child has no account to attach one to.
                </p>
                <p>
                    We rely on the team admin — an adult who has accepted responsibility for it — to
                    obtain verifiable parental consent before a child is added, and the admin acts as
                    the parent&apos;s agent for COPPA purposes. We cannot independently verify that
                    consent was obtained, and we say so plainly rather than implying we can.
                </p>
                <p>
                    A guardian may ask us to show them, correct, or delete everything associated with
                    their child at any time, and we will do it without asking why. Contact us
                    directly.
                </p>
            </LegalSection>

            <LegalSection heading="3. What we never do">
                <ul className="list-inside list-disc space-y-1">
                    <li>We do not sell personal information. There is no circumstance in which we would.</li>
                    <li>We do not show advertising and we do not profile anyone for it.</li>
                    <li>We do not use your team&apos;s data to train machine-learning models.</li>
                    <li>
                        We do not send marketing email to anyone under 18, and very little to anyone
                        else.
                    </li>
                </ul>
            </LegalSection>

            <LegalSection heading="4. Who can see your team's data">
                <p>
                    Your team&apos;s data is visible to the approved members of your team, and to
                    nobody else&apos;s team. That separation is enforced in the database itself
                    rather than in the app, so a bug in the interface cannot expose one team&apos;s
                    work to another.
                </p>
                <p>
                    A guardian sees their own child and their child&apos;s team, not other
                    children&apos;s private details beyond what any team member sees.
                </p>
                <p>
                    {/*
                      * "as the operator", not "as an operator of any kind" — deliberately worded
                      * to avoid the two-word phrase the project's cast-count ratchet greps for in
                      * src/. Ordinary English there, but prose that inflates a code-quality metric
                      * makes every future sprint's comparison ambiguous for no benefit.
                      */}
                    The person who runs FalconForge has administrative access to the database, as the
                    operator of any service does. They use it to keep the Service working and to help
                    when you ask. They do not read your team&apos;s content for any other purpose.
                </p>
            </LegalSection>

            <LegalSection heading="5. Where your data lives">
                <p>
                    Data is stored with Supabase, which hosts on Amazon Web Services. A copy also
                    lives on your own device, which is what makes the app work without a network at a
                    competition venue.
                </p>
                <p>
                    Signing out clears the copy on your device. Data may be processed in the United
                    States.
                </p>
            </LegalSection>

            <LegalSection heading="6. How long we keep it">
                <p>
                    We keep your team&apos;s data for as long as the team exists, including across
                    seasons — a new season is a fresh start for planning, not a deletion of last
                    year&apos;s work.
                </p>
                <p>
                    <strong>A lapsed licence never deletes anything.</strong> The team becomes
                    read-only and everything stays readable.
                </p>
                {/*
                  * SEC-11. This paragraph used to open "When you delete your account", which
                  * described a button that has never existed — there is no self-serve account
                  * deletion, and grepping for one finds nothing. A privacy policy that describes
                  * an affordance the product does not have is the same defect as a UI control
                  * that does nothing (`docs/failure-modes.md` §8), on the one document a
                  * regulator or a parent would read literally.
                  *
                  * "When you ask us to delete your account" is what actually happens, and it is
                  * now backed by a tool rather than a psql session: `operator_erase_user`.
                  */}
                <p>
                    When you ask us to delete your account we remove your personal information and
                    your memberships, across every team you belong to, and your sign-in stops
                    working. Work you contributed to a team stays with the team, because it is the
                    team&apos;s record rather than yours alone — the same way notes on a workshop
                    whiteboard do not leave with the person who wrote them.
                </p>
                <p>
                    A guardian does not have to ask: the &ldquo;Remove&rdquo; button on a
                    child&apos;s card removes that child&apos;s profile, their place on any team,
                    their attendance record and the consents given for them, and nothing else.
                </p>
            </LegalSection>

            <LegalSection heading="7. Your rights">
                <p>
                    You can ask us for a copy of what we hold about you, ask us to correct it, or ask
                    us to delete it. If you are a parent or guardian, you can do the same on behalf
                    of your child. We do not require a formal process — just ask.
                </p>
            </LegalSection>

            <LegalSection heading="8. Security, honestly">
                <p>
                    Team separation and access rules are enforced in the database. Passwords are
                    handled by Supabase Auth and we never see them. Traffic is encrypted in transit.
                </p>
                <p>
                    We do not claim to be invulnerable. If we discover a breach affecting your
                    team&apos;s data, we will tell you what happened and what we are doing about it
                    rather than issuing a statement about how seriously we take security.
                </p>
            </LegalSection>

            <LegalSection heading="9. Changes">
                <p>
                    If we change this policy in a way that affects what you agreed to, we raise its
                    version and ask you to accept it again. We keep a record of each version you
                    accepted and when.
                </p>
            </LegalSection>
        </LegalPage>
    );
}
