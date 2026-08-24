import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChevronRight, Clock, PenLine, ShieldCheck } from 'lucide-react';
import { CHECKPOINT_META, findTrack, formatLearnerTime, trackSummary } from '../../lib/training';
import EmptyState from '../ui/EmptyState';
import StubNotice from './StubNotice';

/**
 * One track and its lessons — the unit level of the structure (D5).
 *
 * THE EMPTY STATE IS THE POINT OF THIS SCREEN, not a fallback on it. Six of the eight tracks
 * have no outline, so this is what most of Training looks like today, and it has to say
 * something a person can act on: how many lessons are planned, and that the absence is the
 * schedule rather than a fault. `docs/failure-modes.md` section 4 — the zero case is the first
 * case, not an edge one.
 */
export default function TrackDetail() {
    const { trackId } = useParams<{ trackId: string }>();
    const track = findTrack(trackId);

    if (!track) {
        return (
            <div className="space-y-4">
                <BackLink />
                <EmptyState
                    icon={BookOpen}
                    title="No such track"
                    body="That link points at a track that does not exist. The eight tracks are on the Training page."
                />
            </div>
        );
    }

    const summary = trackSummary(track);

    return (
        <div className="space-y-4">
            <BackLink />

            <header>
                <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-forge-600 text-base font-bold text-white">
                        {track.code}
                    </span>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                        {track.title}
                    </h1>
                </div>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{track.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                        <BookOpen size={13} aria-hidden="true" />
                        {summary.hasOutline
                            ? `${summary.outlined} lessons`
                            : `${summary.planned} lessons planned`}
                    </span>
                    {summary.minutes !== null && (
                        <span className="inline-flex items-center gap-1">
                            <Clock size={13} aria-hidden="true" />
                            {formatLearnerTime(summary.minutes)} of learner time
                        </span>
                    )}
                </div>
            </header>

            <StubNotice />

            {!summary.hasOutline ? (
                <div
                    data-testid="track-empty"
                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card"
                >
                    <EmptyState
                        icon={PenLine}
                        title="This track has not been outlined yet"
                        body={`${summary.planned} lessons are planned for ${track.title}. They will appear here as they are written — Onboarding and Safety show what a written track looks like.`}
                        action={
                            <Link
                                to="/app/training/onboarding"
                                className="text-sm font-semibold text-forge-600 dark:text-forge-400 hover:underline"
                            >
                                Look at Onboarding
                            </Link>
                        }
                    />
                </div>
            ) : (
                <ol
                    data-testid="lesson-list"
                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden"
                >
                    {track.lessons.map((lesson) => (
                        <li key={lesson.id}>
                            <Link
                                to={`/app/training/${track.id}/${lesson.id}`}
                                data-testid={`lesson-${lesson.id}`}
                                className="group flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                            >
                                <span className="w-8 shrink-0 text-xs font-bold text-slate-400">
                                    {lesson.id}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-800 dark:text-white">
                                        {lesson.title}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        {CHECKPOINT_META[lesson.checkpoint.verifier].who}
                                        {lesson.gatesBuildWork && ' Needed before any build work.'}
                                    </p>
                                </div>
                                <span className="hidden shrink-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400 sm:inline-flex">
                                    <Clock size={13} aria-hidden="true" />
                                    {formatLearnerTime(lesson.minutes)}
                                </span>
                                {(lesson.checkpoint.verifier === 'mentor' ||
                                    lesson.checkpoint.verifier === 'coach') && (
                                    <ShieldCheck
                                        size={14}
                                        className="shrink-0 text-emerald-500"
                                        aria-label="Signed off by an adult"
                                    />
                                )}
                                <ChevronRight
                                    size={16}
                                    className="shrink-0 text-slate-400 group-hover:text-forge-500"
                                    aria-hidden="true"
                                />
                            </Link>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

function BackLink() {
    return (
        <Link
            to="/app/training"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-forge-600 dark:hover:text-forge-400"
        >
            <ArrowLeft size={15} aria-hidden="true" />
            All tracks
        </Link>
    );
}
