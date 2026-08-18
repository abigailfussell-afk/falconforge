import type { Team, TeamMember } from '../../types';
import type { SliceCreator } from './types';

/**
 * What `team_entitlement` says about the current team.
 *
 * Read-only on the client — the view is the server's answer to "may this team write", and
 * every write policy consults `team_can_write` independently. This copy exists so the UI can
 * stop OFFERING an action the server would refuse, which is the narrow half of the
 * enforcement work; the full read-only banner and lock screens are Sprint 6.
 *
 * Persisted, deliberately. A team that has just gone offline should still know its licence
 * lapsed rather than treating the absence of an answer as permission.
 */
export interface TeamEntitlement {
    teamId: string;
    /** `active` — may write. `read_only` — expired, revoked, or never licensed. */
    status: 'active' | 'read_only';
    seatsTotal: number | null;
    seatsUnlimited: boolean;
    seatsUsed: number;
    /** ISO timestamp, or null for open-ended. */
    validUntil: string | null;
    /** ISO timestamp of when cover last ran out, for a read-only team's message. */
    lapsedAt: string | null;
}

/**
 * Tenancy: which team is on screen, who is signed in, and what the team is licensed for.
 *
 * The roster is TEAM-scoped rather than season-scoped, and that is a product rule rather than
 * an oversight: "roster persists at team level; sub-team assignments reset" is what makes a
 * new season a fresh start without making everyone re-join.
 */
export interface TeamSlice {
    currentTeamId: string | null;
    /** The authenticated user's Supabase UID. Kept in step with auth by `AuthProvider`. */
    currentUserId: string | null;
    /** Teams the user belongs to. */
    teams: Team[];
    /** Members of the current team, cached from Supabase. */
    teamMembers: TeamMember[];
    /** The current team's licensing state, or null if it has not been read yet. */
    entitlement: TeamEntitlement | null;
    /**
     * Team id -> name, for teams this account has ASKED to join and is not yet approved for.
     *
     * A pending member cannot read the team they are waiting on: `teams_select_member` is
     * `is_team_member(id) OR is_team_guardian(id)`, and `is_team_member` requires
     * `status = 'approved'` — so the one row the "waiting for the team admin" screen needs to
     * name is precisely the row RLS refuses it. The screen said "Unknown Team" to a student who
     * had typed that team's own invite code thirty seconds earlier.
     *
     * The name is therefore kept from the moment it was legitimately known: `join_team_with_invite`
     * returns `team_id` and `team_name`, and the client simply stopped throwing them away.
     *
     * Deliberately NOT a widening of the policy. The alternative was a second SELECT policy
     * admitting anyone with a `team_members` row of any status, which would also hand a
     * non-member `owner_id` and the `pending_admin_*` columns — a governance decision about a
     * team, shown to somebody who is not on it. This costs no exposure at all.
     *
     * Its one honest limitation: it is per-device, so a student who joins on a phone and then
     * opens a laptop sees the old fallback there. That is the trade, and it is the right way
     * round — the pending screen is nearly always the device that just did the joining.
     */
    pendingTeamNames: Record<string, string>;

    setCurrentTeam: (teamId: string | null) => void;
    setCurrentUserId: (userId: string | null) => void;
    setTeams: (teams: Team[]) => void;
    setTeamMembers: (members: TeamMember[]) => void;
    /** Record the current team's licensing state. Server writes only. */
    setEntitlement: (entitlement: TeamEntitlement | null) => void;
    /** Remember a joined-but-unapproved team's name. See {@link TeamSlice.pendingTeamNames}. */
    rememberPendingTeamName: (teamId: string, teamName: string) => void;
    /** Drop remembered names for teams that are now readable in their own right. */
    forgetPendingTeamNames: (teamIds: string[]) => void;
}

export const teamInitialState = {
    currentTeamId: null as string | null,
    currentUserId: null as string | null,
    teams: [] as Team[],
    teamMembers: [] as TeamMember[],
    entitlement: null as TeamEntitlement | null,
    pendingTeamNames: {} as Record<string, string>,
};

export const createTeamSlice: SliceCreator<TeamSlice> = (set) => ({
    ...teamInitialState,

    setCurrentTeam: (currentTeamId) => set({ currentTeamId }),
    setCurrentUserId: (currentUserId) => set({ currentUserId }),
    /*
     * Setting the team list also DROPS a current team that is no longer in it.
     *
     * `currentTeamId` is persisted, and until Sprint 9 nothing ever invalidated it: every
     * account that reached the picker either had teams or was brand new. A guardian is the
     * first kind of account that routinely has NO team of its own, and a stale id pointed
     * `fetchTeamData` at a team the account is not a member of — which then REPLACED the
     * meetings and attendance collections with that team's (empty, per RLS) results, wiping
     * out the guardian's own pull. On screen: "Nothing scheduled yet" for a child with a full
     * schedule. Found in the browser; both pulls were visible in the network log, and the
     * wrong one landed second.
     *
     * Derived from the list rather than cleared by each caller, which is the fix
     * `resetToDefaults` already got for the same class (`docs/failure-modes.md` §12): a caller
     * that forgets is the whole problem, so the invariant lives where the data does.
     */
    setTeams: (teams) =>
        set((state) => ({
            teams,
            currentTeamId:
                state.currentTeamId && teams.some((t) => t.id === state.currentTeamId)
                    ? state.currentTeamId
                    : null,
        })),
    setTeamMembers: (teamMembers) => set({ teamMembers }),
    setEntitlement: (entitlement) => set({ entitlement }),

    rememberPendingTeamName: (teamId, teamName) =>
        set((state) => ({
            pendingTeamNames: { ...state.pendingTeamNames, [teamId]: teamName },
        })),

    /*
     * Pruned rather than left to grow. Once a membership is approved the team is readable in
     * its own right and this entry is dead — and a persisted map that only ever grows is the
     * kind of state that outlives its reason and confuses the next reader.
     */
    forgetPendingTeamNames: (teamIds) =>
        set((state) => {
            if (!teamIds.some((id) => id in state.pendingTeamNames)) return {};
            const next = { ...state.pendingTeamNames };
            for (const id of teamIds) delete next[id];
            return { pendingTeamNames: next };
        }),
});
