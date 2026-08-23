/**
 * The team's licensing state, and what it permits — in one place, for the same reason
 * `season-scope.ts` exists.
 *
 * DELIBERATELY SEPARATE FROM `useSeasonScope`, AND THIS IS NOT AN OVERSIGHT.
 *
 * `season-scope.ts` carries the reasoning in its own comment: a lapsed licence and an archived
 * season are different refusals with different fixes — "renew" versus "switch to this year" —
 * and collapsing them into one boolean produces a UI that cannot tell the user which one they
 * are looking at. That argument holds in both directions, so this file does not consult the
 * season either. {@link useAccessState} is where the two are composed, once, with an explicit
 * answer for the team that is both.
 *
 * FAIL OPEN. EVERY TIME.
 *
 * `entitlement` is null until the view has been read, and it is read over the network. A
 * device that has never been online, or whose pull timed out, has no answer — and "we could
 * not ask" must never be treated as "no". Locking a coach out of their own team at a
 * competition because a query timed out is a worse failure than letting an unlicensed team
 * keep typing: the database refuses the write regardless (`team_can_write` is in every write
 * policy), so the client's copy is there to EXPLAIN a refusal, never to be the refusal.
 *
 * Which is why every predicate here is written against a POSITIVE `'read_only'`, never against
 * `!== 'active'`. The two differ precisely on null, which is the case that matters.
 */
import { useMemo } from 'react';
import { useAppStore } from './store';
import { useSeasonScope } from './season-scope';
import type { TeamEntitlement } from './slices/createTeamSlice';

export interface EntitlementState {
    /** The raw view row, or null if it has never been read on this device. */
    entitlement: TeamEntitlement | null;
    /**
     * The entitlement view has been read at least once on this device.
     *
     * EVERY CAPACITY PREDICATE IS GATED ON THIS, and the first draft of this file was not —
     * which its own test caught. With no row, `seatsTotal` is null and `seatsRemaining` floors
     * to 0, so `isAtCapacity` came out TRUE and the console would have refused every approval
     * on a device that had simply never managed to ask. "No answer" and "no seats" are
     * arithmetically identical and semantically opposite.
     */
    isKnown: boolean;
    /**
     * The server has told us this team may not write. Positive knowledge only — false when we
     * have not asked.
     */
    isReadOnly: boolean;
    /** Seats held by approved members. */
    seatsUsed: number;
    /** Seats the team has bought, or null when the grant is unlimited. */
    seatsTotal: number | null;
    seatsUnlimited: boolean;
    /**
     * Seats left to approve into. Null means unlimited — NOT a large number, because the
     * console renders the two differently and `remaining < 1` would be wrong for unlimited.
     */
    seatsRemaining: number | null;
    /** True when every seat is taken, so the next approval will be refused. */
    isAtCapacity: boolean;
    /**
     * The team has more approved members than seats. Reachable by reducing a grant below the
     * current headcount, which is allowed: a customer must always be able to lower their bill.
     * Nobody is removed; the team simply cannot approve anyone new until it is back under.
     */
    isOverCapacity: boolean;
    /** When cover runs out, or null for open-ended. */
    validUntil: Date | null;
    /** When cover ran out, for a lapsed team's message. */
    lapsedAt: Date | null;
    /** Cover ends within {@link EXPIRY_WARNING_DAYS}. False for open-ended grants. */
    isExpiringSoon: boolean;
    /** Whole days until cover ends; null when open-ended or already lapsed. */
    daysUntilExpiry: number | null;
}

/** How long before expiry the console starts saying so. One competition cycle of notice. */
export const EXPIRY_WARNING_DAYS = 30;

