/**
 * The legal documents.
 *
 * `src/pages/legal` was 0% covered across all three files before this sprint. The point of
 * covering them is not the line count — it is that these pages make specific promises the product
 * has to keep, and a later edit that quietly drops one should fail rather than ship. The
 * assertions below are therefore about CLAIMS, not markup.
 *
 * The version assertion is the load-bearing one: the documents read their version from
 * `ATTESTATION_VERSIONS`, which is the same constant that decides whether somebody must re-accept.
 * A page stating its own version could say 2.0 while the app still accepted 1.0, and both numbers
 * would look right on their own.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TermsAndConditions from '../TermsAndConditions';
import PrivacyPolicy from '../PrivacyPolicy';
import CommunityGuidelines from '../CommunityGuidelines';
import { ATTESTATION_VERSIONS } from '@/lib/attestations';

function renderPage(element: React.ReactElement) {
    return render(<MemoryRouter>{element}</MemoryRouter>);
}

describe('every legal document', () => {
    const pages = [
        { name: 'terms', element: <TermsAndConditions />, attestation: 'terms' as const },
        { name: 'privacy', element: <PrivacyPolicy />, attestation: 'privacy' as const },
        {
            name: 'acceptable use',
            element: <CommunityGuidelines />,
            attestation: 'community_guidelines' as const,
        },
    ];

    it.each(pages)('$name is marked as pending legal review', ({ element }) => {
        // The brief asks for drafts to be marked. A beta coach relying on these is entitled to
        // know they have not been near a lawyer.
        renderPage(element);
        expect(screen.getByTestId('pending-legal-review').textContent).toMatch(
            /pending legal review/i,
        );
    });

    it.each(pages)('$name shows the version the app actually enforces', ({ element, attestation }) => {
        renderPage(element);
        expect(screen.getByTestId('legal-version').textContent).toContain(
            `Version ${ATTESTATION_VERSIONS[attestation]}`,
        );
    });

    it.each(pages)('$name explains that a new version means re-accepting', ({ element }) => {
        renderPage(element);
        expect(document.body.textContent).toMatch(/accept it again/i);
    });

    it.each(pages)('$name links to the other two', ({ element }) => {
        renderPage(element);
        const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
        expect(hrefs).toContain('/legal/terms');
        expect(hrefs).toContain('/legal/privacy');
        expect(hrefs).toContain('/legal/community');
    });
});

describe('the Terms say the things the sprint required them to say', () => {
    /*
     * Each of these is a promise the product must keep, or an absence of one it must not
     * accidentally acquire. A rewrite that drops any of them should fail here.
     */
    it('disclaims any uptime guarantee, in plain words', () => {
        renderPage(<TermsAndConditions />);
        expect(document.body.textContent).toMatch(/no guarantee of availability/i);
    });

    it('reserves the right to discontinue the service at any time', () => {
        renderPage(<TermsAndConditions />);
        expect(document.body.textContent).toMatch(/discontinued.*at any time/is);
    });

    it('states that refunds are discretionary rather than promising a policy', () => {
        renderPage(<TermsAndConditions />);
        expect(document.body.textContent).toMatch(/refunds are at our discretion/i);
    });

    /*
     * THE PROMISE THE WHOLE LICENSING MODEL RESTS ON. "Expiry is a read-only grace mode, never
     * data deletion" is a locked decision in the plan, the reason `team_can_write` gates writes
     * and not reads, and the reassurance the lapsed banner repeats. If the Terms ever stopped
     * saying it, the product and its contract would have drifted apart.
     */
    it('promises that a lapsed licence never deletes anything', () => {
        renderPage(<TermsAndConditions />);
        expect(document.body.textContent).toMatch(/the team becomes read-only\. nothing is deleted/i);
    });

    it('explains that a seat is used per approved member, admin included', () => {
        renderPage(<TermsAndConditions />);
        expect(document.body.textContent).toMatch(/each approved member of the team, including the admin/i);
    });

    it('explains that reducing the seat count is allowed and costs nobody their access', () => {
        renderPage(<TermsAndConditions />);
        expect(document.body.textContent).toMatch(/reducing your seat count is always allowed/i);
        expect(document.body.textContent).toMatch(/nobody loses access/i);
    });

    it('names the handover route, and the fallback when the admin has already left', () => {
        renderPage(<TermsAndConditions />);
        expect(document.body.textContent).toMatch(/hand the role over/i);
        expect(document.body.textContent).toMatch(/contact us and we can reassign it/i);
    });

    it('requires 18+ to administer a team and 13+ to hold an account', () => {
        renderPage(<TermsAndConditions />);
        expect(document.body.textContent).toMatch(/must be 13 or older to hold your own account/i);
        expect(document.body.textContent).toMatch(/requires you to be 18 or older/i);
    });
});

