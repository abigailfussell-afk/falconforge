/**
 * Real tests for the local -> Supabase transform (C9).
 *
 * The previous version of this file was 319 lines and 11 tests that never called the
 * transform. It built a camelCase literal and a snake_case literal by hand and then asserted
 * the two literals equalled each other:
 *
 *     expect(expectedSupabaseFormat.team_id).toBe(localTask.teamId);
 *
 * That cannot fail. `transformToSupabaseSchema` could have been deleted outright and the
 * suite would have stayed green, over the layer that decides what actually reaches the
 * database. These tests call the real exported function.
 */
import { describe, it, expect } from 'vitest';
import { transformToSupabaseSchema } from '../sync';

describe('transformToSupabaseSchema', () => {
    describe('tasks', () => {
        const localTask = {
            id: 'task-123',
            teamId: 'team-456',
            seasonId: 'season-789',
            department: 'subteam-abc',
            title: 'Build intake system',
            description: 'Design and build the intake mechanism',
            status: 'In Progress',
            type: 'Feature',
            assignedTo: 'member-xyz',
            checklist: [{ id: 'item-1', text: 'Design CAD', completed: true }],
            timeline: [{ id: 'event-1', type: 'comment', authorId: 'user-1', content: 'Started', timestamp: 1234567890 }],
            dueDate: 1700000000000,
            archivedAt: undefined,
            createdAt: 1699000000000,
        };

        it('maps camelCase fields onto their snake_case columns', () => {
            const row = transformToSupabaseSchema('tasks', localTask);

            expect(row.id).toBe('task-123');
            expect(row.team_id).toBe('team-456');
            expect(row.season_id).toBe('season-789');
            expect(row.sub_team_id).toBe('subteam-abc');
            expect(row.assigned_to).toBe('member-xyz');
            expect(row.title).toBe('Build intake system');
            expect(row.status).toBe('In Progress');
        });

        it('converts epoch millis to ISO strings for timestamp columns', () => {
            const row = transformToSupabaseSchema('tasks', localTask);

            expect(row.due_date).toBe(new Date(1700000000000).toISOString());
            // Not archived — null, not the string "undefined" or an Invalid Date.
            expect(row.archived_at).toBeNull();
        });

        it('omits createdAt, which the server column default owns', () => {
            const row = transformToSupabaseSchema('tasks', localTask);

            expect(row).not.toHaveProperty('created_at');
            expect(row).not.toHaveProperty('createdAt');
        });

        it('accepts the legacy subTeamId spelling as well as department', () => {
            const row = transformToSupabaseSchema('tasks', {
                ...localTask,
                department: undefined,
                subTeamId: 'subteam-legacy',
            });

            expect(row.sub_team_id).toBe('subteam-legacy');
        });

        it('sends null rather than an empty string for an unassigned task', () => {
            const row = transformToSupabaseSchema('tasks', { ...localTask, assignedTo: '' });

            expect(row.assigned_to).toBeNull();
        });

        it('defaults the jsonb array columns instead of sending undefined', () => {
            const row = transformToSupabaseSchema('tasks', {
                id: 't', teamId: 'team-1', title: 'Bare', status: 'Backlog', type: 'Feature',
            });

            expect(row.checklist).toEqual([]);
            expect(row.timeline).toEqual([]);
        });
    });

    describe('scouting reports', () => {
        const localReport = {
            id: 'report-1',
            teamId: 'team-456',
            seasonId: 'season-789',
            teamNumber: '12345',
            matchNumber: 7,
            eventName: 'Regional',
            // The game's fields, in the bag the column has always held them in (P-01 phase S).
            data: {
                hasAutonomous: true,
                autoScore: 30,
                intakeType: 'Active',
                autoAim: true,
                farShooting: false,
                shotsTaken: 12,
                shotsMissed: 3,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Strong endgame',
            },
            createdBy: 'user-1',
        };

        it('nests the scouting payload into the jsonb data column', () => {
            const row = transformToSupabaseSchema('scoutingReports', localReport);

            expect(row.opponent_team_number).toBe('12345');
            expect(row.match_number).toBe(7);
            expect(row.event_name).toBe('Regional');
            expect(row.created_by).toBe('user-1');
            expect(row.data).toEqual({
                hasAutonomous: true,
                autoScore: 30,
                intakeType: 'Active',
                autoAim: true,
                farShooting: false,
                shotsTaken: 12,
                shotsMissed: 3,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Strong endgame',
            });
        });

        it('sends null, never 0, for an unrecorded match number (B18)', () => {
            // 0 fails the CHECK constraint and dead-letters the whole push.
            const row = transformToSupabaseSchema('scoutingReports', {
                ...localReport,
                matchNumber: undefined,
            });

            expect(row.match_number).toBeNull();
        });

        it('preserves a genuine match number of 0 distinctly from absent', () => {
            const row = transformToSupabaseSchema('scoutingReports', { ...localReport, matchNumber: 0 });

            expect(row.match_number).toBe(0);
        });
    });

    describe('match plans', () => {
        const localPlan = {
            id: 'plan-1',
            teamId: 'team-456',
            seasonId: 'season-789',
            title: 'Qual 12',
            matchNumber: 12,
            allianceTeam: '54321',
            drawingData: 'data:image/png;base64,abc',
            notes: 'Play defence',
            partnerAutonomous: true,
            partnerPark: true,
            updatedAt: 1699000000000,
        };

        it('writes the partner flags that used to be read but never sent (B9)', () => {
            const row = transformToSupabaseSchema('matchPlans', localPlan);

            expect(row.partner_autonomous).toBe(true);
            expect(row.partner_park).toBe(true);
        });

        it('defaults the partner flags to false when absent', () => {
            const row = transformToSupabaseSchema('matchPlans', {
                ...localPlan,
                partnerAutonomous: undefined,
                partnerPark: undefined,
            });

            expect(row.partner_autonomous).toBe(false);
            expect(row.partner_park).toBe(false);
        });

        it('omits updatedAt, which the server trigger owns', () => {
            const row = transformToSupabaseSchema('matchPlans', localPlan);

            expect(row).not.toHaveProperty('updated_at');
        });
    });

    describe('seasons and sub-teams', () => {
        it('sends null for an empty field image rather than an empty string', () => {
            const row = transformToSupabaseSchema('seasons', {
                id: 'season-1', name: '2025-2026 Decode', teamId: 'team-1', fieldImageData: '',
            });

            expect(row).toEqual({
                id: 'season-1',
                name: '2025-2026 Decode',
                team_id: 'team-1',
                game_title: null,
                // P-01 phase S. Null for a season the caller did not name a template for —
                // which is every season created before the column existed. `gameForSeason`
                // falls back to the game title, then to the newest bundle.
                game_definition_id: null,
                game_definition_version: null,
                field_image_data: null,
                is_archived: false,
            });
        });

        it('sends null for a blank game title — the column has a not-blank CHECK', () => {
            const row = transformToSupabaseSchema('seasons', {
                id: 'season-1', name: '2025-2026', teamId: 'team-1', fieldImageData: '',
                gameTitle: '   ',
            });

            expect(row.game_title).toBeNull();
        });

        it('carries the archive flag, so a rollover can close the outgoing season', () => {
            const row = transformToSupabaseSchema('seasons', {
                id: 'season-1', name: '2025-2026', teamId: 'team-1', fieldImageData: '',
                gameTitle: 'DECODE', isArchived: true,
            });

            expect(row.is_archived).toBe(true);
            expect(row.game_title).toBe('DECODE');
        });

        it('carries the season through, because a sub-team cannot be unscoped', () => {
            // This used to assert `season_id` came out NULL for a sub-team with no season,
            // which was the client half of C6: `sub_teams.season_id` is NOT NULL, so that
            // row could only ever fail its constraint. The season is required on the type
            // now and passed straight through.
            const row = transformToSupabaseSchema('subTeams', {
                id: 'st-1', name: 'Programming', teamId: 'team-1', memberIds: ['m1', 'm2'],
                seasonId: 'season-1',
            });

            expect(row.member_ids).toEqual(['m1', 'm2']);
            expect(row.season_id).toBe('season-1');
        });
    });

    describe('checklists (blob-synced, not a registry entity)', () => {
        it('uses the season id as the row id, since there is one row per season (C6)', () => {
            // V1 keyed the blob on the TEAM, so every season shared one checklist and a new
            // season was not the fresh start it is supposed to be. The id has to be
            // derivable without a round trip -- two devices editing offline must arrive at
            // the same row -- and the season is the thing they already agree on.
            const row = transformToSupabaseSchema('checklists', {
                teamId: 'team-456',
                seasonId: 'season-789',
                items: [{ id: '1', text: 'Swap battery', checked: false }],
            });

            expect(row.id).toBe('season-789');
            expect(row.team_id).toBe('team-456');
            expect(row.season_id).toBe('season-789');
            expect(row.items).toEqual([{ id: '1', text: 'Swap battery', checked: false }]);
            expect(row.name).toBe('Pre-Match Checklist');
            expect(row.is_template).toBe(false);
        });

        it('accepts the items under the legacy `checklist` key', () => {
            const row = transformToSupabaseSchema('checklists', {
                teamId: 'team-456',
                checklist: [{ id: '1', text: 'Charge hub', checked: true }],
            });

            expect(row.items).toEqual([{ id: '1', text: 'Charge hub', checked: true }]);
        });
    });

    describe('table name resolution', () => {
        const task = { id: 't1', teamId: 'team-1', title: 'X', status: 'Backlog', type: 'Feature' };

        it.each([
            ['scoutingReports', 'scouting_reports'],
            ['subTeams', 'sub_teams'],
            ['matchPlans', 'match_plans'],
        ])('resolves %s and %s to the same definition', (localKey, remoteTable) => {
            const payload = { id: 'x', teamId: 'team-1', name: 'N', memberIds: [], teamNumber: '1', title: 'T' };

            expect(transformToSupabaseSchema(localKey, payload))
                .toEqual(transformToSupabaseSchema(remoteTable, payload));
        });

        it('passes unknown tables through untouched rather than dropping fields', () => {
            const unknown = { id: 'x', someField: 'value', nested: { a: 1 } };

            expect(transformToSupabaseSchema('not_a_real_table', unknown)).toEqual(unknown);
        });

        it('no longer special-cases portfolio_entries', () => {
            // The AI features are gone and no such table ever existed; the orphaned case
            // used to invent a row shape for it. It must now fall through to pass-through.
            const payload = { id: 'p1', teamId: 'team-1', content: 'Summary', taskCount: 5 };

            expect(transformToSupabaseSchema('portfolio_entries', payload)).toEqual(payload);
        });

        it.each([null, undefined])('returns %s unchanged', (value) => {
            expect(transformToSupabaseSchema('tasks', value)).toBe(value);
        });

        it('does not mutate the record it was given', () => {
            const original = { ...task };

            transformToSupabaseSchema('tasks', task);

            expect(task).toEqual(original);
        });
    });
});
