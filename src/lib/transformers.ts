/**
 * Supabase -> local transforms.
 *
 * These are now thin delegations to `entity-registry.ts`, which holds the single
 * definition of each entity's field mapping in both directions. The bodies used to live
 * here, with the opposite direction living in a `switch` inside sync.ts -- nothing kept
 * the two in step, which is how `partnerAutonomous`/`partnerPark` came to be read but
 * never written, and how three of the five date fields ended up unguarded against NaN.
 *
 * Kept as named exports because call sites across the app import them directly. New code
 * should prefer `findEntity(name).fromRemote(row)`.
 */
import type { Task, ScoutingReport, MatchPlan, Season, SubTeam } from '../types';
import { findEntity } from './entity-registry';

/** Look up a definition that is known to exist, failing loudly if the registry changes. */
function entity(name: string) {
    const found = findEntity(name);
    if (!found) throw new Error(`No entity definition registered for "${name}"`);
    return found;
}

export function transformTaskFromSupabase(t: any): Task {
    return entity('tasks').fromRemote(t);
}

export function transformScoutingReportFromSupabase(r: any): ScoutingReport {
    return entity('scouting_reports').fromRemote(r);
}

export function transformMatchPlanFromSupabase(p: any): MatchPlan {
    return entity('match_plans').fromRemote(p);
}

export function transformSeasonFromSupabase(s: any): Season {
    return entity('seasons').fromRemote(s);
}

export function transformSubTeamFromSupabase(st: any): SubTeam {
    return entity('sub_teams').fromRemote(st);
}
