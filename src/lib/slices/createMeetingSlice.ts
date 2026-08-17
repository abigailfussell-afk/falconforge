import type { Meeting, MeetingAttendance, AttendanceStatus } from '../../types';
import { generateId, queueForSync } from '../offline-db';
import { canWriteToSeason } from '../season-rules';
import {
    generatePublicCode,
    expandRecurrence,
    recurrenceRuleFor,
    tracksAttendance,
    type RecurrenceOptions,
} from '../meetings';
import type { SliceCreator } from './types';

/**
 * The schedule, and who was at it.
 *
 * WHAT IS OFFLINE HERE AND WHAT IS NOT
 *
 * Everything in this file is an ordinary queued write: creating a term of build sessions on a
 * laptop with no signal, editing one, cancelling one, and — the important one — a coach
 * taking the roster on a tablet at a venue with dead WiFi. That last one is the offline
 * attendance path, and it is the one that matters at a competition.
 *
 * What is NOT here is a student checking themselves in. That goes through
 * `check_in_with_code`, online, because a check-in is a claim about the present moment and an
 * offline client has no credible account of what the present moment is. The reasoning is in
 * the migration's header; the consequence for this file is that `meetingAttendance` rows
 * created locally are always coach-set.
 */
export interface MeetingSlice {
    meetings: Meeting[];
    meetingAttendance: MeetingAttendance[];

    /**
     * Create an event in the CURRENT season, optionally with a recurrence.
     *
     * Returns the ids it created, first occurrence first, so the caller can navigate to the
     * event it just made rather than guessing which one it is.
     */
    addMeeting: (
        meeting: Omit<Meeting, 'id' | 'seasonId' | 'publicCode' | 'recurrenceRule' | 'seriesId' | 'createdBy'>,
        recurrence?: RecurrenceOptions,
    ) => string[];

    /**
     * Edit an occurrence, or its series.
     *
     * `scope` is the design's three-way prompt. `'occurrence'` FORKS the row out of its
     * series, because an occurrence that no longer matches its siblings is not one of them
     * any more. Neither of the other two ever touches an already-issued code.
     */
    updateMeeting: (
        id: string,
        updates: Partial<Meeting>,
        scope?: 'occurrence' | 'future' | 'series',
    ) => void;

    deleteMeeting: (id: string, scope?: 'occurrence' | 'future' | 'series') => void;

    /**
     * Record or change one member's attendance, as a coach.
     *
     * Always `method: 'coach'`: this is the manual-override path, and a client cannot write
     * 'qr' or 'code' — the RPC is the only thing that may claim a scan happened.
     */
    setAttendance: (
        meetingId: string,
        teamMemberId: string,
        status: AttendanceStatus,
        note?: string,
    ) => void;

    /** Remove a record, returning the member to unrecorded. Not the same as marking absent. */
    clearAttendance: (meetingId: string, teamMemberId: string) => void;

    /** Replace the collections. The read path calls these; they must NOT queue anything. */
    setMeetings: (meetings: Meeting[]) => void;
    setMeetingAttendance: (records: MeetingAttendance[]) => void;
}

export const meetingInitialState = {
    meetings: [] as Meeting[],
    meetingAttendance: [] as MeetingAttendance[],
};

