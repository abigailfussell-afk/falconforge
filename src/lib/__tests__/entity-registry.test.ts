/**
 * Round D — the round-trip property.
 *
 *     fromRemote(toRemote(x)) deep-equals x
 *
 * This is the test the registry exists to make possible. Three bugs were the same defect
 * wearing different hats -- a field carried in one direction and not the other:
 *
 *   B9  matchPlan.partnerAutonomous / partnerPark : read, never written
 *   B10 matchPlan.matchNumber                     : written from a nonexistent property
 *   B17 task.archivedAt                           : no column at all
 *
 * Each was invisible until someone noticed a value reverting after a sync. With one
 * definition per entity, adding a field to only one direction fails here immediately --
 * which is worth more than the three fixes, because it catches the fourth one.
 */
import { describe, it, expect } from 'vitest';
import {
    ENTITIES,
    SYNCED_ENTITIES,
    PULL_ONLY_ENTITIES,
    findEntity,
    toEpochMillis,
    toISO,
} from '@/lib/entity-registry';
import type { Task, ScoutingReport, MatchPlan, Season, SubTeam, TeamMember } from '@/types';

/** Contextual fields the server needs but the local types do not carry. */
const CTX = { teamId: 'team-1', seasonId: 'season-1' };

const task: Task = {
    id: 'task-1',
    title: 'Rebuild the intake',
    description: 'It jams on the third cone',
    status: 'In Progress',
    type: 'Bug',
    assignedTo: 'member-1',
    department: 'subteam-1',
    tags: ['build', 'urgent'],
    checklist: [{ id: 'c1', text: 'Print bracket', completed: true }],
    timeline: [{ id: 'e1', type: 'comment', authorId: 'member-1', content: 'On it', timestamp: 1700 }],
    createdAt: 1000,
    dueDate: 2000,
    archivedAt: 3000,
    seasonId: 'season-1',
};

const season: Season = {
    id: 'season-1',
    name: '2025-2026 Season',
    // Sprint 4. Both directions, or the round-trip below fails — which is the point.
    gameTitle: 'DECODE',
    teamId: 'team-1',
    fieldImageData: 'data:image/png;base64,AAAA',
    isArchived: true,
    createdAt: 1000,
};

const subTeam: SubTeam = {
    id: 'subteam-1',
    name: 'Build',
    memberIds: ['member-1', 'member-2'],
    seasonId: 'season-1',
};

const scoutingReport: ScoutingReport = {
    id: 'report-1',
    teamNumber: '12345',
    matchNumber: 7,
    eventName: 'League Meet 2',
    hasAutonomous: true,
    autoScore: 24,
    intakeType: 'Automatic',
    autoAim: true,
    farShooting: false,
    shotsTaken: 12,
    shotsMissed: 3,
    parking: 'Full Park',
    rating: 4,
    endGameNotes: 'Strong driver, slow cycle',
    createdBy: 'member-1',
    seasonId: 'season-1',
    createdAt: undefined, // server-assigned; absent on a locally-created record
};

const matchPlan: MatchPlan = {
    id: 'plan-1',
    title: 'Quals 14',
    matchNumber: 14,
    drawingData: { paths: [[1, 2], [3, 4]] },
    notes: 'Start left, park centre',
    allianceTeam: '54321',
    partnerAutonomous: true,
    partnerPark: true,
    updatedAt: 0, // server-assigned
    seasonId: 'season-1',
};

const teamMember: TeamMember = {
    id: 'member-1',
    teamId: 'team-1',
    userId: 'user-1',
    role: 'mentor',
    status: 'approved',
    managedProfileId: null,
    seatAssigned: true,
    fullName: 'Sam Rivera',
    email: 'sam@example.com',
    avatarUrl: 'https://example.com/sam.png',
    joinedAt: 0, // server-assigned
};

const SAMPLES: Record<string, any> = {
    tasks: task,
    seasons: season,
    sub_teams: subTeam,
    scouting_reports: scoutingReport,
    match_plans: matchPlan,
    team_members: teamMember,
};

describe('every entity survives a round trip', () => {
    for (const entity of ENTITIES) {
        it(`${entity.remoteTable}: fromRemote(toRemote(x)) === x`, () => {
            const local = SAMPLES[entity.remoteTable];
            expect(local, `no sample defined for ${entity.remoteTable}`).toBeDefined();

            const row = entity.toRemote({ ...local, ...CTX });
            const back: any = entity.fromRemote(row);

            // Server-assigned fields (created_at defaults, updated_at triggers) cannot
            // survive a client round trip by design -- toRemote omits them so the client
            // never overwrites the authoritative value. Everything else must.
            const strip = (obj: any) => {
                const copy = { ...obj };
                for (const field of entity.serverAssigned) delete copy[field as string];
                return copy;
            };

            expect(strip(back)).toEqual(strip(local));
        });
    }
});

