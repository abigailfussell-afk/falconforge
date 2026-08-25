import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Delete, WifiOff } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { supabaseSync } from '../../lib/supabase';
import { useAppShell } from '../AppShell';
import { pullFromServer } from '../../lib/server-pull';
import {
    METHOD_LABELS,
    attendanceRate,
    checkinWindow,
    formatCode,
    parseCode,
} from '../../lib/meetings';
import { getMemberDisplayName, getMemberInitials } from '../../lib/member-utils';
import { useSchedule, useMemberAttendance } from './useSchedule';
import { formatClock, formatFullDate, formatTimeRange } from './format';
import Button from '../ui/Button';

/**
 * Student check-in (1e) — confirm, then receipt, with a typed-code fallback.
 *
 * THIS IS THE ONE SCREEN IN THE APPLICATION THAT NEEDS THE NETWORK, and it says so rather
 * than failing quietly. A check-in is a claim about the present moment; an offline client has
 * no credible account of what the present moment is, so `check_in_with_code` judges the window
 * against the server's `now()`. Queue it instead and every property the design asks for — the
 * window, the dead code from last week, "a student cannot check in for a meeting they did not
 * attend" — becomes a request the client is trusted to honour.
 *
 * The offline answer is not "nothing": it is the coach's roster, which is a normal queued
 * write and works with no signal at all. So the offline state here points at that rather than
 * apologising.
 *
 * A SCAN ARRIVES AS A URL. The QR encodes `#/app/checkin/0842`, so a student uses their own
 * camera app — every phone has one, it needs no permission inside the PWA, and scanning while
 * signed out lands on login and resumes here afterwards (rule 4). The keypad below is for a
 * device with no camera, and it takes the same four digits.
 */
type Phase = 'confirm' | 'entering' | 'recorded' | 'refused';

interface Outcome {
    success: boolean;
    reason?: string;
    error?: string;
    status?: string;
    method?: string;
    recorded_at?: string;
    meeting_id?: string;
    meeting_title?: string;
}

