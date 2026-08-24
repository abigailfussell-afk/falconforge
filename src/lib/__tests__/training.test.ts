/**
 * The training outline holds together, and the screens can trust it (D5).
 *
 * The Training stub renders data rather than computing much, which makes the interesting
 * failures *data* failures: a prerequisite pointing at a lesson id that does not exist, a
 * planned-lesson count that stops matching the lessons underneath it, a lesson filed in the
 * wrong track. None of those throw. Each of them renders a page that looks fine and is wrong —
 * `docs/failure-modes.md` section 7 — so they are assertions here rather than a hope.
 *
 * WHAT WOULD MAKE THESE FAIL: editing `training-curriculum.ts`. Every one was watched red by
 * mutating the outline (a bad prereq id, a lesson added without moving `plannedLessons`, a
 * lesson moved between tracks) and by reverting the selectors.
 */
import { describe, it, expect } from 'vitest';
import { TRAINING_TRACKS } from '../training-curriculum';
import {
    CHECKPOINT_META,
    findLesson,
    findTrack,
    formatLearnerTime,
    locateLesson,
    outlineTotals,
    prereqsFor,
    trackForLessonId,
    trackSummary,
} from '../training';

const ALL_LESSONS = TRAINING_TRACKS.flatMap((t) => t.lessons);

describe('the outline is internally consistent', () => {
    it('has unique track ids, track codes and lesson ids', () => {
        const ids = TRAINING_TRACKS.map((t) => t.id);
        const codes = TRAINING_TRACKS.map((t) => t.code);
        const lessonIds = ALL_LESSONS.map((l) => l.id);

        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(codes).size).toBe(codes.length);
        expect(new Set(lessonIds).size).toBe(lessonIds.length);
    });

    it('files every lesson in the track its id claims', () => {
        // `A3` living in Safety would render under the wrong heading and break every prereq
        // link that resolves by prefix. Nothing else notices.
        for (const track of TRAINING_TRACKS) {
            for (const lesson of track.lessons) {
                expect(lesson.id.charAt(0), `${lesson.id} is not in track ${track.code}`).toBe(
                    track.code,
                );
            }
        }
    });

    it('keeps `plannedLessons` honest', () => {
        /*
         * The number an un-outlined track shows instead of its lessons. A lesson added to a
         * track without moving this count turns "10 lessons planned" into a quiet lie on the
         * one screen whose whole job is to say how much is missing.
         */
        for (const track of TRAINING_TRACKS) {
            expect(track.plannedLessons, `${track.title} plans no lessons`).toBeGreaterThan(0);
            if (track.lessons.length > 0) {
                expect(track.plannedLessons, `${track.title} count vs lessons`).toBe(
                    track.lessons.length,
                );
            }
        }
    });

    it('resolves every prerequisite, or names a track that is not written yet', () => {
        /*
         * Prerequisites cross tracks — the design has E4 waiting on D6 — so this cannot demand
         * that every prereq is outlined today. What it CAN demand is that the id is well
         * formed, names a real track, and resolves whenever that track has been written. That
         * is the shape that fails on a typo (`A9`, `B10`) while still allowing the six
         * un-outlined tracks to be referenced.
         */
        for (const lesson of ALL_LESSONS) {
            for (const prereqId of lesson.prereqIds) {
                expect(prereqId, `${lesson.id} prereq shape`).toMatch(/^[A-Z]\d{1,2}$/);

                const track = trackForLessonId(prereqId);
                expect(track, `${lesson.id} needs ${prereqId}, whose track does not exist`).toBeDefined();

                if (track!.lessons.length > 0) {
                    expect(
                        locateLesson(prereqId),
                        `${lesson.id} needs ${prereqId}, which is not in the outlined track ${track!.code}`,
                    ).toBeDefined();
                }
            }
        }
    });

    it('never has a lesson wait on itself or on something later in its own track', () => {
        // A cycle inside a track would be a rookie told to do A2 before A2. Cross-track order
        // is the design's business; within a track the numbers are the order.
        for (const lesson of ALL_LESSONS) {
            const ordinal = Number(lesson.id.slice(1));
            for (const prereqId of lesson.prereqIds) {
                expect(prereqId).not.toBe(lesson.id);
                if (prereqId.charAt(0) === lesson.id.charAt(0)) {
                    expect(Number(prereqId.slice(1)), `${lesson.id} waits on ${prereqId}`).toBeLessThan(
                        ordinal,
                    );
                }
            }
        }
    });

    it('gives every lesson a positive learner time', () => {
        for (const lesson of ALL_LESSONS) {
            expect(lesson.minutes, `${lesson.id} takes no time`).toBeGreaterThan(0);
        }
    });
});

