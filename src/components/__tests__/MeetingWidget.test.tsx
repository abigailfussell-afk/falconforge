/**
 * Sprint 8 — the dashboard's meetings card.
 *
 * Two things worth pinning, and both were found rather than anticipated:
 *
 *   1. It must not take the dashboard down when there is no shell context. Rendering
 *      `DashboardHome` inside a bare `MemoryRouter` — which its own test file does — makes
 *      `useOutletContext()` null, and destructuring that threw a TypeError that unmounted the
 *      whole page. A card is an insert; it does not get to break the screen it decorates.
 *   2. It renders NOTHING when the team has no upcoming event. Sprint 7 found the Upcoming
 *      Deadlines panel vanishing when empty and restoring the dead space it had been added to
 *      fill — but that panel is a fixture of the dashboard and this is an insert, so the
 *      opposite answer is the right one here. A team that does not use meetings should not be
 *      shown an empty box about them every morning.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import MeetingWidget from '../meetings/MeetingWidget';
import type { AppShellContext } from '../AppShell';
import { useAppStore } from '@/lib/store';
import type { Meeting, TeamMember } from '@/types';

const TEAM = 'team-1';
const S1 = 'season-1';

const member: TeamMember = {
    id: 'member-1',
    teamId: TEAM,
    userId: 'user-1',
    role: 'student',
    status: 'approved',
    seatAssigned: true,
    fullName: 'Ava Restrepo',
    email: 'ava@example.com',
    avatarUrl: null,
    joinedAt: 0,
};

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
    id: 'm1',
    title: 'Build session — chassis rebuild',
    description: '',
    location: 'Room 214',
    eventType: 'build',
    publicCode: '0842',
    attendanceRequired: true,
    startsAt: Date.now() + 60 * 60_000,
    endsAt: Date.now() + 3 * 60 * 60_000,
    recurrenceRule: '',
    seriesId: '',
    createdBy: 'member-1',
    seasonId: S1,
    ...over,
});

/** Render inside a real outlet, the way the dashboard does. */
function renderInShell(context: Partial<AppShellContext>) {
    const full: AppShellContext = {
        teamMembers: [member],
        subTeams: [],
        canManageTeam: false,
        canManageMeetings: false,
        currentMember: member,
        isOperator: false,
        ...context,
    };

    return render(
        <MemoryRouter>
            <Routes>
                <Route path="/" element={<Outlet context={full} />}>
                    <Route index element={<MeetingWidget />} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    useAppStore.setState({
        currentTeamId: TEAM,
        currentSeasonId: S1,
        currentUserId: 'user-1',
        teamMembers: [member],
        meetings: [],
        meetingAttendance: [],
        seasons: [
            { id: S1, name: '2026-2027', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 0 },
        ],
    });
});

describe('outside a shell', () => {
    it('renders nothing rather than throwing', () => {
        useAppStore.setState({ meetings: [meeting()] });

        // No Route, so no outlet context — exactly the shape `DashboardHome.test.tsx` renders.
        const { container } = render(
            <MemoryRouter>
                <MeetingWidget />
            </MemoryRouter>,
        );

        expect(container).toBeEmptyDOMElement();
    });
});

describe('with nothing scheduled', () => {
    it('renders nothing at all', () => {
        const { container } = renderInShell({ canManageMeetings: true });
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when every event has already finished', () => {
        useAppStore.setState({
            meetings: [meeting({ startsAt: Date.now() - 3 * 60 * 60_000, endsAt: Date.now() - 60_000 })],
        });
        const { container } = renderInShell({ canManageMeetings: true });
        expect(container).toBeEmptyDOMElement();
    });
});

describe('the coach card', () => {
    it('counts what has been recorded against the size of the roster', () => {
        useAppStore.setState({
            meetings: [meeting({ startsAt: Date.now() - 60_000 })],
            meetingAttendance: [
                {
                    id: 'a1',
                    meetingId: 'm1',
                    teamMemberId: 'member-1',
                    status: 'present',
                    method: 'qr',
                    notes: '',
                    attestedBy: 'member-1',
                    attestedAt: Date.now(),
                },
            ],
        });

        renderInShell({ canManageMeetings: true });

        expect(screen.getByText('Happening now')).toBeInTheDocument();
        expect(screen.getByText('Check-in open')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('of 1 recorded')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /show qr/i })).toHaveAttribute(
            'href',
            '/app/meetings/m1',
        );
    });

    it('says "next meeting" rather than "happening now" before it starts', () => {
        useAppStore.setState({ meetings: [meeting()] });
        renderInShell({ canManageMeetings: true });

        expect(screen.getByText('Next meeting')).toBeInTheDocument();
        expect(screen.queryByText('Check-in open')).not.toBeInTheDocument();
    });
});

describe('the student card', () => {
    it('offers check-in only while the window is open, WITHOUT handing over the code', () => {
        /*
         * The link used to be `/app/checkin/0842` — the app giving the student the credential
         * and then asking them to confirm it, so one tap marked them present from anywhere.
         * That makes the QR poster decorative and the check-in window meaningless. Kevin found
         * it testing with a friend.
         *
         * The destination is the code-entry screen with an EMPTY field. The only route that
         * carries a code is the one a scan produces, which arrives from outside the app.
         */
        useAppStore.setState({ meetings: [meeting({ startsAt: Date.now() - 60_000 })] });
        renderInShell({});

        const link = screen.getByRole('link', { name: /enter code to check in/i });
        expect(link).toHaveAttribute('href', '/app/checkin');
        expect(link.getAttribute('href')).not.toMatch(/\d{4}/);
    });

    it('says when to come back rather than showing a dead button', () => {
        // A disabled control that does nothing teaches students the button lies, and they
        // stop trusting it at the moment it matters.
        useAppStore.setState({ meetings: [meeting({ startsAt: Date.now() + 6 * 60 * 60_000 })] });
        renderInShell({});

        expect(screen.queryByRole('link', { name: /enter code/i })).not.toBeInTheDocument();
        expect(screen.getByText(/check in from/i)).toBeInTheDocument();
    });

    it('offers no check-in for an event that does not take attendance', () => {
        useAppStore.setState({
            meetings: [
                meeting({
                    eventType: 'deadline',
                    publicCode: '',
                    attendanceRequired: false,
                    startsAt: Date.now() - 60_000,
                }),
            ],
        });
        renderInShell({});

        expect(screen.queryByRole('link', { name: /check in/i })).not.toBeInTheDocument();
    });
});
