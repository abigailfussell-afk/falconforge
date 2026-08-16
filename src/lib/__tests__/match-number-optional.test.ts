/**
 * B18 — a blank match number must not become 0.
 *
 * ScoutingReports.tsx validated only teamNumber, and `newScout.matchNumber || 0` turned the
 * NaN from an empty `parseInt()` into 0. The column was NOT NULL with no CHECK, so Postgres
 * accepted it and the card rendered "Match 0". Five of the nine scouting reports in
 * production were created this way.
 *
 * match_number is now nullable and means "not recorded". These tests pin both transform
 * directions so the sentinel cannot come back.
 */
import { describe, it, expect, vi } from 'vitest';
import { findEntity } from '@/lib/entity-registry';

// sync.ts is mocked globally in setup.ts; the real pure function is what we want here.
const { transformToSupabaseSchema } = await vi.importActual<typeof import('@/lib/sync')>('@/lib/sync');

/*
 * Straight at the registry.
 *
 * This test used to import `transformScoutingReportFromSupabase` from `lib/transformers.ts`,
 * a shim whose whole body was `findEntity('scouting_reports').fromRemote(row)`. By Sprint 5
 * it had exactly one caller left — this file — so the shim existed only to be tested, which
 * is the definition of dead code. Testing the registry directly is also what makes these
 * assertions mean what they claim: B18 is a property of the entity definition, and a test
 * that goes through a wrapper can only ever prove the wrapper forwards.
 */
const scoutingReports = findEntity('scouting_reports')!;
const transformScoutingReportFromSupabase = (row: unknown) => scoutingReports.fromRemote(row);

describe('scouting report match number is optional (B18)', () => {
    it('maps a NULL match_number to undefined, not 0', () => {
        const local = transformScoutingReportFromSupabase({
            id: 'r1',
            opponent_team_number: '12345',
            match_number: null,
            data: {},
        });

        expect(local.matchNumber).toBeUndefined();
        expect(local.matchNumber).not.toBe(0);
    });

    it('preserves a real match number', () => {
        const local = transformScoutingReportFromSupabase({
            id: 'r1',
            opponent_team_number: '12345',
            match_number: 7,
            data: {},
        });

        expect(local.matchNumber).toBe(7);
    });

    it('sends NULL to the database when no match number was recorded', () => {
        const row = transformToSupabaseSchema('scouting_reports', {
            id: 'r1',
            teamId: 't1',
            seasonId: 's1',
            teamNumber: '12345',
            matchNumber: undefined,
        });

        // NULL, not 0 — 0 is what the CHECK constraint rejects.
        expect(row.match_number).toBeNull();
    });

    it('round-trips an absent match number without inventing a value', () => {
        const row = transformToSupabaseSchema('scouting_reports', {
            id: 'r1',
            teamId: 't1',
            seasonId: 's1',
            teamNumber: '12345',
            matchNumber: undefined,
        });
        const back = transformScoutingReportFromSupabase({ ...row, data: row.data });

        expect(back.matchNumber).toBeUndefined();
    });
});
