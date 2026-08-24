import {
    TRAINING_TRACKS,
    type CheckpointVerifier,
    type TrainingLesson,
    type TrainingTrack,
} from './training-curriculum';

/**
 * Reading the training outline — every question the three Training screens ask of it.
 *
 * Separate from `training-curriculum.ts` because that file is data and this one is the rules
 * about it. The screens call these rather than walking `TRAINING_TRACKS` themselves: the track
 * index, a track page and a lesson page all need "how big is this track" and "which lessons
 * come first", and three components each doing their own arithmetic over the same array is the
 * shape principle 9 is about.
 *
 * NOTHING HERE WRITES ANYTHING. D5's stub is presentation only — no progress, no sign-offs, no
 * store slice, no migration. `TrackSummary` counts lessons, not completions, and there is no
 * per-member function in this file because there is no per-member state to read.
 */

export interface TrackSummary {
    /** Lessons written into the outline. Zero for six of the eight tracks today. */
    outlined: number;
    /** Lessons the design proposes, which is what an un-outlined track has to show instead. */
    planned: number;
    /** Learner minutes across the outlined lessons, or null when none are outlined. */
    minutes: number | null;
    /** Outlined lessons an adult has to sign off — the load a track puts on the mentors. */
    mentorCheckpoints: number;
    hasOutline: boolean;
}

export function findTrack(trackId?: string): TrainingTrack | undefined {
    return TRAINING_TRACKS.find((t) => t.id === trackId);
}

export function findLesson(trackId?: string, lessonId?: string): TrainingLesson | undefined {
    return findTrack(trackId)?.lessons.find((l) => l.id === lessonId);
}

/**
 * Which track a lesson id belongs to, searched across all of them.
 *
 * Prerequisites cross tracks — the design has `E4` waiting on `D6` — so a lesson page cannot
 * resolve its own prerequisites inside its own track. Returns undefined for a prerequisite in a
 * track that has no outline yet, which is the common case today and is rendered as such rather
 * than dropped: a prerequisite that silently disappears is a lesson that looks like it has none.
 */
export function locateLesson(
    lessonId: string,
): { track: TrainingTrack; lesson: TrainingLesson } | undefined {
    for (const track of TRAINING_TRACKS) {
        const lesson = track.lessons.find((l) => l.id === lessonId);
        if (lesson) return { track, lesson };
    }
    return undefined;
}

/** The track a lesson id claims by its prefix, whether or not that track is outlined yet. */
export function trackForLessonId(lessonId: string): TrainingTrack | undefined {
    const code = lessonId.charAt(0).toUpperCase();
    return TRAINING_TRACKS.find((t) => t.code === code);
}

export function trackSummary(track: TrainingTrack): TrackSummary {
    const outlined = track.lessons.length;
    return {
        outlined,
        planned: track.plannedLessons,
        // Null rather than 0: "0 minutes of training" reads as a claim about the material, and
        // the material does not exist yet. The screens print the planned count instead.
        minutes: outlined === 0 ? null : track.lessons.reduce((sum, l) => sum + l.minutes, 0),
        mentorCheckpoints: track.lessons.filter(
            (l) => l.checkpoint.verifier === 'mentor' || l.checkpoint.verifier === 'coach',
        ).length,
        hasOutline: outlined > 0,
    };
}

export interface ResolvedPrereq {
    id: string;
    /** Present only when that lesson is outlined. Absent means "planned, not written". */
    lesson?: TrainingLesson;
    /** The track it lives in, resolvable from the id prefix even with no outline. */
    track?: TrainingTrack;
}

export function prereqsFor(lesson: TrainingLesson): ResolvedPrereq[] {
    return lesson.prereqIds.map((id) => {
        const found = locateLesson(id);
        return found
            ? { id, lesson: found.lesson, track: found.track }
            : { id, track: trackForLessonId(id) };
    });
}

/**
 * What each checkpoint verifier means, said once.
 *
 * `who` is the sentence a student reads; `action` is what the button would say when there is
 * something behind it. Both live here rather than in the lesson page so that adding a verifier
 * is one edit — and so that the student and mentor sides of the same lesson cannot drift into
 * describing the same checkpoint differently.
 */
export const CHECKPOINT_META: Record<
    CheckpointVerifier,
    { who: string; studentAction: string; mentorAction: string }
> = {
    self: { who: 'You mark this one yourself.', studentAction: 'Mark complete', mentorAction: 'Mark complete' },
    quiz: { who: 'A short quiz marks itself.', studentAction: 'Start the quiz', mentorAction: 'Start the quiz' },
    mentor: { who: 'A mentor signs this off.', studentAction: 'Ask for a sign-off', mentorAction: 'Sign off' },
    coach: { who: 'A coach signs this off.', studentAction: 'Ask for a sign-off', mentorAction: 'Sign off' },
    auto: {
        who: 'The app records this one for you.',
        studentAction: 'Recorded automatically',
        mentorAction: 'Recorded automatically',
    },
};

/** Learner time, read the way a person says it: `45 min`, `1 h`, `2 h 10 min`. */
export function formatLearnerTime(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** The two numbers the track index leads with: how much is written, how much is planned. */
export function outlineTotals(): { outlined: number; planned: number } {
    return TRAINING_TRACKS.reduce(
        (totals, track) => ({
            outlined: totals.outlined + track.lessons.length,
            planned: totals.planned + track.plannedLessons,
        }),
        { outlined: 0, planned: 0 },
    );
}
