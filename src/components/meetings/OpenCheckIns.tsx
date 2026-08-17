import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, QrCode as QrIcon } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { supabaseSync } from '../../lib/supabase';
import { pullFromServer } from '../../lib/server-pull';
import { checkinState, checkinWindow, parseCode } from '../../lib/meetings';
import { useSchedule } from './useSchedule';
import { formatClock, formatTimeRange } from './format';
import Button from '../ui/Button';

/**
 * "Check-in is open right now" — the dashboard card, with the code field on it.
 *
 * WHY A CODE FIELD RATHER THAN A BUTTON
 *
 * The obvious version of this card is a button that checks you in, and the obvious version is
 * wrong: the app already knows every code, so a button would mark a student present from
 * anywhere with a signal. That was the actual defect Kevin found. The code has to come off the
 * poster, so the shortcut this card offers is not "skip the code" — it is "you do not have to
 * go and find the right screen to type it into".
 *
 * It shows nothing at all when no check-in is open, which is most of the time. A dashboard
 * that carries a permanently empty box about meetings is worse than one that does not mention
 * them until they are happening.
 */
export default function OpenCheckIns() {
    const navigate = useNavigate();
    const currentTeamId = useAppStore((s) => s.currentTeamId);

    // A minute is the resolution the window is measured in. Without a clock of its own this
    // card would keep offering a check-in for an event that closed twenty minutes ago.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);

    const { upcoming } = useSchedule(now);
    const open = useMemo(
        () => upcoming.filter((m) => checkinState(m, now) === 'open'),
        [upcoming, now],
    );

    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (open.length === 0) return null;

    const parsed = parseCode(code);

    async function submit() {
        if (!parsed || !currentTeamId || !supabaseSync) return;
        setBusy(true);
        setError(null);
        try {
            const { data, error: rpcError } = await supabaseSync.rpc('check_in_with_code', {
                p_team_id: currentTeamId,
                p_code: parsed,
                p_method: 'code',
            });

            if (rpcError) {
                setError(
                    navigator.onLine
                        ? 'Could not reach FalconForge. Try again in a moment.'
                        : 'You are offline. Ask a coach to mark you present.',
                );
                return;
            }

            const result = data as unknown as { success: boolean; error?: string };
            if (!result?.success) {
                setError(result?.error ?? 'That code was not accepted.');
                return;
            }

            /*
             * Hand the OUTCOME over, not just the code.
             *
             * The receipt screen is the right place to show what was recorded, when and by
             * what method — a student may want to show a coach later. But navigating with the
             * code alone made that screen mount in its "confirm" phase and ask a student who
             * had just checked in to check in again, which answered "already recorded" two
             * seconds after succeeding.
             */
            void pullFromServer({ teamId: currentTeamId, mode: 'full' });
            navigate(`/app/checkin/${parsed}`, { state: { outcome: result } });
        } finally {
            setBusy(false);
        }
    }

    return (
        <section
            data-testid="open-checkins"
            className="rounded-xl border border-green-500/40 bg-green-500/10 p-3.5"
        >
            <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" aria-hidden="true" />
                Check-in {open.length > 1 ? `open for ${open.length} events` : 'is open'}
            </h3>

            <ul className="mt-2 space-y-1">
                {open.map((meeting) => (
                    <li key={meeting.id} className="text-sm">
                        <span className="font-semibold text-slate-800 dark:text-white">
                            {meeting.title}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                            {' · '}
                            {formatTimeRange(meeting.startsAt, meeting.endsAt)}
                            {meeting.location ? ` · ${meeting.location}` : ''}
                        </span>
                        <span className="block text-2xs text-slate-500 dark:text-slate-400">
                            {/* The CLOSING time, not the code. Knowing how long you have is
                                useful; being handed the credential is the bug. */}
                            Closes {formatClock(checkinWindow(meeting).closesAt)}
                        </span>
                    </li>
                ))}
            </ul>

            <label className="mt-3 block">
                <span className="mb-1 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <KeyRound size={12} />
                    Code from the poster
                </span>
                <div className="flex gap-2">
                    <input
                        className="field font-mono tracking-code"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={7}
                        placeholder="FF-0000"
                        value={code}
                        data-testid="dashboard-checkin-code"
                        onChange={(e) => {
                            setCode(e.target.value);
                            setError(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && parsed) void submit();
                        }}
                        aria-label="Check-in code"
                    />
                    <Button
                        onClick={submit}
                        busy={busy}
                        disabled={!parsed}
                        title={parsed ? undefined : 'Enter the four digits from the poster'}
                        data-testid="dashboard-checkin-submit"
                    >
                        Check in
                    </Button>
                </div>
            </label>

            {error && (
                <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
                    {error}
                </p>
            )}

            <button
                type="button"
                onClick={() => navigate('/app/checkin')}
                className="mt-2 inline-flex items-center gap-1.5 text-2xs font-semibold text-slate-500 hover:text-forge-600 dark:text-slate-400 dark:hover:text-forge-400"
            >
                <QrIcon size={12} />
                Open the full check-in screen
            </button>
        </section>
    );
}
