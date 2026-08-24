import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowLeft,
    BookOpen,
    CalendarClock,
    Clock,
    PenLine,
    Target,
    Users,
    Wrench,
} from 'lucide-react';
import { useAppShell } from '../AppShell';
import { isMentorOrAbove } from '../../lib/roles';
import { CHECKPOINT_META, findLesson, findTrack, formatLearnerTime, prereqsFor } from '../../lib/training';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import SectionHeader from '../ui/SectionHeader';
import StubNotice from './StubNotice';

/**
 * One lesson — the leaf of the structure, and where the student/mentor split gets specific (D5).
 *
 * WHAT A STUDENT SEES VERSUS A MENTOR. The outline is the same for both, because it is the same
 * lesson; the checkpoint is not. A student asks for a sign-off, a mentor gives one, and a mentor
 * additionally sees who on the team has finished the lesson. That is the whole difference, and
 * it is driven by `isMentorOrAbove` — the same predicate Meetings uses — rather than by a second
 * role rule invented here.
 *
 * NOTHING ON THIS PAGE RECORDS ANYTHING, and it says so under the control rather than only in
 * the banner at the top. The checkpoint button is rendered and disabled instead of hidden
 * because the shape being settled here IS the checkpoint: hiding it would leave the question D5
 * asks — "how is progress recorded" — answered by an absence. Progress needs `member_progress`
 * and `skill_signoff`, which are tables, which is a migration, which the decision puts out of
 * scope. A local-only store key was considered and rejected: it would be a second data path for
 * a thing that must end up synced (principle 3), and a tick a student could see but their mentor
 * could not is worse than no tick at all.
 */
export default function LessonDetail() {
    const { trackId, lessonId } = useParams<{ trackId: string; lessonId: string }>();
    const track = findTrack(trackId);
    const lesson = findLesson(trackId, lessonId);
    const { currentMember } = useAppShell();
    const canSignOff = isMentorOrAbove(currentMember?.role);

    if (!track || !lesson) {
        return (
            <div className="space-y-4">
                <Link
                    to="/app/training"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-forge-600 dark:hover:text-forge-400"
                >
                    <ArrowLeft size={15} aria-hidden="true" />
                    All tracks
                </Link>
                <EmptyState
                    icon={BookOpen}
                    title="No such lesson"
                    body="That link points at a lesson that is not in the outline. It may not have been written yet."
                />
            </div>
        );
    }

    const checkpoint = CHECKPOINT_META[lesson.checkpoint.verifier];
    const prereqs = prereqsFor(lesson);

    return (
        <div className="space-y-4" data-testid="lesson-detail">
            <Link
                to={`/app/training/${track.id}`}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-forge-600 dark:hover:text-forge-400"
            >
                <ArrowLeft size={15} aria-hidden="true" />
                {track.title}
            </Link>

            <header>
                <p className="text-xs font-bold text-slate-400">
                    {track.code} · Lesson {lesson.id}
                </p>
                <h1 className="mt-0.5 text-2xl font-bold text-slate-800 dark:text-white">
                    {lesson.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Chip icon={Clock}>{formatLearnerTime(lesson.minutes)}</Chip>
                    {lesson.authoring === 'team' && (
                        <Chip icon={PenLine} tone="violet">
                            Your team writes this one
                        </Chip>
                    )}
                    {lesson.gameSpecific && (
                        <Chip icon={CalendarClock} tone="amber">
                            Rewritten every season
                        </Chip>
                    )}
                </div>
            </header>

            {lesson.gatesBuildWork && (
                <div
                    data-testid="gates-build-work"
                    className="flex items-start gap-3 rounded-xl border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 p-3"
                >
                    <AlertTriangle
                        size={18}
                        className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
                        aria-hidden="true"
                    />
                    <p className="text-sm text-red-900 dark:text-red-200">
                        Nobody touches build work before this lesson is signed off.
                    </p>
                </div>
            )}

            <StubNotice />

            <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4">
                <SectionHeader icon={Target} title="What you will be able to do" />
                <p className="text-sm text-slate-600 dark:text-slate-300">{lesson.objective}</p>

                {prereqs.length > 0 && (
                    <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            First
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                            {prereqs.map((prereq) =>
                                prereq.lesson && prereq.track ? (
                                    <Link
                                        key={prereq.id}
                                        to={`/app/training/${prereq.track.id}/${prereq.lesson.id}`}
                                        data-testid={`prereq-${prereq.id}`}
                                        className="rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold text-forge-600 dark:text-forge-400 hover:border-forge-500"
                                    >
                                        {prereq.id} · {prereq.lesson.title}
                                    </Link>
                                ) : (
                                    /*
                                     * A prerequisite in a track nobody has outlined yet. Rendered
                                     * rather than dropped: a lesson that silently loses a
                                     * prerequisite looks like a lesson with none, and today six
                                     * of the eight tracks would do exactly that.
                                     */
                                    <span
                                        key={prereq.id}
                                        data-testid={`prereq-${prereq.id}`}
                                        className="rounded-full border border-dashed border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-400"
                                    >
                                        {prereq.id} · not written yet
                                    </span>
                                ),
                            )}
                        </div>
                    </div>
                )}
            </section>

            <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4">
                <SectionHeader icon={Wrench} title="Hands on" />
                <p className="text-sm text-slate-600 dark:text-slate-300">
                    {lesson.handsOn ?? 'This one is reading and a conversation. Nothing to build.'}
                </p>
            </section>

            <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4">
                <SectionHeader icon={BookOpen} title="The lesson" />
                <div data-testid="lesson-body-empty">
                    <EmptyState
                        icon={PenLine}
                        title="Not written yet"
                        body="This is where the material will be. The outline above is settled; the lesson itself is still to come."
                    />
                </div>
            </section>

            <section
                data-testid="checkpoint"
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4"
            >
                <SectionHeader icon={Users} title="Checkpoint" />
                <p className="text-sm text-slate-600 dark:text-slate-300">
                    {lesson.checkpoint.label}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{checkpoint.who}</p>

                <div className="mt-3">
                    <Button disabled data-testid="checkpoint-action">
                        {canSignOff ? checkpoint.mentorAction : checkpoint.studentAction}
                    </Button>
                    <p
                        data-testid="no-progress-note"
                        className="mt-2 text-xs text-slate-500 dark:text-slate-400"
                    >
                        Nothing is recorded yet. Progress and sign-offs arrive with the lessons.
                    </p>
                </div>

                {canSignOff && (
                    <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Who has done this
                        </p>
                        <EmptyState
                            icon={Users}
                            title="Nobody yet"
                            body="Once progress is recorded, the members who have finished this lesson are listed here."
                            className="py-6"
                        />
                    </div>
                )}
            </section>
        </div>
    );
}

function Chip({
    icon: Icon,
    tone = 'slate',
    children,
}: {
    icon: LucideIcon;
    tone?: 'slate' | 'violet' | 'amber';
    children: ReactNode;
}) {
    const tones = {
        slate: 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400',
        violet: 'border-violet-300 dark:border-violet-500/40 text-violet-600 dark:text-violet-300',
        amber: 'border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300',
    } as const;
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
        >
            <Icon size={13} aria-hidden="true" />
            {children}
        </span>
    );
}
