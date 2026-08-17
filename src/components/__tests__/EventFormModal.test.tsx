/**
 * Sprint 8 — the check-in window the create/edit form offers.
 *
 * KEVIN'S BUG, PINNED. He opened the form at 7:28pm, set the meeting to 3–5pm, ticked "set the
 * check-in window by hand", and was offered 7:45pm–10:00pm — the default for a meeting he was
 * no longer creating. The two fields were seeded once at mount from "the next round hour" and
 * never looked at the times again.
 *
 * The rule they should follow is the one the column follows and the one the help text under
 * the checkbox promises: the window is DERIVED from the start and end until somebody
 * deliberately types over it. So these tests are about what the fields show after the times
 * change, which is the thing that was wrong — not about what a fresh form shows, which was
 * right by accident.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import EventFormModal from '../meetings/EventFormModal';
import { useAppStore } from '@/lib/store';
import type { Meeting } from '@/types';

const TEAM = 'team-1';
const S1 = 'season-1';

beforeEach(() => {
    useAppStore.setState({
        currentTeamId: TEAM,
        currentSeasonId: S1,
        currentUserId: 'user-1',
        teamMembers: [],
        meetings: [],
        meetingAttendance: [],
        seasons: [
            { id: S1, name: '2026-2027', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 0 },
        ],
    });
});

function openForm(meeting: Meeting | null = null) {
    return render(
        <MemoryRouter>
            <EventFormModal meeting={meeting} onClose={() => {}} />
        </MemoryRouter>,
    );
}

/** Set the date/start/end the way a coach does, then reveal the window fields. */
function setTimes({ start, end }: { start: string; end: string }) {
    fireEvent.change(screen.getByTestId('event-date'), { target: { value: '2026-08-20' } });
    fireEvent.change(screen.getByTestId('event-start'), { target: { value: start } });
    fireEvent.change(screen.getByTestId('event-end'), { target: { value: end } });
    fireEvent.click(screen.getByLabelText(/set the check-in window by hand/i));
}

describe('the check-in window the form offers', () => {
    it('derives from the times the coach actually picked, not from when the form opened', () => {
        /*
         * The reported bug, exactly. The form is opened at 7:28pm — so anything seeded from
         * "the next round hour" would offer 7:45pm–10:00pm — and the meeting is then set to
         * 3–5pm. The window must follow the meeting.
         */
        vi.setSystemTime(new Date(2026, 7, 20, 19, 28));
        openForm();

        setTimes({ start: '15:00', end: '17:00' });

        expect(screen.getByTestId('checkin-opens')).toHaveValue('14:45');
        expect(screen.getByTestId('checkin-closes')).toHaveValue('17:00');
    });

    it('keeps following the times when they change again', () => {
        vi.setSystemTime(new Date(2026, 7, 20, 19, 28));
        openForm();
        setTimes({ start: '15:00', end: '17:00' });

        fireEvent.change(screen.getByTestId('event-start'), { target: { value: '18:00' } });
        fireEvent.change(screen.getByTestId('event-end'), { target: { value: '20:30' } });

        expect(screen.getByTestId('checkin-opens')).toHaveValue('17:45');
        expect(screen.getByTestId('checkin-closes')).toHaveValue('20:30');
    });

    it('stops following once the coach types a window of their own', () => {
        // The other half of the rule. An override is an override — moving the meeting must not
        // silently undo a deliberate edit.
        vi.setSystemTime(new Date(2026, 7, 20, 19, 28));
        openForm();
        setTimes({ start: '15:00', end: '17:00' });

        fireEvent.change(screen.getByTestId('checkin-opens'), { target: { value: '14:00' } });
        fireEvent.change(screen.getByTestId('event-start'), { target: { value: '16:00' } });

        expect(screen.getByTestId('checkin-opens')).toHaveValue('14:00');
        // The end was never overridden, so it still follows.
        expect(screen.getByTestId('checkin-closes')).toHaveValue('17:00');
    });

    it('forgets an override when the checkbox is unticked', () => {
        vi.setSystemTime(new Date(2026, 7, 20, 19, 28));
        openForm();
        setTimes({ start: '15:00', end: '17:00' });
        fireEvent.change(screen.getByTestId('checkin-opens'), { target: { value: '13:00' } });

        const checkbox = screen.getByLabelText(/set the check-in window by hand/i);
        fireEvent.click(checkbox); // off — the fields disappear
        fireEvent.click(checkbox); // on again

        // Re-ticking offers the derived window rather than resurrecting a discarded edit.
        expect(screen.getByTestId('checkin-opens')).toHaveValue('14:45');
    });

    it('falls back to four hours after the start when there is no end time', () => {
        vi.setSystemTime(new Date(2026, 7, 20, 19, 28));
        openForm();
        fireEvent.change(screen.getByTestId('event-date'), { target: { value: '2026-08-20' } });
        fireEvent.change(screen.getByTestId('event-start'), { target: { value: '09:00' } });
        fireEvent.change(screen.getByTestId('event-end'), { target: { value: '' } });
        fireEvent.click(screen.getByLabelText(/set the check-in window by hand/i));

        expect(screen.getByTestId('checkin-opens')).toHaveValue('08:45');
        expect(screen.getByTestId('checkin-closes')).toHaveValue('13:00');
    });
});

describe('editing an event that already has an explicit window', () => {
    const meeting: Meeting = {
        id: 'm1',
        title: 'Build session',
        description: '',
        location: '',
        eventType: 'build',
        publicCode: '0842',
        attendanceRequired: true,
        startsAt: new Date(2026, 7, 20, 18, 0).getTime(),
        endsAt: new Date(2026, 7, 20, 20, 30).getTime(),
        // An hour before the start, rather than the default fifteen minutes.
        checkinOpensAt: new Date(2026, 7, 20, 17, 0).getTime(),
        recurrenceRule: '',
        seriesId: '',
        createdBy: '',
        seasonId: S1,
    };

    it('shows the saved override rather than re-deriving over it', () => {
        openForm(meeting);
        expect(screen.getByTestId('checkin-opens')).toHaveValue('17:00');
    });

    it('derives the end of the window, which was never overridden', () => {
        openForm(meeting);
        expect(screen.getByTestId('checkin-closes')).toHaveValue('20:30');
    });
});
