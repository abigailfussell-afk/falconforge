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
    GUARDIAN_ENTITIES,
    PULL_ONLY_ENTITIES,
    RLS_SCOPED_ENTITIES,
    findEntity,
    toEpochMillis,
    toISO,
} from '@/lib/entity-registry';
import type {
    Task,
    ScoutingReport,
    MatchPlan,
    Season,
    SubTeam,
    TeamMember,
    Meeting,
    MeetingAttendance,
    ManagedProfile,
    GuardianConsent,
} from '@/types';

/** Contextual fields the server needs but the local types do not carry. */
const CTX = { teamId: 'team-1', seasonId: 'season-1' };

/**
 * The tenant now survives the round trip, and the samples say so.
 *
 * `fromRemote` used to drop `team_id`, so a local record could not say which team it belonged
 * to and a queued task stayed on the board after a team switch (SYNC-15). Adding `teamId` to
 * each sample is what makes this suite assert the new symmetry rather than tolerate it: with
 * the field absent from the sample the round trip would be comparing a 13-key object to a
 * 12-key one, which is the asymmetry this whole file exists to catch.
 */
const TENANT = { teamId: CTX.teamId };

const task: Task = {
    ...TENANT,
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
    ...TENANT,
    id: 'subteam-1',
    name: 'Build',
    memberIds: ['member-1', 'member-2'],
    seasonId: 'season-1',
};

