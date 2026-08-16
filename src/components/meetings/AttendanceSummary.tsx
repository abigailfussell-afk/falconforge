import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAppShell } from '../AppShell';
import { useAppStore } from '../../lib/store';
import { useSeasonScope } from '../../lib/season-scope';
import { attendanceRate, attendanceStateMeta, tracksAttendance } from '../../lib/meetings';
import { getMemberDisplayName, getMemberInitials } from '../../lib/member-utils';
import type { AttendanceStatus, Meeting } from '../../types';
import { useSchedule } from './useSchedule';
import { formatFullDate } from './format';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';

/** How far back the summary looks. "All season" is the default a coach actually wants. */
const RANGES = [
    { value: 'season', label: 'This season', days: null },
    { value: '30', label: 'Last 30 days', days: 30 },
    { value: '90', label: 'Last 90 days', days: 90 },
] as const;

/**
 * The season attendance summary (1h) — coaches, mentors and admins only.
 *
 * "ONLY" IS ENFORCED IN THE DATABASE, NOT HERE. The SELECT policy on `meeting_attendance`
 * gives a student their own rows and no others, so a student who reaches this route by URL
 * sees their own line rather than the team's — and could not assemble the team's from the API
 * either. The guard below is the polite version of the same answer.
 *
 * THE RATE EXCLUDES EXCUSED ABSENCES rather than counting them as misses, and a member with
 * no records at all gets "—" rather than 0%. Both follow from what these states mean: an
 * excusal is the coach saying the absence does not count, and an unsaved roster is a fact
 * about the coach, not about the student. A summary that reported 0% for a student whose
 * rosters were never taken would start a conversation about entirely the wrong person.
 */
