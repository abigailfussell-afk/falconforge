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
const mockUpdateEmail = vi.fn();
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
        updateEmail: mockUpdateEmail,
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

/*
 * CHANGING YOUR EMAIL ADDRESS.
 *
 * This screen edited a name and an age classification and nothing else, so an address change
 * meant asking Kevin. It matters most for a GUARDIAN: a managed child has no login of their own,
 * so the guardian's address is the only contactable one the team holds for that child, and
 * SEC-16 had already made the server carry a change onto every child's roster row — the
 * capability was complete and unreachable.
 *
 * THE THING THESE TESTS PROTECT IS THE COPY as much as the call. GoTrue swaps the address only
 * when the emailed link is followed, so a screen that says "Saved" is lying at the exact moment
 * a typo is still recoverable.
 */
describe('EditProfile — email address', () => {
    it('shows the current address and offers to change it', () => {
        renderProfile();

        expect(screen.getByTestId('email-change').textContent).toContain('nell@example.test');
        expect(screen.getByTestId('edit-email')).toBeTruthy();
    });

    it('sends a confirmation and says WHERE, without claiming the change happened', async () => {
        mockUpdateEmail.mockResolvedValue({ error: null, pending: 'new@example.test' });
        renderProfile();

        fireEvent.click(screen.getByTestId('edit-email'));
        fireEvent.change(screen.getByTestId('new-email-input'), {
            target: { value: 'new@example.test' },
        });
        fireEvent.click(screen.getByTestId('save-email'));

        await waitFor(() => expect(mockUpdateEmail).toHaveBeenCalledWith('new@example.test'));

        const message = await screen.findByTestId('email-message');
        // Names the destination: "check your email" is useless to somebody who just typed the
        // wrong address, and this is the last moment they can notice.
        expect(message.textContent).toContain('new@example.test');
        // And does NOT claim it is done — the old address is still the account's.
        expect(message.textContent).toContain('nell@example.test');
        expect(message.textContent?.toLowerCase()).not.toContain('saved');
    });

    it('refuses an address that is not an address, before calling the server', async () => {
        renderProfile();

        fireEvent.click(screen.getByTestId('edit-email'));
        fireEvent.change(screen.getByTestId('new-email-input'), { target: { value: 'nope' } });
        fireEvent.click(screen.getByTestId('save-email'));

        expect((await screen.findByTestId('email-message')).textContent).toContain(
            'does not look like an email address',
        );
        expect(mockUpdateEmail).not.toHaveBeenCalled();
    });

    it('refuses the address the account already has, case-insensitively', async () => {
        // Not pedantry: GoTrue accepts this and emails a confirmation for a change to nothing,
        // which reads as a broken feature.
        renderProfile();

        fireEvent.click(screen.getByTestId('edit-email'));
        fireEvent.change(screen.getByTestId('new-email-input'), {
            target: { value: 'NELL@example.test' },
        });
        fireEvent.click(screen.getByTestId('save-email'));

        expect((await screen.findByTestId('email-message')).textContent).toContain(
            'already your email address',
        );
        expect(mockUpdateEmail).not.toHaveBeenCalled();
    });

    it('surfaces the server’s own refusal rather than a generic one', async () => {
        // "Email address already registered" is the case a real user hits, and it is actionable
        // only if they are told which one it was.
        mockUpdateEmail.mockResolvedValue({
            error: { message: 'A user with this email address has already been registered' },
            pending: null,
        });
        renderProfile();

        fireEvent.click(screen.getByTestId('edit-email'));
        fireEvent.change(screen.getByTestId('new-email-input'), {
            target: { value: 'taken@example.test' },
        });
        fireEvent.click(screen.getByTestId('save-email'));

        expect((await screen.findByTestId('email-message')).textContent).toContain(
            'already been registered',
        );
    });

    it('cannot be started offline, and says why rather than failing on tap', () => {
        /*
         * This is the one control on this screen that CANNOT be queued. Everything else in the
         * app is offline-first, so a disabled button with no reason reads as a bug — the exact
         * shape Sprint 5.5 fixed elsewhere.
         */
        renderProfile({ isOffline: true });

        const button = screen.getByTestId('edit-email') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe('Changing your email needs a connection');
    });
});
