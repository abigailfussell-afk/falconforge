/**
 * The training outline — tracks and lessons, with no lessons written.
 *
 * WHAT THIS FILE IS, AND DELIBERATELY IS NOT (D5)
 *
 * D5 was answered as a split on 2026-08-23: **the content is deferred, the presentation is
 * not.** The material will be generated later from FTC and REV Robotics documentation; what
 * Kevin asked for now is the SHAPE — how training is navigated, what a unit and a lesson are,
 * what a student sees versus a mentor, and how progress would be recorded — settled while
 * there is nothing to present, because that is cheaper to move than a shape settled around
 * real content.
 *
 * So this is an outline and not a curriculum. Every field here describes a lesson; no field
 * here IS one. There is no body, no quiz, no media, and no pipeline that would produce them.
 *
 * WHY ONLY TWO TRACKS CARRY LESSONS. The decision's words are "a small amount of
 * representative placeholder content". Tracks A and B are outlined in full — eleven lessons —
 * because between them they exercise every shape the screens have to render: all five
 * checkpoint verifiers, a team-authored lesson, a lesson that changes every season, a lesson
 * that gates other work, prerequisite chains, and lessons with no hands-on task. The remaining
 * six tracks carry their planned lesson count and no lessons, which is what makes the empty
 * states real rather than hypothetical — they are what six of the eight tracks actually show.
 *
 * The counts and the eleven outlined lessons are transcribed from section 2.1 of
 * `docs/assessment-2026-08/training-onboarding-design.md`; none of it is newly authored here.
 */

/** Who confirms a lesson is finished. The design's `checkpoint.verifier`. */
export type CheckpointVerifier = 'self' | 'quiz' | 'mentor' | 'coach' | 'auto';

export interface TrainingCheckpoint {
    verifier: CheckpointVerifier;
    /** What the verifier actually does, in the team's words. */
    label: string;
}

export interface TrainingLesson {
    /** The design's module id, e.g. `A1`. Shown to people, so it is not an internal name. */
    id: string;
    title: string;
    /** What a student can do afterwards. The design calls this the objective. */
    objective: string;
    /** Module ids that come first. May name a lesson in another track. */
    prereqIds: string[];
    /** Learner time, excluding the hands-on build. */
    minutes: number;
    /** The part they do with their hands. Absent for the few lessons that are reading only. */
    handsOn?: string;
    checkpoint: TrainingCheckpoint;
    /**
     * `team` means the team writes this one themselves against a template — their handbook,
     * their shop, their tools. It is not content FalconForge can ship for them, which is why
     * it is a property of the outline rather than a gap in it.
     */
    authoring: 'core' | 'team';
    /** Rewritten every season, because the game changes. The design's `GS`. */
    gameSpecific?: boolean;
    /** Nobody touches build work until this one is signed off. Only B1 today. */
    gatesBuildWork?: boolean;
}

export interface TrainingTrack {
    /** URL segment. Spelled for a person reading the address bar, not `a`. */
    id: string;
    /** The design's track letter, and the prefix of every lesson id in it. */
    code: string;
    title: string;
    summary: string;
    /**
     * How many lessons the design proposes for this track.
     *
     * Held separately from `lessons.length` so an un-outlined track can say how big it will be
     * — "ten lessons planned" is the honest empty state and "no lessons" is not. Where the
     * track IS outlined the two must agree, which `training.test.ts` asserts: a lesson added
     * without moving the count would otherwise quietly make this number a lie.
     */
    plannedLessons: number;
    lessons: TrainingLesson[];
}

const TRACK_A: TrainingLesson[] = [
    {
        id: 'A1',
        title: 'What FTC is',
        objective:
            'Explain the season arc from kickoff to championship, the parts of a match, and what an alliance is.',
        prereqIds: [],
        minutes: 30,
        handsOn: 'Watch one match from last season and write three sentences on what scored.',
        checkpoint: { verifier: 'quiz', label: 'Five questions' },
        authoring: 'core',
    },
    {
        id: 'A2',
        title: 'This team',
        objective:
            'Name the roles and sub-teams, know the meeting cadence, and know how the team makes decisions.',
        prereqIds: ['A1'],
        minutes: 20,
        handsOn: 'Read the team handbook and find your sub-team on the roster.',
        checkpoint: { verifier: 'coach', label: 'A conversation with your coach' },
        authoring: 'team',
    },
    {
        id: 'A3',
        title: 'Gracious Professionalism and Youth Protection',
        objective:
            'State what Gracious Professionalism and Coopertition mean here, and know which adults are which.',
        prereqIds: [],
        minutes: 15,
        checkpoint: { verifier: 'quiz', label: 'Five questions' },
        authoring: 'core',
    },
    {
        id: 'A4',
        title: 'How a match is scored',
        objective: 'Read this season’s scoring summary and work out what a match was worth.',
        prereqIds: ['A1'],
        minutes: 40,
        handsOn: 'Score a recorded match by hand.',
        checkpoint: {
            verifier: 'mentor',
            label: 'A mentor checks your sheet against the official score',
        },
        authoring: 'core',
        gameSpecific: true,
    },
    {
        id: 'A5',
        title: 'The engineering portfolio',
        objective: 'Explain what judges look for, and make your first notebook entry.',
        prereqIds: ['A2'],
        minutes: 30,
        handsOn: 'Write one dated entry about something you did.',
        checkpoint: { verifier: 'mentor', label: 'A mentor reads the entry' },
        authoring: 'core',
    },
    {
        id: 'A6',
        title: 'Tools of the team',
        objective: 'Use the team’s files and the FalconForge board, and raise a task of your own.',
        prereqIds: ['A2'],
        minutes: 15,
        handsOn: 'Create a task on the sprint board.',
        checkpoint: { verifier: 'auto', label: 'Recorded for you once the task exists' },
        authoring: 'core',
    },
    {
        id: 'A7',
        title: 'Agile in one page',
        objective: 'Explain sprint, backlog, stand-up and retro as this team runs them.',
        prereqIds: ['A6'],
        minutes: 20,
        handsOn: 'Join one stand-up and move your task.',
        checkpoint: { verifier: 'coach', label: 'Your coach signs it off at the stand-up' },
        authoring: 'core',
    },
];

