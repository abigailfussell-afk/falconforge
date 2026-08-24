import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, ClipboardSignature, Clock, ShieldCheck } from 'lucide-react';
import { useAppShell } from '../AppShell';
import { isMentorOrAbove } from '../../lib/roles';
import { TRAINING_TRACKS } from '../../lib/training-curriculum';
import { formatLearnerTime, outlineTotals, trackSummary } from '../../lib/training';
import EmptyState from '../ui/EmptyState';
import SectionHeader from '../ui/SectionHeader';
import StubNotice from './StubNotice';

/**
 * The training index — the tracks, and for an adult the sign-off queue (D5).
 *
 * ONE NAV ITEM, TWO EXPERIENCES, the same shape Meetings uses: everybody sees the tracks,
 * because the whole point of training is that a rookie can find it; a mentor additionally sees
 * the queue of people waiting on them. That is the student/mentor split the decision asked to
 * have settled, and it is deliberately the same split as Meetings rather than a second one —
 * `isMentorOrAbove` is the predicate both call.
 *
 * TRAINING IS NOT SEASON-SCOPED, and this page is the first in the app that says so out loud.
 * Every other view is season-scoped and goes read-only when the season closes; skills belong to
 * a person, not to a season (design section 2.2), and the summer between seasons is when a team
 * actually does its training. So this page reads no season, offers no season picker behaviour,
 * and renders identically with the season archived or absent.
 */
export default function TrainingHome() {
    const { currentMember } = useAppShell();
    const canSignOff = isMentorOrAbove(currentMember?.role);
    const totals = outlineTotals();

    return (
        <div className="space-y-4">
            <header>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Training</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {canSignOff
                        ? 'Eight tracks a rookie can be pointed at, and the checkpoints you sign off along the way.'
                        : 'Eight tracks, from your first match to the one you want to build. Work through them in your own time.'}
                </p>
            </header>

            <StubNotice />

            {canSignOff && (
                <section
                    data-testid="signoff-queue"
                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4"
                >
                    <SectionHeader icon={ClipboardSignature} title="Waiting for your sign-off" />
                    <EmptyState
                        icon={ShieldCheck}
                        title="Nothing is waiting for you"
                        body="When the lessons ship, a student who finishes a checkpoint asks for a sign-off and it appears here. Nothing is recorded yet."
                    />
                </section>
            )}

            <section aria-labelledby="tracks-heading" className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                    <h2
                        id="tracks-heading"
                        className="text-base font-bold text-slate-800 dark:text-white"
                    >
                        Tracks
                    </h2>
                    <p
                        className="text-xs text-slate-500 dark:text-slate-400"
                        data-testid="outline-totals"
                    >
                        {totals.outlined} of {totals.planned} lessons outlined
                    </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {TRAINING_TRACKS.map((track) => {
                        const summary = trackSummary(track);
                        return (
                            <Link
                                key={track.id}
                                to={`/app/training/${track.id}`}
                                data-testid={`track-${track.id}`}
                                className="group flex flex-col gap-2 bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card hover:shadow-raised hover:border-forge-500/50 transition-all"
                            >
                                <div className="flex items-center gap-2.5">
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-forge-600 text-sm font-bold text-white">
                                        {track.code}
                                    </span>
                                    <h3 className="flex-1 text-sm font-bold text-slate-800 dark:text-white">
                                        {track.title}
                                    </h3>
                                    <ChevronRight
                                        size={16}
                                        className="text-slate-400 group-hover:text-forge-500"
                                        aria-hidden="true"
                                    />
                                </div>

                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {track.summary}
                                </p>

                                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-slate-500 dark:text-slate-400">
                                    <span className="inline-flex items-center gap-1">
                                        <BookOpen size={13} aria-hidden="true" />
                                        {summary.hasOutline
                                            ? `${summary.outlined} lessons`
                                            : `${summary.planned} lessons planned`}
                                    </span>
                                    {summary.minutes !== null && (
                                        <span className="inline-flex items-center gap-1">
                                            <Clock size={13} aria-hidden="true" />
                                            {formatLearnerTime(summary.minutes)}
                                        </span>
                                    )}
                                    {summary.mentorCheckpoints > 0 && (
                                        <span className="inline-flex items-center gap-1">
                                            <ShieldCheck size={13} aria-hidden="true" />
                                            {summary.mentorCheckpoints} signed off
                                        </span>
                                    )}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </section>

            <p className="text-xs text-slate-500 dark:text-slate-400">
                Training does not belong to a season. It stays open between seasons, which is when
                most of it gets done.
            </p>
        </div>
    );
}