describe('trackSummary', () => {
    it('counts an outlined track', () => {
        const summary = trackSummary(findTrack('onboarding')!);

        expect(summary).toEqual({
            outlined: 7,
            planned: 7,
            minutes: 170,
            // A2 and A7 are coach sign-offs, A4 and A5 mentor ones. The other three mark
            // themselves, and this number is what tells a coach what a track costs THEM.
            mentorCheckpoints: 4,
            hasOutline: true,
        });
    });

    it('reports null minutes rather than zero for a track with no outline', () => {
        /*
         * `0 minutes of training` reads as a claim about the material; the material does not
         * exist. The index prints the planned count instead, and it can only do that if this
         * distinction survives the selector.
         */
        const summary = trackSummary(findTrack('mechanical')!);

        expect(summary.minutes).toBeNull();
        expect(summary.hasOutline).toBe(false);
        expect(summary.outlined).toBe(0);
        expect(summary.planned).toBe(10);
    });
});

describe('finding things', () => {
    it('will not find a lesson under the wrong track', () => {
        // `/app/training/safety/A1` is a wrong URL, not a redirect. Resolving it would render
        // an Onboarding lesson under the Safety heading with a Safety back link.
        expect(findLesson('onboarding', 'A1')?.title).toBe('What FTC is');
        expect(findLesson('safety', 'A1')).toBeUndefined();
    });

    it('locates a lesson across tracks for prerequisite links', () => {
        expect(locateLesson('B1')?.track.id).toBe('safety');
        // A prerequisite in a track nobody has written yet: no lesson, but the track is known,
        // which is what lets the page render "E4 · not written yet" instead of dropping it.
        expect(locateLesson('E4')).toBeUndefined();
        expect(trackForLessonId('E4')?.id).toBe('programming');
        expect(trackForLessonId('Z1')).toBeUndefined();
    });

    it('resolves prerequisites to their lesson and track', () => {
        const [first] = prereqsFor(findLesson('onboarding', 'A7')!);

        expect(first.id).toBe('A6');
        expect(first.lesson?.title).toBe('Tools of the team');
        expect(first.track?.id).toBe('onboarding');
    });

    it('has no prerequisites for the first lesson of each written track', () => {
        expect(prereqsFor(findLesson('onboarding', 'A1')!)).toEqual([]);
        expect(prereqsFor(findLesson('safety', 'B1')!)).toEqual([]);
    });
});

describe('the two numbers the index leads with', () => {
    it('adds up what is written and what is planned', () => {
        // Eleven of sixty-one. The gap IS the message on that screen.
        expect(outlineTotals()).toEqual({ outlined: 11, planned: 61 });
    });
});

describe('checkpoint wording', () => {
    it('says something different to a student and a mentor only where a person signs off', () => {
        /*
         * The lesson page's whole student/mentor difference is this table. A quiz marks itself
         * whoever is looking at it; a sign-off is asked for by one person and given by another.
         */
        for (const verifier of ['mentor', 'coach'] as const) {
            expect(CHECKPOINT_META[verifier].studentAction).not.toBe(
                CHECKPOINT_META[verifier].mentorAction,
            );
        }
        for (const verifier of ['quiz', 'auto', 'self'] as const) {
            expect(CHECKPOINT_META[verifier].studentAction).toBe(
                CHECKPOINT_META[verifier].mentorAction,
            );
        }
    });
});

describe('formatLearnerTime', () => {
    it('reads the way a person says it', () => {
        expect(formatLearnerTime(10)).toBe('10 min');
        expect(formatLearnerTime(45)).toBe('45 min');
        expect(formatLearnerTime(60)).toBe('1 h');
        expect(formatLearnerTime(95)).toBe('1 h 35 min');
        expect(formatLearnerTime(170)).toBe('2 h 50 min');
    });
});