function parseDate(value: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Read licensing state without the season.
 *
 * `now` is injectable so the expiry arithmetic can be tested at a fixed instant — "expires
 * tomorrow" is otherwise a test that passes for 24 hours.
 */
export function deriveEntitlementState(
    entitlement: TeamEntitlement | null,
    now: Date = new Date(),
): EntitlementState {
    const validUntil = parseDate(entitlement?.validUntil ?? null);
    const lapsedAt = parseDate(entitlement?.lapsedAt ?? null);
    const seatsUsed = entitlement?.seatsUsed ?? 0;
    const seatsTotal = entitlement?.seatsTotal ?? null;
    const seatsUnlimited = entitlement?.seatsUnlimited ?? false;

    // Mirrors `team_seats_remaining` in the database, including the null-means-unlimited
    // convention and the floor at zero. The server is still the authority; this exists so the
    // console can stop offering an approval it knows will be refused.
    const seatsRemaining = seatsUnlimited
        ? null
        : Math.max((seatsTotal ?? 0) - seatsUsed, 0);

    const msUntilExpiry = validUntil ? validUntil.getTime() - now.getTime() : null;
    /*
     * ROUNDED UP, not down.
     *
     * `Math.floor` reads correctly for whole days and absurdly for the last one: a licence with
     * eleven hours left reported "ends in 0 days". Rounding up means the count reaches 1 and
     * stops there until it has actually lapsed, at which point this is null and the lapsed
     * banner takes over. It also makes the warning boundary exact rather than a day early — a
     * grant exactly 30 days out is 30, not 29.
     */
    const daysUntilExpiry =
        msUntilExpiry === null || msUntilExpiry < 0
            ? null
            : Math.ceil(msUntilExpiry / 86_400_000);

    const isKnown = entitlement !== null;

    return {
        entitlement,
        isKnown,
        // POSITIVE check. `!== 'active'` would lock out a device that has never read the view.
        isReadOnly: entitlement?.status === 'read_only',
        seatsUsed,
        seatsTotal,
        seatsUnlimited,
        // Null when unread: the console shows "—" rather than a 0 it did not learn.
        seatsRemaining: isKnown ? seatsRemaining : null,
        isAtCapacity: isKnown && !seatsUnlimited && seatsRemaining === 0,
        isOverCapacity:
            isKnown && !seatsUnlimited && seatsTotal !== null && seatsUsed > seatsTotal,
        validUntil,
        lapsedAt,
        isExpiringSoon:
            daysUntilExpiry !== null && daysUntilExpiry <= EXPIRY_WARNING_DAYS,
        daysUntilExpiry,
    };
}

export function useEntitlement(): EntitlementState {
    const entitlement = useAppStore((s) => s.entitlement);
    return useMemo(() => deriveEntitlementState(entitlement), [entitlement]);
}

/**
 * What a team that is BOTH lapsed and browsing an archived season is told.
 *
 * The hand-off asked for this to be decided rather than discovered: two stacked banners is
 * what happens by accident, and it is the worst answer, because the user has to work out which
 * refusal is the one blocking them and neither banner mentions the other.
 *
 * THE ARCHIVED SEASON WINS. Two reasons, and the second is the real one:
 *
 *   1. It is the refusal the user can act on immediately and alone. "Switch to this season" is
 *      a click; "renew the licence" is a conversation with the platform operator.
 *   2. Fixing the licence while an archived season is on screen changes NOTHING the user can
 *      see — every write is still refused, by `season_is_open` instead of `team_can_write`. A
 *      banner that disappears without unblocking anything reads as a bug.
 *
 * The licence is not hidden, only deferred: the archived banner is what shows, and the console's
 * entitlement panel still states the licensing position in full.
 */
export type AccessRefusal = 'archived-season' | 'lapsed-licence' | null;

/**
 * Why a content control is disabled — the three answers, and their words.
 *
 * ONE MAP, BECAUSE THERE WERE TWENTY-ONE COPIES. The literal string "This season is archived
 * and read-only" was written out by hand in six components and every one of them used it for
 * all three refusals, because until Sprint 16 the archived season was the only one a control
 * could see. So a lapsed team read "This season is archived" on a season that was not
 * archived, and a user with no season selected at all read it too. Wrong words are worse than
 * no words: they send someone to the season picker to fix a licence.
 *
 * This is also the shape `docs/failure-modes.md` §8 asks for — a control that cannot act is
 * `disabled` with a `title` saying why — and the reason that rule kept half-working is that
 * the "why" was hard-coded next to a boolean that did not know it.
 */
export type EditRefusal = 'no-season' | 'archived-season' | 'lapsed-licence';

export const EDIT_REFUSAL_TEXT: Record<EditRefusal, string> = {
    'no-season': 'No season is selected yet',
    'archived-season': 'This season is archived and read-only',
    'lapsed-licence': 'Your team’s licence has lapsed — read only',
};

export interface AccessState extends EntitlementState {
    /** The season is archived (from `useSeasonScope`, unmerged and unchanged). */
    isArchivedSeason: boolean;
    /**
     * Which single BANNER to show. Null when writes are permitted as far as this device
     * knows — which, failing open, includes "we have not been able to ask".
     *
     * Distinct from {@link editRefusal} and deliberately so: "no season selected" gets no
     * banner (the shell already shows a season picker, and a banner saying "pick a season"
     * above a season picker is noise), but it certainly disables New/Edit/Save.
     */
    refusal: AccessRefusal;
    /** Both refusals apply at once. The console says so even though one banner shows. */
    isBothRefusals: boolean;
    /**
     * Safe to create, edit or delete team content right now.
     *
     * THE ONLY `canEdit` IN THE APP. `useSeasonScope` used to carry one that knew about the
     * season and not the licence, which is how WALK-B-12 happened: a lapsed team was offered
     * every New/Edit/Save control on every content screen, and each write queued, was refused
     * by `team_can_write` with a 42501, and landed in the dead-letter store. The server side
     * of that was already right — `sync-failure-classification.ts` has classified it as
     * terminal with a renew-and-retry reason since Sprint 6 — so the whole defect was the
     * client offering the write in the first place.
     *
     * FAILS OPEN, inherited from `isReadOnly`: a device that has never read the entitlement
     * view can still edit. The database is the refusal; this is the explanation.
     */
    canEdit: boolean;
    /** Which refusal is blocking edits, or null when they are permitted. */
    editRefusal: EditRefusal | null;
    /**
     * `EDIT_REFUSAL_TEXT[editRefusal]`, or undefined when editing is permitted — ready to
     * drop straight into a disabled control's `title`.
     *
     * `undefined` and not `null` because `title` is `string | undefined` on every DOM element
     * and every wrapper in `ui/`, and a value that needs `?? undefined` at each of its
     * twenty-one call sites is a value that will be spelled differently at some of them.
     */
    editRefusalReason: string | undefined;
}

export function useAccessState(): AccessState {
    const entitlementState = useEntitlement();
    const { isArchived, currentSeasonId } = useSeasonScope();

    return useMemo(() => {
        const isBothRefusals = isArchived && entitlementState.isReadOnly;
        const refusal: AccessRefusal = isArchived
            ? 'archived-season'
            : entitlementState.isReadOnly
                ? 'lapsed-licence'
                : null;

        /*
         * SAME PRECEDENCE AS THE BANNER, for the same reason, plus "no season" first because
         * it is the one the user can fix without leaving the screen. The ordering rule stated
         * on `AccessRefusal` above holds here: show the refusal the user can act on alone.
         */
        const editRefusal: EditRefusal | null = !currentSeasonId
            ? 'no-season'
            : isArchived
                ? 'archived-season'
                : entitlementState.isReadOnly
                    ? 'lapsed-licence'
                    : null;

        return {
            ...entitlementState,
            isArchivedSeason: isArchived,
            refusal,
            isBothRefusals,
            canEdit: editRefusal === null,
            editRefusal,
            editRefusalReason: editRefusal ? EDIT_REFUSAL_TEXT[editRefusal] : undefined,
        };
    }, [entitlementState, isArchived, currentSeasonId]);
}
