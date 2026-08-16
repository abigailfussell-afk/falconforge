import { Users } from 'lucide-react';
import LegalPage, { LegalSection } from './LegalPage';

/**
 * Acceptable use.
 *
 * The sprint brief asks for "acceptable use" rather than "community guidelines", and the
 * difference is not cosmetic: guidelines suggest, a policy is enforceable and is referenced by the
 * Terms. The route stays `/legal/community` because it is linked from existing attestations and
 * from `privacy_and_guidelines`, which every account has already accepted.
 */
export default function CommunityGuidelines() {
    return (
        <LegalPage
            title="Acceptable Use"
            icon={Users}
            attestation="community_guidelines"
            effective="16 August 2026"
        >
            <p className="mb-6 text-sm text-slate-300">
                FalconForge is a workspace shared by students, mentors and coaches, most of them
                minors. The standard is simple: behave as you would in a school robotics workshop
                with your coach standing next to you. This policy forms part of the Terms.
            </p>

            <LegalSection heading="1. Treat people well">
                <ul className="list-inside list-disc space-y-1">
                    <li>
                        No harassment, bullying, threats, or targeting anyone — including opposing
                        teams. Scouting notes are about robots and strategy, not about people.
                    </li>
                    <li>
                        No discriminatory or hateful content of any kind.
                    </li>
                    <li>
                        No sexual content. This is used by children; there is no version of this that
                        is acceptable.
                    </li>
                    <li>
                        Disagree about strategy as much as you like. Do it about the strategy.
                    </li>
                </ul>
            </LegalSection>

            <LegalSection heading="2. Look after each other's information">
                <ul className="list-inside list-disc space-y-1">
                    <li>
                        Do not share another member&apos;s personal details outside the team,
                        especially a minor&apos;s.
                    </li>
                    <li>
                        Do not post photographs of minors without the consent of their parent or
                        guardian.
                    </li>
                    <li>
                        Invite codes are keys to your team. Share them with your team, not publicly.
                    </li>
                    <li>
                        Do not use one account for several people. Everyone who works on the team gets
                        their own membership — that is what the seats are for.
                    </li>
                </ul>
            </LegalSection>

            <LegalSection heading="3. Compete honestly">
                <ul className="list-inside list-disc space-y-1">
                    <li>
                        Record scouting observations honestly. Do not fabricate data about another
                        team.
                    </li>
                    <li>
                        Do not attempt to access another team&apos;s data. If you find a way to, tell
                        us — we will thank you rather than pursue you.
                    </li>
                    <li>
                        Follow <em>FIRST</em>&apos;s own rules and Gracious Professionalism. Nothing
                        here overrides them.
                    </li>
                </ul>
            </LegalSection>

            <LegalSection heading="4. Do not break the Service">
                <ul className="list-inside list-disc space-y-1">
                    <li>
                        No attempts to bypass access controls, licensing, or seat limits.
                    </li>
                    <li>
                        No automated scraping or load that would degrade the Service for other teams.
                    </li>
                    <li>
                        No uploading malware, or using FalconForge to store content unrelated to your
                        robotics team.
                    </li>
                </ul>
            </LegalSection>

            <LegalSection heading="5. If something is wrong, tell us">
                <p>
                    If you see behaviour that breaches this policy — particularly anything involving
                    the safety of a young person — contact us directly. You do not need your
                    coach&apos;s permission to do that, and we will not tell them you did unless you
                    want us to.
                </p>
                <p>
                    If a young person is in immediate danger, contact your local emergency services
                    first. We are one person with a database; they can actually help.
                </p>
            </LegalSection>

            <LegalSection heading="6. What happens if this policy is broken">
                <p>
                    Depending on what happened, we may remove content, remove a member from a team,
                    suspend an account, or remove a team. Where it is safe and practical, we will
                    explain why and give you a chance to respond first. Where a young person may be
                    at risk, we will act first and explain afterwards.
                </p>
                <p>
                    The team admin is responsible for their team&apos;s conduct on FalconForge, which
                    is one of the things they accept when they take the role on.
                </p>
            </LegalSection>
        </LegalPage>
    );
}
