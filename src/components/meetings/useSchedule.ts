/**
 * What every meetings screen needs to know, derived once.
 *
 * The manager, the student schedule, both calendars, the roster, the summary and two
 * dashboard widgets all ask some version of "this season's events, in order, split at now"
 * and "this meeting's roster, with each member's record attached". Six inline copies of that
 * is how the season filter came to be written out six times before Sprint 4 deleted it — and
 * one of those copies had been missing entirely, leaking a whole prior season of scouting
 * reports into the current list.
 */
import { useMemo } from 'react';
import { useAppStore } from '../../lib/store';
import { useSeasonScoped } from '../../lib/season-scope';
import { getMemberDisplayName, getMemberInitials } from '../../lib/member-utils';
import { tallyAttendance, type AttendanceTally } from '../../lib/meetings';
import type { Meeting, MeetingAttendance, TeamMember } from '../../types';

export interface Schedule {
    /** Every meeting this season, earliest first. */
    all: Meeting[];
    /** Not yet finished, earliest first — what "upcoming" means on every screen. */
    upcoming: Meeting[];
    /** Finished, most recent first. A past list reads backwards from now. */
    past: Meeting[];
    /** The next one that has not finished. What the dashboard widgets point at. */
    next: Meeting | null;
}

/**
 * A meeting counts as past once it has ENDED, not once it has started.
 *
 * The difference matters for exactly the case the feature exists for: a build session
 * currently running must stay at the top of "upcoming" while a coach is standing in it with
 * the QR on screen, rather than dropping into the archive at 6:01pm.
 */
function hasFinished(meeting: Meeting, now: number): boolean {
    return (meeting.endsAt ?? meeting.startsAt) < now;
}

/**
 * This season's schedule, split at `now`.
 *
 * `now` is a parameter so a caller that already ticks a clock passes its own value and the
 * split cannot disagree with what that caller is rendering.
 */
export function useSchedule(now: number = Date.now()): Schedule {
    const meetings = useSeasonScoped(useAppStore((s) => s.meetings));

    return useMemo(() => {
        const all = [...meetings].sort((a, b) => a.startsAt - b.startsAt);
        const upcoming = all.filter((m) => !hasFinished(m, now));
        const past = all.filter((m) => hasFinished(m, now)).reverse();
        return { all, upcoming, past, next: upcoming[0] ?? null };
    }, [meetings, now]);
}

/** One meeting by id, from any season — a deep link may name an archived one. */
export function useMeeting(meetingId: string | undefined): Meeting | null {
    const meetings = useAppStore((s) => s.meetings);
    return useMemo(
        () => (meetingId ? meetings.find((m) => m.id === meetingId) ?? null : null),
        [meetings, meetingId],
    );
}

export interface RosterRow {
    member: TeamMember;
    name: string;
    initials: string;
    /** Undefined means UNRECORDED, which is not the same as absent and never becomes it. */
    record: MeetingAttendance | undefined;
}

export interface Roster {
    rows: RosterRow[];
    tally: AttendanceTally;
}

/**
 * The people a meeting's attendance covers, with each one's record.
 *
 * EVERY APPROVED MEMBER, not only the students. The mockups say "21 students" because a
 * team's roster mostly is students, but a mentor who turns up to a build session is as much
 * "who was here" as anybody else, and `check_in_with_code` lets them scan — so a roster that
 * omitted them would show a coach a smaller number than the database holds.
 *
 * Sorted by display name, which is the order the mockups show and the only one somebody
 * walking a room with a tablet can follow.
 */
export function useRoster(meetingId: string | undefined): Roster {
    const allMembers = useAppStore((s) => s.teamMembers);
    const currentTeamId = useAppStore((s) => s.currentTeamId);
    const attendance = useAppStore((s) => s.meetingAttendance);

    return useMemo(() => {
        const members = allMembers
            .filter((m) => m.teamId === currentTeamId && m.status === 'approved')
            .sort((a, b) => getMemberDisplayName(a).localeCompare(getMemberDisplayName(b)));

        const byMember = new Map(
            attendance.filter((a) => a.meetingId === meetingId).map((a) => [a.teamMemberId, a]),
        );

        const rows = members.map((member) => ({
            member,
            name: getMemberDisplayName(member),
            initials: getMemberInitials(member),
            record: byMember.get(member.id),
        }));

        return {
            rows,
            tally: tallyAttendance([...byMember.values()], members.length),
        };
    }, [allMembers, currentTeamId, attendance, meetingId]);
}

/** Every attendance record for a set of meetings, keyed by meeting id. */
export function useAttendanceByMeeting(meetings: Meeting[]): Map<string, MeetingAttendance[]> {
    const attendance = useAppStore((s) => s.meetingAttendance);

    return useMemo(() => {
        const ids = new Set(meetings.map((m) => m.id));
        const grouped = new Map<string, MeetingAttendance[]>();
        for (const id of ids) grouped.set(id, []);
        for (const record of attendance) {
            grouped.get(record.meetingId)?.push(record);
        }
        return grouped;
    }, [attendance, meetings]);
}

/** One member's records across a set of meetings, newest first. */
export function useMemberAttendance(
    memberId: string | undefined,
    meetings: Meeting[],
): MeetingAttendance[] {
    const attendance = useAppStore((s) => s.meetingAttendance);

    return useMemo(() => {
        if (!memberId) return [];
        const order = new Map(meetings.map((m, index) => [m.id, index]));
        return attendance
            .filter((a) => a.teamMemberId === memberId && order.has(a.meetingId))
            .sort((a, b) => (order.get(b.meetingId) ?? 0) - (order.get(a.meetingId) ?? 0));
    }, [attendance, memberId, meetings]);
}
