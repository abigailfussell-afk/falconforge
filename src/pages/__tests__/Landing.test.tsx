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
        expect(screen.getByText(/The ultimate agile engineering solution for your robotics team/i)).toBeInTheDocument();
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