describe('the specific fields that used to be dropped', () => {
    it('match plan keeps partnerAutonomous and partnerPark (B9)', () => {
        const mp = findEntity('match_plans')!;
        const row = mp.toRemote({ ...matchPlan, ...CTX });

        expect(row.partner_autonomous).toBe(true);
        expect(row.partner_park).toBe(true);
        expect(mp.fromRemote(row).partnerAutonomous).toBe(true);
        expect(mp.fromRemote(row).partnerPark).toBe(true);
    });

    it('match plan writes a real match_number (B10)', () => {
        const mp = findEntity('match_plans')!;
        const row = mp.toRemote({ ...matchPlan, ...CTX });

        // Previously always null: the writer read `data.matchNumber` from a type with no
        // such property.
        expect(row.match_number).toBe(14);
    });

    it('task keeps archivedAt (B17)', () => {
        const t = findEntity('tasks')!;
        const row = t.toRemote({ ...task, ...CTX });

        expect(row.archived_at).toBe(new Date(3000).toISOString());
        expect(t.fromRemote(row).archivedAt).toBe(3000);
    });
});

describe('date coercion is consistent across entities (B11)', () => {
    it('turns null and undefined into undefined, never NaN', () => {
        expect(toEpochMillis(null)).toBeUndefined();
        expect(toEpochMillis(undefined)).toBeUndefined();
        expect(toEpochMillis('')).toBeUndefined();
        expect(toEpochMillis('not-a-date')).toBeUndefined();
    });

    it('round-trips a real timestamp', () => {
        const iso = '2026-03-01T10:00:00.000Z';
        expect(toISO(toEpochMillis(iso)!)).toBe(iso);
    });

    it('never produces NaN for a missing date on any entity', () => {
        for (const entity of ENTITIES) {
            const back: any = entity.fromRemote({ id: 'x', data: {} });
            for (const [key, value] of Object.entries(back)) {
                expect(Number.isNaN(value as number), `${entity.remoteTable}.${key} is NaN`)
                    .toBe(false);
            }
        }
    });
});

describe('pull-only entities are never pushable', () => {
    // sync.ts builds the set of tables the offline queue may touch from SYNCED_ENTITIES.
    // A pull-only entity leaking into that list would make the queue able to push rows the
    // client has no business writing.
    it('keeps SYNCED and PULL_ONLY disjoint', () => {
        const synced = new Set(SYNCED_ENTITIES.map((e) => e.remoteTable));
        for (const entity of PULL_ONLY_ENTITIES) {
            expect(synced.has(entity.remoteTable), `${entity.remoteTable} is pushable`).toBe(false);
        }
    });

    it('ENTITIES is exactly the two lists together', () => {
        expect(ENTITIES.map((e) => e.remoteTable)).toEqual([
            ...SYNCED_ENTITIES.map((e) => e.remoteTable),
            ...PULL_ONLY_ENTITIES.map((e) => e.remoteTable),
        ]);
    });

    it('team_members is pull-only', () => {
        expect(PULL_ONLY_ENTITIES.map((e) => e.remoteTable)).toContain('team_members');
    });
});

describe('team_members narrows server strings instead of casting them', () => {
    // The inline transform this replaced wrote `role: m.role as any`, so a value outside
    // the union flowed straight into code that compares against role literals.
    const members = findEntity('team_members')!;

    it('keeps a role it recognises', () => {
        expect(members.fromRemote({ id: 'm', role: 'coach' }).role).toBe('coach');
        expect(members.fromRemote({ id: 'm', role: 'admin' }).role).toBe('admin');
        expect(members.fromRemote({ id: 'm', role: 'mentor' }).role).toBe('mentor');
    });

    it('falls back to the least-privileged role for anything else', () => {
        expect(members.fromRemote({ id: 'm', role: 'superuser' }).role).toBe('student');
        // 'assistant_coach' is a V1 role that no longer exists. A client that has not been
        // reloaded since the schema changed must not treat it as elevated.
        expect(members.fromRemote({ id: 'm', role: 'assistant_coach' }).role).toBe('student');
        expect(members.fromRemote({ id: 'm', role: null }).role).toBe('student');
        expect(members.fromRemote({ id: 'm' }).role).toBe('student');
    });

    it('treats an unrecognised status as not-yet-approved', () => {
        expect(members.fromRemote({ id: 'm', status: 'approved' }).status).toBe('approved');
        expect(members.fromRemote({ id: 'm', status: 'banned' }).status).toBe('pending');
    });
});

describe('lookup accepts either naming convention (B16)', () => {
    it('resolves the same definition from snake_case and camelCase', () => {
        expect(findEntity('scouting_reports')).toBe(findEntity('scoutingReports'));
        expect(findEntity('sub_teams')).toBe(findEntity('subTeams'));
        expect(findEntity('match_plans')).toBe(findEntity('matchPlans'));
    });

    it('returns undefined for something not in the registry', () => {
        // checklists are deliberately absent -- blob-synced, no per-record identity.
        expect(findEntity('checklists')).toBeUndefined();
        expect(findEntity('nonsense')).toBeUndefined();
    });
});
