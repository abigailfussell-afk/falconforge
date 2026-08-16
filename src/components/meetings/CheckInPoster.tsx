import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { formatCode, checkinWindow, tracksAttendance } from '../../lib/meetings';
import { useMeeting } from './useSchedule';
import { formatClock, formatLongDate, formatTimeRange } from './format';
import QrCode from './QrCode';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';

/**
 * The printable poster (1d) — US Letter, black on white.
 *
 * BLACK ON WHITE IS A REQUIREMENT, NOT A STYLE CHOICE. The rest of the app is a dark UI and a
 * dark poster is a poster that empties a school's toner cartridge and photographs badly under
 * fluorescent light. So this screen ignores the theme entirely: explicit `bg-white` and
 * `text-black`, no `dark:` variants anywhere below, and the QR generated in true monochrome.
 *
 * It renders as a full-screen surface over the app rather than as a separate route outside
 * the shell, so a coach never leaves the event they were looking at — and `.print-surface` in
 * index.css is what makes the browser print THIS and not the sidebar behind it.
 *
 * The small print at the bottom is doing real work. "This code belongs to today's session
 * only" is the single sentence that stops a student photographing the poster and expecting it
 * to work next week, and it is cheaper to print it than to answer it.
 */
export default function CheckInPoster() {
    const { meetingId } = useParams<{ meetingId: string }>();
    const navigate = useNavigate();
    const meeting = useMeeting(meetingId);
    const teams = useAppStore((s) => s.teams);
    const currentTeamId = useAppStore((s) => s.currentTeamId);
    const team = teams.find((t) => t.id === currentTeamId);

    if (!meeting || !tracksAttendance(meeting) || !meeting.publicCode) {
        return (
            <EmptyState
                title="No poster for this event"
                body="Deadlines and events with check-in turned off have no code to print."
                action={
                    <Button variant="secondary" onClick={() => navigate(-1)}>
                        Go back
                    </Button>
                }
            />
        );
    }

    const { closesAt } = checkinWindow(meeting);

    return (
        <div className="print-surface fixed inset-0 z-50 overflow-auto bg-white">
            {/* The controls are the one part that must not print. */}
            <div className="no-print sticky top-0 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2">
                <button
                    onClick={() => navigate(-1)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                    <ArrowLeft size={15} />
                    Back to event
                </button>
                <Button onClick={() => window.print()}>
                    <Printer size={15} />
                    Print
                </Button>
            </div>

            {/* 8.5in wide with a half-inch of breathing room, so what is on screen is what
                comes out of the printer rather than a surprise at the paper tray. */}
            <div className="mx-auto flex w-full max-w-[7.5in] flex-col items-center px-6 py-10 text-center text-black">
                <div className="mb-6 flex items-center gap-3">
                    <span className="text-2xl font-black italic tracking-tighter">
                        FALCON<span className="text-slate-500">FORGE</span>
                    </span>
                    {team && (
                        <>
                            <span className="text-slate-400">|</span>
                            <span className="text-base font-semibold text-slate-700">
                                {team.teamNumber ? `Team #${team.teamNumber} ` : ''}
                                {team.name}
                            </span>
                        </>
                    )}
                </div>

                <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-600">
                    Scan to check in
                </p>
                <h1 className="mt-2 text-4xl font-bold leading-tight">{meeting.title}</h1>
                <p className="mt-3 text-lg text-slate-700">
                    {formatLongDate(meeting.startsAt)} · {formatTimeRange(meeting.startsAt, meeting.endsAt)}
                    {meeting.location ? ` · ${meeting.location}` : ''}
                </p>

                <div className="mt-8 rounded-2xl border-4 border-black p-4">
                    <QrCode code={meeting.publicCode} size={420} monochrome />
                </div>

                <div className="mt-8 flex w-full items-center gap-4">
                    <span className="h-px flex-1 bg-slate-300" />
                    <span className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">
                        No camera?
                    </span>
                    <span className="h-px flex-1 bg-slate-300" />
                </div>

                <p className="mt-4 text-lg text-slate-700">
                    Open FalconForge → Meetings → <span className="font-bold">Enter code</span>
                </p>
                {/* Tracked and spaced to be read from the back of a classroom. */}
                <p className="mt-2 font-mono text-6xl font-bold tracking-[0.15em]">
                    {formatCode(meeting.publicCode)}
                </p>

                <p className="mt-10 max-w-prose text-sm leading-relaxed text-slate-500">
                    You must be signed in to FalconForge. This code belongs to today's session only —
                    it stops working at {formatClock(closesAt)}, and the next session has a different
                    one.
                </p>
            </div>
        </div>
    );
}