export default function AttendanceSummary() {
    const navigate = useNavigate();
    const { canManageMeetings, teamMembers } = useAppShell();
    const { season } = useSeasonScope();
    const attendance = useAppStore((s) => s.meetingAttendance);
    const { all } = useSchedule();
    const [range, setRange] = useState<(typeof RANGES)[number]['value']>('season');

    const days = RANGES.find((r) => r.value === range)?.days ?? null;

    /** Events that have happened and could have taken attendance. */
    const heldMeetings = useMemo(() => {
        const now = Date.now();
        const floor = days === null ? 0 : now - days * 86_400_000;
        return all.filter(
            (m) => tracksAttendance(m) && m.startsAt <= now && m.startsAt >= floor,
        );
    }, [all, days]);

    const rows = useMemo(() => {
        const heldIds = new Set(heldMeetings.map((m) => m.id));
        const members = teamMembers
            .filter((m) => m.status === 'approved')
            .sort((a, b) => getMemberDisplayName(a).localeCompare(getMemberDisplayName(b)));

        return members.map((member) => {
            const records = attendance.filter(
                (a) => a.teamMemberId === member.id && heldIds.has(a.meetingId),
            );
            const byMeeting = new Map(records.map((r) => [r.meetingId, r]));

            return {
                member,
                name: getMemberDisplayName(member),
                initials: getMemberInitials(member),
                present: records.filter((r) => r.status === 'present').length,
                excused: records.filter((r) => r.status === 'excused').length,
                missed: records.filter((r) => r.status === 'absent').length,
                rate: attendanceRate(records),
                // Oldest first, so the strip reads left to right like a calendar.
                strip: heldMeetings
                    .slice(-12)
                    .map((m) => ({ meeting: m, status: byMeeting.get(m.id)?.status })),
            };
        });
    }, [teamMembers, attendance, heldMeetings]);

    if (!canManageMeetings) {
        return (
            <EmptyState
                title="The summary is for coaches, mentors and admins"
                body="Your own attendance is on your schedule."
                action={
                    <Button variant="secondary" onClick={() => navigate('/app/meetings')}>
                        My schedule
                    </Button>
                }
            />
        );
    }

    const withRate = rows.filter((r) => r.rate !== null);
    const teamAverage =
        withRate.length > 0
            ? withRate.reduce((sum, r) => sum + (r.rate ?? 0), 0) / withRate.length
            : null;
    const perfect = withRate.filter((r) => r.rate === 1).length;
    const struggling = withRate.filter((r) => (r.rate ?? 1) < 0.75).length;
    // Held, tracked, and nobody recorded anything: the number that says "go and save a roster".
    const neverSaved = heldMeetings.filter(
        (m) => !attendance.some((a) => a.meetingId === m.id),
    ).length;

    return (
        <div className="space-y-4">
            <Link
                to="/app/meetings"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-forge-600 dark:hover:text-forge-400"
            >
                <ArrowLeft size={14} />
                Meetings &amp; Events
            </Link>

            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                        Attendance summary
                    </h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {[
                            season?.name,
                            `${heldMeetings.length} ${heldMeetings.length === 1 ? 'event' : 'events'} held`,
                            `${rows.length} members`,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                </div>
                <label className="text-sm">
                    <span className="sr-only">Date range</span>
                    <select
                        className="field w-auto"
                        value={range}
                        onChange={(e) => setRange(e.target.value as typeof range)}
                    >
                        {RANGES.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            </header>

            {heldMeetings.length === 0 ? (
                <EmptyState
                    title="No events held yet"
                    body="Once a practice or build session has happened, the per-member breakdown appears here."
                />
            ) : (
                <>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                        <Stat
                            label="Team average"
                            value={teamAverage === null ? '—' : `${Math.round(teamAverage * 100)}%`}
                            note={teamAverage === null ? 'no rosters saved yet' : 'excused absences excluded'}
                        />
                        <Stat label="Perfect attendance" value={perfect} note="members at 100%" />
                        <Stat
                            label="Below 75%"
                            value={struggling}
                            note="worth a conversation"
                            tone={struggling > 0 ? 'text-amber-500' : undefined}
                        />
                        <Stat
                            label="Unrecorded events"
                            value={neverSaved}
                            note="rosters never saved"
                            tone={neverSaved > 0 ? 'text-slate-400' : undefined}
                        />
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                        <table className="w-full min-w-table text-sm">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/40 text-2xs font-bold uppercase tracking-wider text-slate-400">
                                    <th className="px-4 py-2 text-left">Member</th>
                                    <th className="px-4 py-2 text-right">Rate</th>
                                    <th className="px-4 py-2 text-right">Present</th>
                                    <th className="px-4 py-2 text-right">Excused</th>
                                    <th className="px-4 py-2 text-right">Missed</th>
                                    <th className="px-4 py-2 text-left">Last {Math.min(12, heldMeetings.length)} events</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                                {rows.map((row) => (
                                    <tr key={row.member.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-2.5">
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-2xs font-bold text-slate-500 dark:text-slate-300">
                                                    {row.initials}
                                                </span>
                                                <span className="font-semibold text-slate-800 dark:text-white">
                                                    {row.name}
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className={`px-4 py-2.5 text-right font-bold tabular-nums ${rateTone(row.rate)}`}
                                        >
                                            {row.rate === null ? '—' : `${Math.round(row.rate * 100)}%`}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                                            {row.present}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                                            {row.excused}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                                            {row.missed}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <EventStrip strip={row.strip} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-700 px-4 py-2 text-2xs">
                            <LegendKey dot="bg-green-500" label="Present" />
                            <LegendKey dot="bg-sky-400" label="Excused" />
                            <LegendKey dot="bg-red-500" label="Absent" />
                            <LegendKey dot="bg-slate-200 dark:bg-slate-700" label="No record" />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

/** Amber below 75%, green at 90 and above — the thresholds the mockup marks. */
function rateTone(rate: number | null): string {
    if (rate === null) return 'text-slate-400';
    if (rate < 0.75) return 'text-red-500';
    if (rate < 0.9) return 'text-amber-500';
    return 'text-green-600 dark:text-green-400';
}

function EventStrip({
    strip,
}: {
    strip: { meeting: Meeting; status: AttendanceStatus | undefined }[];
}) {
    return (
        <div className="flex gap-1">
            {strip.map(({ meeting, status }) => (
                <span
                    key={meeting.id}
                    // A tooltip rather than a legend lookup: twelve identical squares are
                    // unreadable without one, and a coach's next question is always "which
                    // meeting was that".
                    title={`${meeting.title} · ${formatFullDate(meeting.startsAt)} · ${
                        status ? attendanceStateMeta(status).label : 'no record'
                    }`}
                    className={`h-3.5 w-3.5 rounded-sm ${
                        status ? attendanceStateMeta(status).dot : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                />
            ))}
        </div>
    );
}

function Stat({
    label,
    value,
    note,
    tone = 'text-slate-800 dark:text-white',
}: {
    label: string;
    value: string | number;
    note: string;
    tone?: string;
}) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5">
            <p className="text-2xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
            <p className="text-2xs text-slate-500 dark:text-slate-400">{note}</p>
        </div>
    );
}

function LegendKey({ dot, label }: { dot: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-sm ${dot}`} aria-hidden="true" />
            {label}
        </span>
    );
}