describe('the Privacy Policy states the COPPA posture accurately', () => {
    /*
     * This has to match the SCHEMA, not just sound reassuring. A child under 13 has no row in
     * `auth.users` at all; their membership is a `team_members` row whose `user_id` is the
     * guardian and whose `managed_profile_id` points at the child. A parent relies on this claim.
     */
    it('says an under-13 has no account and cannot create one', () => {
        renderPage(<PrivacyPolicy />);
        expect(document.body.textContent).toMatch(
            /a member under 13 does not have a falconforge account and cannot create one/i,
        );
    });

    it('describes the guardian-held managed profile', () => {
        renderPage(<PrivacyPolicy />);
        expect(document.body.textContent).toMatch(/managed profile/i);
        expect(document.body.textContent).toMatch(/the guardian signs in; the child does not/i);
    });

    it('is honest that consent cannot be independently verified', () => {
        renderPage(<PrivacyPolicy />);
        expect(document.body.textContent).toMatch(/cannot independently verify/i);
    });

    it('collects an age bracket rather than a date of birth', () => {
        renderPage(<PrivacyPolicy />);
        expect(document.body.textContent).toMatch(/not a date of birth/i);
    });

    it('promises never to sell personal information or train models on team data', () => {
        renderPage(<PrivacyPolicy />);
        expect(document.body.textContent).toMatch(/do not sell personal information/i);
        expect(document.body.textContent).toMatch(/do not use your team's data to train/i);
    });

    it('repeats that a lapsed licence deletes nothing', () => {
        renderPage(<PrivacyPolicy />);
        expect(document.body.textContent).toMatch(/a lapsed licence never deletes anything/i);
    });

    it('gives a guardian the right to see, correct or delete their child\'s data', () => {
        renderPage(<PrivacyPolicy />);
        expect(document.body.textContent).toMatch(/correct, or delete everything associated with/i);
    });
});

describe('Acceptable Use is enforceable rather than advisory', () => {
    it('is titled Acceptable Use and forms part of the Terms', () => {
        renderPage(<CommunityGuidelines />);
        expect(screen.getByRole('heading', { name: /acceptable use/i, level: 1 })).toBeDefined();
        expect(document.body.textContent).toMatch(/forms part of the terms/i);
    });

    it('says what happens when it is broken', () => {
        renderPage(<CommunityGuidelines />);
        expect(document.body.textContent).toMatch(/remove content, remove a member/i);
    });

    it('invites vulnerability reports rather than threatening them', () => {
        // A student who finds a cross-tenant hole should tell us. Threatening them guarantees
        // they will not.
        renderPage(<CommunityGuidelines />);
        expect(document.body.textContent).toMatch(/we will thank you rather than pursue you/i);
    });

    it('tells a young person at risk to contact emergency services first', () => {
        renderPage(<CommunityGuidelines />);
        expect(document.body.textContent).toMatch(/emergency services first/i);
    });

    it('forbids sharing one account between several people', () => {
        renderPage(<CommunityGuidelines />);
        expect(document.body.textContent).toMatch(/do not use one account for several people/i);
    });
});