const TRACK_B: TrainingLesson[] = [
    {
        id: 'B1',
        title: 'Shop safety basics',
        objective:
            'Eye protection, hair and jewellery, and which tools you may pick up and which you may not.',
        prereqIds: [],
        minutes: 20,
        handsOn: 'Walk the shop with a mentor. Find the first-aid kit and the cut-off switch.',
        checkpoint: {
            verifier: 'mentor',
            label: 'A mentor signs this off before you touch any build work',
        },
        authoring: 'core',
        gatesBuildWork: true,
    },
    {
        id: 'B2',
        title: 'Battery and electrical safety',
        objective:
            'Handle the team’s battery packs and chargers without hurting anybody or anything.',
        prereqIds: ['B1'],
        minutes: 20,
        handsOn: 'Inspect a battery and its charger, and log the condition.',
        checkpoint: { verifier: 'mentor', label: 'A mentor checks the log with you' },
        authoring: 'core',
    },
    {
        id: 'B3',
        title: 'Power tools',
        objective:
            'Use the drill, the saw and the rotary tool the team owns, safely and under supervision.',
        prereqIds: ['B1'],
        minutes: 45,
        handsOn: 'A supervised cut and a supervised hole, in scrap.',
        checkpoint: { verifier: 'mentor', label: 'A mentor signs off each tool separately' },
        authoring: 'core',
    },
    {
        id: 'B4',
        title: 'Robot handling at events',
        objective: 'Pit etiquette, lifting the robot, and disabling it when something goes wrong.',
        prereqIds: ['B1'],
        minutes: 10,
        checkpoint: { verifier: 'quiz', label: 'Five questions' },
        authoring: 'core',
    },
];

export const TRAINING_TRACKS: TrainingTrack[] = [
    {
        id: 'onboarding',
        code: 'A',
        title: 'Onboarding',
        summary: 'What FTC is, what this team is, and how the season runs. Everybody starts here.',
        plannedLessons: TRACK_A.length,
        lessons: TRACK_A,
    },
    {
        id: 'safety',
        code: 'B',
        title: 'Safety',
        summary: 'The shop, the batteries, the tools and the pit. Before anybody builds anything.',
        plannedLessons: TRACK_B.length,
        lessons: TRACK_B,
    },
    {
        id: 'mechanical',
        code: 'C',
        title: 'Mechanical',
        summary: 'Kit anatomy, fasteners, drivetrains, transmission, intakes, slides, arms and CAD.',
        plannedLessons: 10,
        lessons: [],
    },
    {
        id: 'electrical',
        code: 'D',
        title: 'Electrical and control system',
        summary: 'Hubs, wiring, motors, servos, sensors, hardware configuration and troubleshooting.',
        plannedLessons: 8,
        lessons: [],
    },
    {
        id: 'programming',
        code: 'E',
        title: 'Programming',
        summary: 'Java, OpModes, TeleOp, sensors, autonomous, PID, odometry and vision.',
        plannedLessons: 16,
        lessons: [],
    },
    {
        id: 'strategy',
        code: 'F',
        title: 'Strategy and scouting',
        summary: 'Reading the manual, scoring maths, scouting, alliance selection and the drive team.',
        plannedLessons: 5,
        lessons: [],
    },
    {
        id: 'outreach',
        code: 'G',
        title: 'Outreach and judging',
        summary: 'Awards, the portfolio, the judging interview, outreach, media and sponsorship.',
        plannedLessons: 6,
        lessons: [],
    },
    {
        id: 'operations',
        code: 'H',
        title: 'Team operations',
        summary: 'Running a sprint, estimating, attendance, leading a sub-team and season handover.',
        plannedLessons: 5,
        lessons: [],
    },
];
