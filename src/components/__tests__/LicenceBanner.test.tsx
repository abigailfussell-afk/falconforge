/**
 * The licence banner, and the decision the hand-off asked to be made rather than discovered:
 * what a team that is BOTH lapsed and browsing an archived season sees.
 *
 * Two stacked banners is what happens by accident and is the worst outcome — the user has to
 * work out which refusal is the one blocking them, and neither banner mentions the other. These
 * tests pin the chosen answer so a later edit cannot drift back into it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LicenceBanner from '../LicenceBanner';
import ArchivedSeasonBanner from '../ArchivedSeasonBanner';
import { useAppStore } from '@/lib/store';
import type { TeamEntitlement } from '@/lib/slices/createTeamSlice';

const SEASON_ID = 'season-1';

function setState(options: {
    entitlement?: TeamEntitlement | null;
    isArchived?: boolean;
}) {
    useAppStore.setState({
        currentTeamId: 'team-1',
        currentSeasonId: SEASON_ID,
        entitlement: options.entitlement ?? null,
        seasons: [
            {
                id: SEASON_ID,
                teamId: 'team-1',
                name: '2026-2027 Season',
                isArchived: options.isArchived ?? false,
                createdAt: 0,
            } as never,
        ],
    });
}

function entitlement(overrides: Partial<TeamEntitlement> = {}): TeamEntitlement {
    return {
        teamId: 'team-1',
        status: 'active',
        seatsTotal: 15,
        seatsUnlimited: false,
        seatsUsed: 12,
        validUntil: null,
        lapsedAt: null, isProbation: false,
        ...overrides,
    };
}

/** Both banners, in the shell's arrangement, so precedence is tested where it happens. */
function renderShellBanners() {
    return render(
        <MemoryRouter>
            <ArchivedSeasonBanner />
            <LicenceBanner />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    setState({});
});

describe('a lapsed licence', () => {
    it('says so, and says nothing has been deleted', () => {
        setState({ entitlement: entitlement({ status: 'read_only', lapsedAt: '2026-08-01T00:00:00Z' }) });
        renderShellBanners();

        const banner = screen.getByTestId('licence-lapsed-banner');
        expect(banner.textContent).toMatch(/licence has lapsed/i);
        // Expiry is a read-only grace mode, and a coach seeing red at a competition will assume
        // the worst unless told otherwise.
        expect(banner.textContent).toMatch(/nothing has been deleted/i);
    });

    it('links to the console where the licence can actually be seen', () => {
        setState({ entitlement: entitlement({ status: 'read_only' }) });
        renderShellBanners();

        const link = screen.getByRole('link', { name: /licence details/i });
        expect(link.getAttribute('href')).toBe('/app/admin');
    });
});

describe('failing open', () => {
    /*
     * The offline device that does not yet know any of it — one of the states the hand-off
     * insisted on. It shows NOTHING, because "we could not ask" is not "no".
     */
    it('shows no banner when the entitlement has never been read', () => {
        setState({ entitlement: null });
        renderShellBanners();

        expect(screen.queryByTestId('licence-lapsed-banner')).toBeNull();
        expect(screen.queryByTestId('licence-expiring-banner')).toBeNull();
        expect(screen.queryByTestId('licence-also-lapsed-note')).toBeNull();
    });

    it('shows no banner for an active licence with an open-ended grant', () => {
        setState({ entitlement: entitlement() });
        renderShellBanners();

        expect(screen.queryByTestId('licence-lapsed-banner')).toBeNull();
        expect(screen.queryByTestId('licence-expiring-banner')).toBeNull();
    });
});

describe('an expiring licence', () => {
    it('warns quietly, without claiming anything is read-only yet', () => {
        const in10Days = new Date(Date.now() + 10 * 86_400_000).toISOString();
        setState({ entitlement: entitlement({ validUntil: in10Days }) });
        renderShellBanners();

        const banner = screen.getByTestId('licence-expiring-banner');
        expect(banner.textContent).toMatch(/ends in/i);
        expect(screen.queryByTestId('licence-lapsed-banner')).toBeNull();
    });

    it('does not warn about a licence that runs for months', () => {
        const in200Days = new Date(Date.now() + 200 * 86_400_000).toISOString();
        setState({ entitlement: entitlement({ validUntil: in200Days }) });
        renderShellBanners();

        expect(screen.queryByTestId('licence-expiring-banner')).toBeNull();
    });
});

describe('lapsed AND browsing an archived season', () => {
    /*
     * THE DECISION, PINNED.
     *
     * The archived season wins, for the reason that is really decisive: fixing the licence while
     * an archived season is on screen changes nothing the user can see — every write is still
     * refused, by `season_is_open` instead of `team_can_write` — so a banner that vanishes
     * without unblocking anything reads as a bug.
     */
    it('shows the archived-season banner, not the full lapsed-licence one', () => {
        setState({ isArchived: true, entitlement: entitlement({ status: 'read_only' }) });
        renderShellBanners();

        expect(screen.getByTestId('archived-season-banner')).toBeDefined();
        expect(screen.queryByTestId('licence-lapsed-banner')).toBeNull();
    });

    it('still mentions the licence, in one line rather than a second banner', () => {
        setState({ isArchived: true, entitlement: entitlement({ status: 'read_only' }) });
        renderShellBanners();

        const note = screen.getByTestId('licence-also-lapsed-note');
        expect(note.textContent).toMatch(/licence has also lapsed/i);
        // Discovering the licence problem only AFTER switching seasons is a worse sequence than
        // knowing about both now — but it must not be a second full banner.
        expect(note.textContent!.length).toBeLessThan(
            screen.getByTestId('archived-season-banner').textContent!.length,
        );
    });

    it('never renders two full banners at once', () => {
        setState({ isArchived: true, entitlement: entitlement({ status: 'read_only' }) });
        renderShellBanners();

        const fullBanners = [
            screen.queryByTestId('archived-season-banner'),
            screen.queryByTestId('licence-lapsed-banner'),
        ].filter(Boolean);
        expect(fullBanners).toHaveLength(1);
    });

    it('an archived season with a healthy licence says nothing about licensing', () => {
        setState({ isArchived: true, entitlement: entitlement() });
        renderShellBanners();

        expect(screen.getByTestId('archived-season-banner')).toBeDefined();
        expect(screen.queryByTestId('licence-also-lapsed-note')).toBeNull();
    });

    it('an archived season on a device that never read the entitlement says nothing either', () => {
        // Failing open composes: an unknown licence must not produce the "also lapsed" note.
        setState({ isArchived: true, entitlement: null });
        renderShellBanners();

        expect(screen.getByTestId('archived-season-banner')).toBeDefined();
        expect(screen.queryByTestId('licence-also-lapsed-note')).toBeNull();
    });
});