export default function CheckIn() {
    const { code: codeParam } = useParams<{ code?: string }>();
    const navigate = useNavigate();
    const { currentMember } = useAppShell();
    const currentTeamId = useAppStore((s) => s.currentTeamId);
    const { all, past } = useSchedule();

    const scanned = codeParam ? parseCode(codeParam) : null;

    /*
     * An outcome handed over by whoever navigated here.
     *
     * The dashboard's `OpenCheckIns` card calls the RPC itself and then sends the student to
     * this screen for the receipt — which is the part worth showing, and the part worth
     * showing again later. Without this the screen mounted fresh in its "confirm" phase and
     * asked a student who had just checked in to check in, which then answered "already
     * recorded". Correct, and a ridiculous thing to say to somebody two seconds after
     * succeeding.
     */
    const location = useLocation();
    const handedOver = (location.state as { outcome?: Outcome } | null)?.outcome ?? null;

    const [typed, setTyped] = useState('');
    const [phase, setPhase] = useState<Phase>(
        handedOver?.success ? 'recorded' : scanned ? 'confirm' : 'entering',
    );
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<Outcome | null>(handedOver);
    const [online, setOnline] = useState(() => navigator.onLine);

    useEffect(() => {
        const update = () => setOnline(navigator.onLine);
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);

    const code = phase === 'entering' ? parseCode(typed) : scanned;

    /*
     * Name the meeting from LOCAL state before asking the server anything.
     *
     * The whole schedule is already on the device, so the confirm screen can say which meeting
     * this is, where, and at what time, with no round trip. A student who scans the wrong
     * poster finds out before they press the button rather than after.
     */
    const meeting = useMemo(
        () => (code ? all.find((m) => m.publicCode === code) ?? null : null),
        [all, code],
    );

    const myRecords = useMemberAttendance(currentMember?.id, past);
    const rate = attendanceRate(myRecords);

    async function submit(method: 'qr' | 'code') {
        if (!code || !currentTeamId || !supabaseSync) return;
        setBusy(true);
        try {
            const { data, error } = await supabaseSync.rpc('check_in_with_code', {
                p_team_id: currentTeamId,
                p_code: code,
                p_method: method,
            });

            if (error) {
                setOutcome({
                    success: false,
                    reason: 'network',
                    error: online
                        ? 'Could not reach FalconForge. Try again, or ask a coach to mark you present.'
                        : 'You are offline.',
                });
                setPhase('refused');
                return;
            }

            /*
             * "UNKNOWN CODE" MEANS TWO DIFFERENT THINGS, and only the client can tell them
             * apart.
             *
             * An event is created through the offline queue like everything else, so between
             * a coach pressing Save and the drain reaching the server there is a window in
             * which the code exists on the coach's laptop and nowhere else. A student who
             * scans the poster in that window gets `unknown_code` from a server that is simply
             * behind — and "that code does not match a meeting for your team" is then a false
             * statement about a code that is perfectly good, sending them to find a coach for
             * a problem that fixes itself in seconds.
             *
             * The client knows: it has the meeting in its own store. So when the code resolves
             * locally and the server disagrees, say what is actually happening.
             *
             * Found by the smoke pack, which creates an event and checks in immediately —
             * faster than a human, which is exactly why it caught it.
             */
            const result = data as unknown as Outcome;
            const refined: Outcome =
                result.reason === 'unknown_code' && meeting
                    ? {
                          ...result,
                          reason: 'not_synced',
                          error: 'This event has not finished syncing yet. Try again in a few seconds, or ask a coach to mark you present.',
                      }
                    : result;

            setOutcome(refined);
            setPhase(refined.success ? 'recorded' : 'refused');

            // Pull the row straight back so the schedule and the coach's roster agree with
            // the receipt the student is looking at, rather than waiting for the next tick.
            if (refined.success) void pullFromServer({ teamId: currentTeamId, mode: 'full' });
        } finally {
            setBusy(false);
        }
    }

    // ---- Offline -----------------------------------------------------------
    if (!online) {
        return (
            <Shell title="Check in">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                    <WifiOff size={26} className="mx-auto mb-2 text-amber-500" />
                    <h2 className="text-base font-bold text-slate-800 dark:text-white">
                        You are offline
                    </h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        Checking yourself in needs a connection, because the code is only valid inside
                        its own check-in window and only FalconForge can confirm you are inside it.
                    </p>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        Ask a coach to mark you present — the roster works offline — or come back to
                        this screen once you have signal.
                    </p>
                </div>
                <Button variant="secondary" className="mt-3 w-full border border-slate-200 dark:border-slate-700" onClick={() => navigate('/app/meetings')}>
                    Back to my schedule
                </Button>
            </Shell>
        );
    }

    // ---- Receipt -----------------------------------------------------------
    if (phase === 'recorded' && outcome?.success) {
        const recordedAt = outcome.recorded_at ? new Date(outcome.recorded_at).getTime() : Date.now();
        return (
            <Shell title="Checked in">
                <div className="text-center">
                    <CheckCircle2 size={64} className="mx-auto text-green-500" strokeWidth={1.5} />
                    <h2 className="mt-3 text-2xl font-bold text-slate-800 dark:text-white">
                        You're checked in
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Recorded at {formatClock(recordedAt)} as{' '}
                        <span className="font-semibold text-green-600 dark:text-green-400">Present</span>
                    </p>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-sm font-bold text-slate-800 dark:text-white">
                        {outcome.meeting_title ?? meeting?.title}
                    </p>
                    {meeting && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {[
                                formatFullDate(meeting.startsAt),
                                formatTimeRange(meeting.startsAt, meeting.endsAt),
                                meeting.location,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    )}
                    <dl className="mt-3 space-y-1.5 border-t border-slate-100 dark:border-slate-700 pt-3 text-xs">
                        <Row label="Event ID" value={formatCode(code ?? '')} mono />
                        <Row
                            label="Method"
                            value={METHOD_LABELS[outcome.method ?? 'qr'] ?? 'QR scan'}
                        />
                    </dl>
                </div>

                {rate !== null && (
                    <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                Your season attendance
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {myRecords.length} events recorded
                            </p>
                        </div>
                        <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
                            {Math.round(rate * 100)}%
                        </p>
                    </div>
                )}

                <Button variant="secondary" className="mt-4 w-full border border-slate-200 dark:border-slate-700" onClick={() => navigate('/app/meetings')}>
                    See my schedule
                </Button>
                {/* Said plainly, because a student who scanned the wrong poster will look for
                    an undo and there deliberately is not one. */}
                <p className="mt-2 text-center text-2xs text-slate-400">
                    Wrong event? Tell a coach — you cannot undo a check-in yourself.
                </p>
            </Shell>
        );
    }

    // ---- Refusal -----------------------------------------------------------
    if (phase === 'refused' && outcome) {
        return (
            <Shell title="Check in">
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
                    <h2 className="text-base font-bold text-slate-800 dark:text-white">
                        {REFUSAL_HEADINGS[outcome.reason ?? ''] ?? 'Could not check you in'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{outcome.error}</p>
                    {outcome.reason === 'already_recorded' && outcome.status && (
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                            You are recorded as{' '}
                            <span className="font-semibold capitalize">{outcome.status}</span>
                            {outcome.method ? ` (${METHOD_LABELS[outcome.method] ?? outcome.method})` : ''}.
                        </p>
                    )}
                </div>

                <Button
                    className="mt-3 w-full"
                    onClick={() => {
                        setOutcome(null);
                        setTyped('');
                        setPhase('entering');
                    }}
                >
                    Enter a different code
                </Button>
                <Button variant="secondary" className="mt-2 w-full border border-slate-200 dark:border-slate-700" onClick={() => navigate('/app/meetings')}>
                    Back to my schedule
                </Button>
            </Shell>
        );
    }

    // ---- Confirm (scanned) -------------------------------------------------
    if (phase === 'confirm' && scanned) {
        const window_ = meeting ? checkinWindow(meeting) : null;
        return (
            <Shell title="Check in">
                {meeting ? (
                    <>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/40 bg-green-500/15 px-2 py-0.5 text-2xs font-bold text-green-600 dark:text-green-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                            Check-in open
                        </span>
                        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                            You're checking in to
                        </p>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">
                            {meeting.title}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {formatFullDate(meeting.startsAt)} ·{' '}
                            {formatTimeRange(meeting.startsAt, meeting.endsAt)}
                        </p>
                        {meeting.location && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">{meeting.location}</p>
                        )}
                        {window_ && (
                            <p className="mt-1 text-2xs text-slate-400">
                                Check-in {formatClock(window_.opensAt)}–{formatClock(window_.closesAt)} ·{' '}
                                {formatCode(scanned)}
                            </p>
                        )}
                    </>
                ) : (
                    <>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">
                            {formatCode(scanned)}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            This device has not seen that event yet. Checking in will confirm it with
                            FalconForge.
                        </p>
                    </>
                )}

                {currentMember && (
                    <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forge-100 dark:bg-forge-900/40 text-xs font-bold text-forge-600 dark:text-forge-300">
                            {/*
                              * The NINTH implementation of initials in this repo, and it
                              * disagreed with the canonical one. `member-utils` takes the FIRST
                              * and LAST initial; this took the first two words. "Mary Jane
                              * Watson" is `MW` on the roster and was `MJ` here — and the
                              * check-in avatar and the roster avatar are two screens a coach
                              * can have open at once.
                              *
                              * `getMemberDisplayName` was already imported from that module in
                              * this very file, so the copy was never even saving an import.
                              * CLAUDE.md principle 9.
                              */}
                            {getMemberInitials(currentMember)}
                        </span>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-800 dark:text-white">
                                {getMemberDisplayName(currentMember)}
                            </p>
                            <p className="text-xs capitalize text-slate-500 dark:text-slate-400">
                                {currentMember.role}
                            </p>
                        </div>
                    </div>
                )}

                {/* Stated up front rather than discovered afterwards. */}
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Checking in as yourself only. Coaches can see the exact time you scanned.
                </p>

                <Button
                    className="mt-4 w-full py-3 text-base"
                    busy={busy}
                    onClick={() => submit('qr')}
                    data-testid="confirm-checkin"
                >
                    Check me in
                </Button>
                <Button
                    variant="secondary"
                    className="mt-2 w-full"
                    onClick={() => navigate('/app/meetings')}
                >
                    Not me / cancel
                </Button>
            </Shell>
        );
    }

    // ---- Typed code fallback -----------------------------------------------
    return (
        <Shell title="Enter check-in code">
            <p className="text-sm text-slate-500 dark:text-slate-400">
                Type the code printed under the QR poster. It only works while check-in is open for
                that event.
            </p>

            <div
                data-testid="code-display"
                className="mt-3 rounded-xl border-2 border-forge-500 bg-white dark:bg-slate-800 px-4 py-3 text-center font-mono text-3xl font-bold tracking-poster text-slate-800 dark:text-white"
                aria-live="polite"
            >
                {typed ? formatCode(typed.padEnd(4, '·')) : 'FF-····'}
            </div>

            {code && meeting && (
                <p className="mt-2 text-sm font-medium text-green-600 dark:text-green-400">
                    ✓ Matches: {meeting.title}
                    {meeting.location ? `, ${meeting.location}` : ''}
                </p>
            )}

            <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    One code per meeting
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Each meeting gets its own code. A code from an earlier meeting will not check you
                    in.
                </p>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <Key key={digit} onClick={() => setTyped((v) => (v + digit).slice(0, 4))}>
                        {digit}
                    </Key>
                ))}
                <Key onClick={() => setTyped('')} muted>
                    Clear
                </Key>
                <Key onClick={() => setTyped((v) => (v + '0').slice(0, 4))}>0</Key>
                <Key onClick={() => setTyped((v) => v.slice(0, -1))} muted aria-label="Delete">
                    <Delete size={18} />
                </Key>
            </div>

            <Button
                className="mt-4 w-full py-3 text-base"
                busy={busy}
                disabled={!code}
                title={code ? undefined : 'Enter all four digits'}
                onClick={() => submit('code')}
                data-testid="submit-code"
            >
                Check me in
            </Button>
        </Shell>
    );
}

