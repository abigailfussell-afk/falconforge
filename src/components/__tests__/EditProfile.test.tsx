/**
 * The one place a person can correct an age the app has no way of recomputing.
 *
 * `users.age_classification` is asserted once at signup and there is no birth date anywhere
 * (plan section 3 — deliberately), so a 17-year-old who turns 18 stays `13_to_17` for ever, and
 * that column gates the admin, coach AND mentor roles through `enforce_member_role_eligibility`.
 * Until this control existed the value had readers and no writer after signup: failure-modes
 * section 7, and the reason Sprint 6's under-18 nomination refusal landed on the student.
 *
 * The tests that matter are the ones about NOT raising it: a value that gates three privileged
 * roles must not move on a stray click, and must not move at all if the record of who asserted
 * what failed to write.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EditProfile from '../EditProfile';

const mockAuth = vi.fn();
const mockRecord = vi.fn();
const mockUpdateAge = vi.fn();
const calls: string[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => mockAuth() }));
vi.mock('@/lib/attestations', async () => {
    const actual = await vi.importActual<typeof import('@/lib/attestations')>('@/lib/attestations');
    return { ...actual, recordAttestation: (...args: unknown[]) => mockRecord(...args) };
});

function auth(overrides: Record<string, unknown> = {}) {
    return {
        user: { id: 'user-1', email: 'nell@example.test', user_metadata: { full_name: 'Nell' } },
        isConfigured: true,
        isOffline: false,
        ageClassification: '13_to_17',
        updateProfile: vi.fn().mockResolvedValue({ error: null }),
        updateAgeClassification: mockUpdateAge,
        ...overrides,
    };
}

function renderProfile(overrides: Record<string, unknown> = {}) {
    mockAuth.mockReturnValue(auth(overrides));
    return render(
        <MemoryRouter>
            <EditProfile />
        </MemoryRouter>,
    );
}

/** Tick the confirmation and press the button, which is the only way through. */
async function confirm() {
    fireEvent.click(screen.getByRole('button', { name: /i've turned 18/i }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /i confirm i am now 18 or over/i }));
    // Both writes are awaited inside the handler, so the state updates land after the click
    // returns — `act` is what makes those part of this step rather than a later test's noise.
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    mockRecord.mockImplementation(async () => { calls.push('attestation'); return { success: true }; });
    mockUpdateAge.mockImplementation(async () => { calls.push('classification'); return { success: true, error: null }; });
});

describe('who is offered it', () => {
    it('offers the correction to a 13-to-17 account', () => {
        renderProfile();
        expect(screen.getByRole('button', { name: /i've turned 18/i })).toBeDefined();
    });

    it('does not offer it to an account already recorded as 18+', () => {
        // Nothing to correct, and an "are you 18?" control on an 18+ account is a control that
        // can only ever be pressed by mistake.
        renderProfile({ ageClassification: '18_plus' });
        expect(screen.queryByRole('button', { name: /i've turned 18/i })).toBeNull();
    });

    it('does not offer it to an under-13 account', () => {
        // Turning 13 is not the transition this control is for, and an under-13 raising
        // themselves to 18+ in one press is the exact thing COPPA is about.
        renderProfile({ ageClassification: 'under_13' });
        expect(screen.queryByRole('button', { name: /i've turned 18/i })).toBeNull();
    });
});

describe('raising it', () => {
    it('will not act on the button alone', async () => {
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: /i've turned 18/i }));

        const go = await screen.findByRole('button', { name: /^confirm$/i });
        expect((go as HTMLButtonElement).disabled).toBe(true);
        expect(mockUpdateAge).not.toHaveBeenCalled();
    });

    it('records the assertion BEFORE it changes the value it gates', async () => {
        renderProfile();
        await confirm();

        await waitFor(() => expect(mockUpdateAge).toHaveBeenCalledWith('18_plus'));
        expect(mockRecord).toHaveBeenCalledWith('age_18_plus');
        expect(calls).toEqual(['attestation', 'classification']);
    });

    it('leaves the value alone when the assertion cannot be recorded', async () => {
        // The attestation IS the record of who said this and when. Raising the column without
        // it would leave an 18+ account nobody ever claimed to be 18.
        mockRecord.mockResolvedValue({ success: false, error: 'network is down' });
        renderProfile();
        await confirm();

        expect(await screen.findByRole('alert')).toHaveTextContent(/network is down/i);
        expect(mockUpdateAge).not.toHaveBeenCalled();
    });

    it('surfaces a refusal from the update itself', async () => {
        mockUpdateAge.mockResolvedValue({ success: false, error: { message: 'Invalid age classification' } });
        renderProfile();
        await confirm();

        expect(await screen.findByRole('alert')).toHaveTextContent(/invalid age classification/i);
    });

    it('says what changed rather than falling silent', async () => {
        renderProfile();
        await confirm();

        expect(await screen.findByText(/recorded as 18 or over/i)).toBeDefined();
    });

    it('cannot be pressed offline', () => {
        // Both writes are server-side: there is no queue entry for an identity fact.
        renderProfile({ isOffline: true });
        const button = screen.getByRole('button', { name: /i've turned 18/i }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
    });
});
