import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '../Landing';

// Mock the router navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// Mock environment variables
vi.stubEnv('BASE_URL', '/');

describe('LandingPage', () => {
    it('renders the main hero content', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        expect(screen.getByText(/FORGE IT/i)).toBeInTheDocument();
        // LAND-02: the program is named above the fold, not only in the meta description.
        expect(screen.getAllByText(/Tech Challenge/i).length).toBeGreaterThan(0);
    });

    /*
     * LAND-01 — the hero's two calls to action are LINKS.
     *
     * They were `<button onClick={navigate}>`, which cannot be middle-clicked, opened in a new
     * tab, or copied into the Discord thread this page will be posted to — and is invisible to
     * anything counting the page's outbound links, which is how the page reached zero `<a>`
     * elements without anybody noticing.
     *
     * The two cases below this one click the HEADER's buttons (`getAllByText(...)[0]` is the
     * nav, not the hero), so without this the hero CTAs would have no coverage at all.
     */
    it('offers the hero calls to action as real links', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        const start = screen.getByText(/Start Forging Now/i).closest('a');
        expect(start, 'the primary call to action is not a link').not.toBeNull();
        expect(start).toHaveAttribute('href', '#/login?mode=signup');
    });

    it('links to the legal documents and the support address (LAND-01)', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        // The page had ZERO anchors before this, on a product holding minors' data.
        const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
        expect(hrefs).toContain('#/legal/terms');
        expect(hrefs).toContain('#/legal/privacy');
        expect(hrefs).toContain('#/legal/community');
        expect(hrefs.some((h) => h?.startsWith('mailto:'))).toBe(true);
        expect(hrefs.length).toBeGreaterThanOrEqual(5);
    });

    it('says it is not affiliated with FIRST (LAND-01)', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        expect(screen.getByText(/not affiliated with/i)).toBeInTheDocument();
    });

    it('renders the CTA buttons', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        // Check for Log In buttons
        const loginButtons = screen.getAllByText(/Log In/i);
        expect(loginButtons.length).toBeGreaterThan(0);

        // Check for Sign Up CTA
        expect(screen.getByText(/Start Forging Now/i)).toBeInTheDocument();
        expect(screen.getByText(/Sign Up/i)).toBeInTheDocument();
    });

    it('renders feature cards', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        expect(screen.getAllByText(/Sprint Planning/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Pre-Match Checklist/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Scouting Reports/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Match Planner/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Meetings & Attendance/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/^Seasons$/i).length).toBeGreaterThan(0);
    });

    /*
     * Meetings shipped in Sprint 8 and the landing page never mentioned it — the newest and
     * most differentiating feature was the one a visiting coach could not see. Asserted on the
     * section's own copy rather than on the label, because the label appears in the feature
     * grid too and `getAllByText(...).length > 0` above would pass on the card alone.
     */
    it('gives meetings its own feature section, not just a grid card', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        // Exact, not a regex. The first draft of this was /Stop taking roll by hand/i, which
        // still matched after the heading was edited to "...by hand XX" — so the falsification
        // run passed and the assertion was looser than it looked.
        expect(screen.getByText('Stop taking roll by hand')).toBeInTheDocument();
        // The session's own check-in code, the thing the section is actually about.
        expect(screen.getByText('0842')).toBeInTheDocument();
        expect(screen.getAllByText(/Present/i).length).toBeGreaterThan(0);
    });

    it('navigates to login on default Log In click', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        // Click the first Log In button
        const loginButton = screen.getAllByText(/Log In/i)[0];
        loginButton.click();

        expect(mockNavigate).toHaveBeenCalledWith('/login');
    });

    it('navigates to signup mode on Sign Up click', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );

        const signUpButton = screen.getByText(/Sign Up/i);
        signUpButton.click();

        expect(mockNavigate).toHaveBeenCalledWith('/login?mode=signup');
    });
});