const REFUSAL_HEADINGS: Record<string, string> = {
    window_not_open: 'Too early',
    window_closed: 'Check-in has closed',
    unknown_code: 'That code did not match',
    not_synced: 'Not synced yet',
    already_recorded: 'Already recorded',
    not_a_member: 'Not on this team',
    team_read_only: "Your team's licence has lapsed",
    season_archived: 'That season is closed',
    no_attendance_for_type: 'No attendance for that event',
    network: 'Could not reach FalconForge',
};

/**
 * Phone-first column. The check-in screens are designed at 375 and grow from there.
 *
 * `flex w-fit` rather than `inline-flex` on the back link, and it is not cosmetic: an
 * inline-level link followed by inline-level content lays out on ONE LINE, so the
 * "Check-in open" badge rendered on top of the back link. Exactly the arrangement bug the
 * splash screen had, found the same way — by looking at it.
 */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="mx-auto w-full max-w-panel">
            <Link
                to="/app/meetings"
                className="mb-3 flex w-fit items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-forge-600 dark:hover:text-forge-400"
            >
                <ArrowLeft size={14} />
                {title}
            </Link>
            {children}
        </div>
    );
}

function Key({
    children,
    onClick,
    muted = false,
    ...rest
}: {
    children: React.ReactNode;
    onClick: () => void;
    muted?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex h-14 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-xl font-semibold transition-colors active:scale-95 ${
                muted
                    ? 'text-slate-500 dark:text-slate-400 text-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white'
            } hover:bg-slate-100 dark:hover:bg-slate-700`}
            {...rest}
        >
            {children}
        </button>
    );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between">
            <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className={`font-semibold text-slate-700 dark:text-slate-200 ${mono ? 'font-mono' : ''}`}>
                {value}
            </dd>
        </div>
    );
}
