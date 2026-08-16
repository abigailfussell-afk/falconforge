/**
 * Re-accepting a document whose version has moved.
 *
 * Bumping `ATTESTATION_VERSIONS` is only half of "versioned attestations re-required on change" —
 * without something that asks, the constant is a comment. The tests that matter here are the ones
 * about NOT asking: a nag that reappears on a flaky connection, or a dialog that traps a coach at
 * a competition, is worse than a stale acceptance.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReAttestationPrompt from '../ReAttestationPrompt';

const mockAuth = vi.fn();
const mockOutdated = vi.fn();
const mockRecord = vi.fn();

vi.mock('@/lib/auth', () => ({ useAuth: () => mockAuth() }));
vi.mock('@/lib/attestations', async () => {
    const actual = await vi.importActual<typeof import('@/lib/attestations')>('@/lib/attestations');
    return {
        ...actual,
        getOutdatedAttestations: (...args: unknown[]) => mockOutdated(...args),
        recordAttestation: (...args: unknown[]) => mockRecord(...args),
    };
});

function renderPrompt() {
    return render(
        <MemoryRouter>
            <ReAttestationPrompt />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockReturnValue({ user: { id: 'user-1' }, isOffline: false });
    mockOutdated.mockResolvedValue([]);
    mockRecord.mockResolvedValue({ success: true });
});

describe('asking', () => {
    it('asks when a document version has moved', async () => {
        mockOutdated.mockResolvedValue(['privacy_and_guidelines']);
        renderPrompt();

        expect(await screen.findByRole('dialog')).toBeDefined();
        expect(screen.getByText(/updated our legal documents/i)).toBeDefined();
    });

    it('links to the document rather than summarising it away', async () => {
        mockOutdated.mockResolvedValue(['privacy_and_guidelines']);
        renderPrompt();

        const link = await screen.findByRole('link', { name: /privacy policy and acceptable use/i });
        expect(link.getAttribute('href')).toBe('/legal/privacy');
    });

    it('says what actually changed', async () => {
        // "We updated our terms" with no detail teaches people to click through without reading.
        mockOutdated.mockResolvedValue(['privacy_and_guidelines']);
        renderPrompt();

        expect(await screen.findByText(/no uptime guarantee/i)).toBeDefined();
    });

    it('records every outdated document on acceptance', async () => {
        mockOutdated.mockResolvedValue(['privacy_and_guidelines', 'terms']);
        renderPrompt();

        fireEvent.click(await screen.findByRole('button', { name: /read and accept/i }));

        await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(2));
        expect(mockRecord).toHaveBeenCalledWith('privacy_and_guidelines');
        expect(mockRecord).toHaveBeenCalledWith('terms');
    });

    it('closes once accepted', async () => {
        mockOutdated.mockResolvedValue(['privacy_and_guidelines']);
        renderPrompt();

        fireEvent.click(await screen.findByRole('button', { name: /read and accept/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('keeps the dialog open and says so when recording fails', async () => {
        mockOutdated.mockResolvedValue(['privacy_and_guidelines']);
        mockRecord.mockResolvedValue({ success: false, error: 'Network unreachable' });
        renderPrompt();

        fireEvent.click(await screen.findByRole('button', { name: /read and accept/i }));

        expect(await screen.findByRole('alert')).toBeDefined();
        expect(screen.getByRole('dialog')).toBeDefined();
    });
});

describe('not asking', () => {
    it('says nothing when every acceptance is current', async () => {
        mockOutdated.mockResolvedValue([]);
        renderPrompt();

        await waitFor(() => expect(mockOutdated).toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not ask an offline device', async () => {
        // No network, no question. Anything else is a dialog nobody can dismiss by complying.
        mockAuth.mockReturnValue({ user: { id: 'user-1' }, isOffline: true });
        renderPrompt();

        await waitFor(() => expect(mockOutdated).not.toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not ask when nobody is signed in', async () => {
        mockAuth.mockReturnValue({ user: null, isOffline: false });
        renderPrompt();

        await waitFor(() => expect(mockOutdated).not.toHaveBeenCalled());
    });

    /*
     * "Later" is deliberately a real escape hatch. The user has already accepted a PREVIOUS
     * version, so they are out of date rather than unlicensed — and locking a coach out of their
     * team's data mid-competition over a reworded ToS would be the wrong trade by a wide margin.
     */
    it('lets the user defer, and does not reappear in the same session', async () => {
        mockOutdated.mockResolvedValue(['privacy_and_guidelines']);
        renderPrompt();

        fireEvent.click(await screen.findByRole('button', { name: /later/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(mockRecord).not.toHaveBeenCalled();
    });
});