export const createMeetingSlice: SliceCreator<MeetingSlice> = (set, get) => ({
    ...meetingInitialState,

    addMeeting: (data, recurrence) => {
        const state = get();
        if (!state.currentSeasonId) {
            console.warn('[store] addMeeting ignored: no season is selected');
            return [];
        }
        if (!canWriteToSeason(state.seasons, state.currentSeasonId, 'addMeeting')) return [];

        // The FK on `created_by` references team_members(id), not auth.users(id).
        const currentMember = state.teamMembers.find((m) => m.userId === state.currentUserId);

        /*
         * Every code this team has ever used, not just this season's.
         *
         * The unique index is `(team_id, public_code)` with no season in it, so drawing from
         * the current season alone would eventually collide with a code retired two years
         * ago. The read path pulls whole tables rather than the current season, so this set
         * is genuinely complete rather than a recent window.
         */
        const teamMeetings = state.meetings;
        const taken = new Set(teamMeetings.map((m) => m.publicCode).filter(Boolean));

        const starts = recurrence
            ? expandRecurrence(data.startsAt, recurrence)
            : [data.startsAt];
        const duration = data.endsAt ? data.endsAt - data.startsAt : null;
        const seriesId = recurrence && starts.length > 1 ? generateId() : '';
        const recurrenceRule = recurrence && starts.length > 1 ? recurrenceRuleFor(recurrence) : '';

        const created: Meeting[] = [];
        for (const startsAt of starts) {
            /*
             * A FRESH CODE PER OCCURRENCE. This is the line the whole design turns on.
             *
             * Deriving it from the series, or reusing one across occurrences, would mean a
             * student who photographed one poster could check in to every remaining session
             * of the term. Each code is drawn separately and added to `taken` immediately, so
             * a series generated in one pass cannot collide with itself either.
             */
            const publicCode = tracksAttendance(data) ? generatePublicCode(taken) : null;
            if (publicCode) taken.add(publicCode);

            created.push({
                ...data,
                id: generateId(),
                // A deadline is a date, not a gathering: the constraint refuses a code on one,
                // and `attendance_required` with it.
                attendanceRequired: tracksAttendance(data) ? data.attendanceRequired : false,
                publicCode: publicCode ?? '',
                endsAt: duration === null ? undefined : startsAt + duration,
                startsAt,
                recurrenceRule,
                seriesId,
                createdBy: currentMember?.id || '',
                seasonId: state.currentSeasonId,
            });
        }

        set((s) => ({ meetings: [...s.meetings, ...created] }));
        for (const meeting of created) {
            queueForSync('meetings', meeting.id, 'create', {
                ...meeting,
                teamId: state.currentTeamId,
            }).catch(console.error);
        }
        return created.map((m) => m.id);
    },

    updateMeeting: (id, updates, scope = 'occurrence') => {
        const state = get();
        const target = state.meetings.find((m) => m.id === id);
        if (!target) return;
        if (!canWriteToSeason(state.seasons, target.seasonId, 'updateMeeting')) return;

        const affected = meetingsInScope(state.meetings, target, scope);

        /*
         * WHAT AN EDIT MAY NOT CHANGE.
         *
         * `publicCode` is stripped from every update, at every scope. Editing the series must
         * not rewrite already-issued codes — a poster on a wall does not update itself, and a
         * code that changed under it would lock out the students standing in front of it.
         * `id` and `seasonId` go for the ordinary reasons.
         */
        const { publicCode: _code, id: _id, seasonId: _season, ...safe } = updates;

        /*
         * Moving a series shifts each occurrence by the same amount rather than stacking them
         * all onto one date, which is what assigning `startsAt` wholesale would do.
         *
         * The two deltas are tracked separately so that "start an hour earlier, finish at the
         * same time" propagates as a longer meeting rather than as an hour-shifted one. When
         * only the start moved, the end follows it — otherwise editing the time of a series
         * quietly changes how long every session is.
         */
        const startShift = safe.startsAt !== undefined ? safe.startsAt - target.startsAt : 0;
        const endShift =
            safe.endsAt !== undefined && target.endsAt !== undefined
                ? safe.endsAt - target.endsAt
                : startShift;

        const next = state.meetings.map((meeting) => {
            if (!affected.has(meeting.id)) return meeting;

            const patched: Meeting = { ...meeting, ...safe };
            if (meeting.id === id) {
                // The edited occurrence takes the absolute values it was given, except for an
                // end time nobody supplied, which trails its own start.
                if (safe.endsAt === undefined && meeting.endsAt !== undefined) {
                    patched.endsAt = meeting.endsAt + startShift;
                }
            } else {
                patched.startsAt = meeting.startsAt + startShift;
                patched.endsAt =
                    meeting.endsAt === undefined ? undefined : meeting.endsAt + endShift;
            }
            // Editing ONE occurrence forks it: it no longer belongs to the set its siblings
            // describe, so leaving it labelled as one of them would make the next "this and
            // all future" edit reach back into a meeting somebody deliberately changed.
            if (scope === 'occurrence' && affected.size === 1) {
                patched.seriesId = '';
                patched.recurrenceRule = '';
            }
            return patched;
        });

        set({ meetings: next });

        for (const meeting of next) {
            if (!affected.has(meeting.id)) continue;
            queueForSync('meetings', meeting.id, 'update', {
                ...meeting,
                teamId: state.currentTeamId,
            }).catch(console.error);
        }
    },

    deleteMeeting: (id, scope = 'occurrence') => {
        const state = get();
        const target = state.meetings.find((m) => m.id === id);
        if (!target) return;
        if (!canWriteToSeason(state.seasons, target.seasonId, 'deleteMeeting')) return;

        const affected = meetingsInScope(state.meetings, target, scope);

        set((s) => ({
            meetings: s.meetings.filter((m) => !affected.has(m.id)),
            // Attendance cascades server-side (`ON DELETE CASCADE` on the composite FK).
            // Matching that locally is Sprint 4's lesson: a local record left pointing at a
            // deleted parent is a row nothing will ever clean up and every tally will count.
            meetingAttendance: s.meetingAttendance.filter((a) => !affected.has(a.meetingId)),
        }));

        for (const meetingId of affected) {
            queueForSync('meetings', meetingId, 'delete', null).catch(console.error);
        }
    },

    setAttendance: (meetingId, teamMemberId, status, note) => {
        const state = get();
        const meeting = state.meetings.find((m) => m.id === meetingId);
        if (!meeting) return;
        if (!canWriteToSeason(state.seasons, meeting.seasonId, 'setAttendance')) return;

        const currentMember = state.teamMembers.find((m) => m.userId === state.currentUserId);

        /*
         * Reuse the existing row's id when there is one.
         *
         * The unique key is `(meeting_id, team_member_id)`, not the primary key, so a second
         * row for the same pair is refused by the database rather than upserted over. Looking
         * the local record up first is what turns "the coach changed their mind" into an
         * UPDATE of the row that already exists — including one created by a student's own
         * check-in, which arrived with a server-generated id.
         *
         * The residual case is narrow and known: a coach whose device has NOT pulled since a
         * student checked in (so the device was offline while the student was online) will
         * queue a create, and the unique constraint will refuse it. That lands in the
         * dead-letter review with the server's message rather than being lost. See the plan's
         * parking lot.
         */
        const existing = state.meetingAttendance.find(
            (a) => a.meetingId === meetingId && a.teamMemberId === teamMemberId,
        );

        const record: MeetingAttendance = {
            id: existing?.id ?? generateId(),
            meetingId,
            teamMemberId,
            status,
            // Never 'qr' or 'code' from here. Only the RPC may claim a scan happened.
            method: 'coach',
            notes: note ?? existing?.notes ?? '',
            attestedBy: currentMember?.id || '',
            attestedAt: Date.now(),
        };

        set((s) => ({
            meetingAttendance: existing
                ? s.meetingAttendance.map((a) => (a.id === existing.id ? record : a))
                : [...s.meetingAttendance, record],
        }));

        queueForSync('meeting_attendance', record.id, existing ? 'update' : 'create', {
            ...record,
            teamId: state.currentTeamId,
        }).catch(console.error);
    },

    clearAttendance: (meetingId, teamMemberId) => {
        const state = get();
        const meeting = state.meetings.find((m) => m.id === meetingId);
        if (meeting && !canWriteToSeason(state.seasons, meeting.seasonId, 'clearAttendance')) return;

        const existing = state.meetingAttendance.find(
            (a) => a.meetingId === meetingId && a.teamMemberId === teamMemberId,
        );
        if (!existing) return;

        set((s) => ({
            meetingAttendance: s.meetingAttendance.filter((a) => a.id !== existing.id),
        }));
        queueForSync('meeting_attendance', existing.id, 'delete', null).catch(console.error);
    },

    setMeetings: (meetings) => set({ meetings }),
    setMeetingAttendance: (meetingAttendance) => set({ meetingAttendance }),
});

/**
 * Which occurrences an edit or a deletion touches.
 *
 * A meeting with no `seriesId` is always just itself, whatever scope was asked for — which
 * matters because the UI only raises the three-way prompt when there IS a series, and a
 * caller passing `'series'` for a one-off must not somehow reach further than the row.
 */
function meetingsInScope(
    all: Meeting[],
    target: Meeting,
    scope: 'occurrence' | 'future' | 'series',
): Set<string> {
    if (scope === 'occurrence' || !target.seriesId) return new Set([target.id]);

    const siblings = all.filter((m) => m.seriesId === target.seriesId);
    const chosen =
        scope === 'series' ? siblings : siblings.filter((m) => m.startsAt >= target.startsAt);

    return new Set(chosen.map((m) => m.id));
}