const scoutingReport: ScoutingReport = {
    ...TENANT,
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
    ...TENANT,
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

const meeting: Meeting = {
    ...TENANT,
    id: 'meeting-1',
    title: 'Build session — chassis rebuild',
    description: 'Bring the spare motors',
    location: 'Room 214 — engineering lab',
    eventType: 'build',
    publicCode: '0842',
    attendanceRequired: true,
    startsAt: 1_760_000_000_000,
    endsAt: 1_760_009_000_000,
    // Set explicitly, because the round trip has to prove an OVERRIDE survives. The default
    // window is the `undefined` case and is covered in `checkin-window.test.ts`.
    checkinOpensAt: 1_759_999_100_000,
    checkinClosesAt: 1_760_009_000_000,
    recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;UNTIL=20261214',
    seriesId: 'series-1',
    createdBy: 'member-1',
    seasonId: 'season-1',
};

const meetingAttendance: MeetingAttendance = {
    ...TENANT,
    id: 'attendance-1',
    meetingId: 'meeting-1',
    teamMemberId: 'member-1',
    status: 'excused',
    method: 'coach',
    notes: 'Family trip',
    attestedBy: 'member-2',
    attestedAt: 1_760_000_400_000,
};

const managedProfile: ManagedProfile = {
    id: 'profile-1',
    guardianUserId: 'user-guardian-1',
    fullName: 'Robin Fussell',
    notes: 'Peanut allergy. Collected by an aunt on Thursdays.',
    // Server-written, client-readable: a claim code the client is refused permission to set.
    // Declared `serverAssigned`, so the round trip strips it rather than expecting it back.
    promotionCode: 'QRST7788',
    createdAt: undefined, // server-assigned; absent on a locally-created record
};

const guardianConsent: GuardianConsent = {
    id: 'consent-1',
    managedProfileId: 'profile-1',
    guardianUserId: 'user-guardian-1',
    consentType: 'coppa_data_collection',
    // A number that is nobody's default, so a `?? '1.0'` creeping into either direction shows
    // up here as a changed value rather than as a coincidence.
    version: '3.1',
    consentedAt: undefined, // server-assigned
};

const team = {
    id: 'team-1',
    name: 'Iron Falcons',
    teamNumber: '12345',
    // Server-owned: `teams_insert_owner` checks `owner_id = auth.uid()`, so `toRemote` does not
    // send it and the round trip cannot carry it. Empty is what `fromRemote` produces for a row
    // that did not include the column.
    ownerId: '',
    createdAt: undefined as unknown as number, // server-assigned
};

const SAMPLES: Record<string, any> = {
    teams: team,
    managed_profiles: managedProfile,
    guardian_consents: guardianConsent,
    tasks: task,
    meetings: meeting,
    meeting_attendance: meetingAttendance,
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

describe('the fields a meeting must never lose', () => {
    it('writes an empty code as NULL rather than an empty string', () => {
        // `public_code` has a four-digit CHECK and a partial unique index excluding NULLs.
        // `''` fails the first and would collide on the second, so "no check-in" has to be
        // NULL — and this is the direction that would have been wrong silently.
        const m = findEntity('meetings')!;
        const row = m.toRemote({ ...meeting, publicCode: '', ...CTX });

        expect(row.public_code).toBeNull();
        expect(m.fromRemote(row).publicCode).toBe('');
    });

    it('leaves a default check-in window as NULL in both directions', () => {
        // NULL means "derive it". Writing the derived value would make every meeting
        // permanently overridden the first time somebody saved it, so moving the meeting
        // would stop moving the window.
        const m = findEntity('meetings')!;
        const row = m.toRemote({
            ...meeting,
            checkinOpensAt: undefined,
            checkinClosesAt: undefined,
            ...CTX,
        });

        expect(row.checkin_opens_at).toBeNull();
        expect(row.checkin_closes_at).toBeNull();
        expect(m.fromRemote(row).checkinOpensAt).toBeUndefined();
        expect(m.fromRemote(row).checkinClosesAt).toBeUndefined();
    });

    it('keeps the series link and the rule together', () => {
        const m = findEntity('meetings')!;
        const row = m.toRemote({ ...meeting, ...CTX });

        expect(row.series_id).toBe('series-1');
        expect(row.recurrence_rule).toBe('FREQ=WEEKLY;INTERVAL=1;UNTIL=20261214');
    });

    it('narrows an unrecognised status to excused rather than absent', () => {
        // Falling back to `absent` would be a LIE about a person. `excused` counts neither
        // for nor against anybody, which is the only safe default for this column.
        const a = findEntity('meeting_attendance')!;
        expect(a.fromRemote({ id: 'x', status: 'late' }).status).toBe('excused');
        expect(a.fromRemote({ id: 'x', status: 'absent' }).status).toBe('absent');
    });

    it('records the method a status was set by', () => {
        const a = findEntity('meeting_attendance')!;
        expect(a.toRemote({ ...meetingAttendance, method: 'qr', ...CTX }).method).toBe('qr');
        expect(a.fromRemote({ id: 'x', method: 'nonsense' }).method).toBe('coach');
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

    it('ENTITIES is exactly the four lists together', () => {
        expect(ENTITIES.map((e) => e.remoteTable)).toEqual([
            ...SYNCED_ENTITIES.map((e) => e.remoteTable),
            ...GUARDIAN_ENTITIES.map((e) => e.remoteTable),
            ...PULL_ONLY_ENTITIES.map((e) => e.remoteTable),
            ...RLS_SCOPED_ENTITIES.map((e) => e.remoteTable),
        ]);
    });

    /*
     * `teams` must not reach the realtime subscription or the sync loop's pull list, both of
     * which are derived from SYNCED_ENTITIES and both of which filter on `team_id` -- a column
     * `teams` does not have. A filter on a non-existent column matches nothing, which is the
     * silent-empty shape rather than an error, so this is asserted rather than trusted.
     */
    it('keeps RLS-scoped entities out of the team-filtered lists', () => {
        const synced = new Set(SYNCED_ENTITIES.map((e) => e.remoteTable));
        const guardian = new Set(GUARDIAN_ENTITIES.map((e) => e.remoteTable));
        for (const entity of RLS_SCOPED_ENTITIES) {
            expect(synced.has(entity.remoteTable), `${entity.remoteTable} is pushable`).toBe(false);
            expect(guardian.has(entity.remoteTable)).toBe(false);
            expect(entity.scope).toBe('rls');
        }
    });

    it('team_members is pull-only', () => {
        expect(PULL_ONLY_ENTITIES.map((e) => e.remoteTable)).toContain('team_members');
    });
});

describe('scope decides which column a pull filters on', () => {
    /*
     * `pullFromServer` was an unconditional `.eq('team_id', teamId)` until Sprint 9. A guardian
     * table reaching that code path would be filtered on a column it does not have — and the
     * pull swallows a failed query into a `console.warn`, so the visible result is an empty
     * children list, which is indistinguishable from a guardian who has not added a child yet.
     * That is `docs/failure-modes.md` section 4, the class that deleted every new team's seeded
     * checklist (B20).
     */
    it('keeps the guardian tables OUT of the team-scoped pull', () => {
        for (const entity of SYNCED_ENTITIES) {
            expect(entity.scope, `${entity.remoteTable} is pulled by team`).toBe('team');
        }
    });

    it('scopes both guardian tables by the guardian, not by a team', () => {
        expect(GUARDIAN_ENTITIES.map((e) => e.remoteTable)).toEqual([
            // Profiles before consents: `guardian_consents` has a composite FK into
            // `managed_profiles(id, guardian_user_id)`, and this array IS the push order.
            'managed_profiles',
            'guardian_consents',
        ]);
        for (const entity of GUARDIAN_ENTITIES) {
            expect(entity.scope).toBe('guardian');
        }
    });

    it('gives every registered entity a scope', () => {
        // The field is required by the type, so this cannot fail while the build is green —
        // it exists to fail LOUDLY if someone widens the type to make an entity easier to add.
        for (const entity of ENTITIES) {
            expect(['team', 'guardian', 'rls'], `${entity.remoteTable}`).toContain(entity.scope);
        }
    });
});

describe('a consent records the version it was actually shown', () => {
    const consents = findEntity('guardian_consents')!;

    it('carries the version in both directions without substituting one', () => {
        const row = consents.toRemote({ ...guardianConsent, ...CTX });
        expect(row.version).toBe('3.1');
        expect(consents.fromRemote(row).version).toBe('3.1');
    });

    it('does not invent a version for a row that has none', () => {
        /*
         * The regression this guards. The database DEFAULT of '1.0' was dropped in Sprint 9 so
         * that an unversioned consent FAILS rather than silently claiming the guardian agreed
         * to text they were never shown. A `?? '1.0'` here would restore the defect above the
         * database, where no constraint can see it.
         */
        expect(consents.fromRemote({ id: 'c', version: null }).version).toBeNull();
        expect(consents.fromRemote({ id: 'c' }).version).toBeUndefined();
    });

    it('falls back to the consent that matters for an unrecognised type', () => {
        // Same rule as `toMemberRole`: never let a value the client was not built for flow
        // into code comparing against literals.
        expect(consents.fromRemote({ id: 'c', consent_type: 'terms' }).consentType).toBe('terms');
        expect(consents.fromRemote({ id: 'c', consent_type: 'nonsense' }).consentType)
            .toBe('coppa_data_collection');
    });
});

describe('a managed profile carries no age, by construction', () => {
    it('has no birth year in either direction', () => {
        /*
         * `birth_year` was dropped in Sprint 9 and the app never knows anyone's age. This is
         * the client half of that decision: even a server row that somehow carried the column
         * must not reintroduce it, because a field read but never written is how the registry's
         * three original asymmetries (B9/B10/B17) each began.
         */
        const profiles = findEntity('managed_profiles')!;
        const row = profiles.toRemote({ ...managedProfile, ...CTX });

        expect(row).not.toHaveProperty('birth_year');
        expect(profiles.fromRemote({ ...row, birth_year: 2016 })).not.toHaveProperty('birthYear');
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
