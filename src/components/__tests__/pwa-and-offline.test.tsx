import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OfflineBanner from '../OfflineBanner';
import AppUpdatePrompt from '../AppUpdatePrompt';
import { registerServiceWorker, startServiceWorker, resetUpdateStateForTests } from '../../lib/pwa-update';

const mockUseAuth = vi.fn();
vi.mock('../../lib/auth', () => ({ useAuth: () => mockUseAuth() }));

/**
 * A fake Workbox, because the real one needs a service worker and jsdom has none. The events
 * asserted here are the ones the registration actually listens for.
 */
const wbListeners = new Map<string, () => void>();
const messageSkipWaiting = vi.fn();
const register = vi.fn().mockResolvedValue(undefined);

vi.mock('workbox-window', () => ({
    Workbox: class {
        addEventListener(type: string, fn: () => void) {
            wbListeners.set(type, fn);
        }
        messageSkipWaiting = messageSkipWaiting;
        register = register;
    },
}));

/*
 * jsdom has no `navigator.serviceWorker`, and `registerServiceWorker` deliberately no-ops
 * without one -- so a component test that does not provide it silently asserts nothing.
 */
const withServiceWorker = () =>
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });

beforeEach(() => {
    wbListeners.clear();
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isOffline: false });
    withServiceWorker();
    resetUpdateStateForTests();
});

describe('OfflineBanner', () => {
    it('says nothing while the connection is up', () => {
        render(<OfflineBanner />);
        expect(screen.queryByTestId('offline-banner')).toBeNull();
    });

    it('reassures rather than warns when offline, because offline is the designed case', () => {
        mockUseAuth.mockReturnValue({ isOffline: true });
        render(<OfflineBanner />);

        expect(screen.getByTestId('offline-banner')).toBeDefined();
        // The wording matters as much as the presence: a banner that reads like a failure
        // teaches a team to stop working exactly when the venue wifi drops.
        expect(screen.getByText(/saved on this device and will sync/i)).toBeDefined();
    });
});

describe('AppUpdatePrompt', () => {
    it('stays out of the way until a new version is actually waiting', () => {
        startServiceWorker();
        render(<AppUpdatePrompt />);
        expect(screen.queryByTestId('app-update-prompt')).toBeNull();
    });

    it('learns about an update that arrived BEFORE it mounted', async () => {
        /*
         * Registration happens at boot, in main.tsx, so an update can be discovered while the
         * user is still on the login page and the shell does not exist yet. If the prompt only
         * listened from its own mount, that update would have been announced to nobody.
         */
        startServiceWorker();
        wbListeners.get('waiting')?.();

        render(<AppUpdatePrompt />);

        await waitFor(() => expect(screen.getByTestId('app-update-prompt')).toBeDefined());
    });

    it('registers once however many times boot is called', () => {
        startServiceWorker();
        startServiceWorker();
        expect(register).toHaveBeenCalledTimes(1);
    });

    it('appears when a worker is waiting, and reloads only on request', async () => {
        startServiceWorker();
        render(<AppUpdatePrompt />);

        // No prompt until the service worker says a new version is parked behind this one.
        expect(screen.queryByTestId('app-update-prompt')).toBeNull();

        wbListeners.get('waiting')?.();

        await waitFor(() => expect(screen.getByTestId('app-update-prompt')).toBeDefined());
        expect(messageSkipWaiting).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('app-update-reload'));
        expect(messageSkipWaiting).toHaveBeenCalledTimes(1);
    });

    it('can be dismissed, because a team mid-match should not be interrupted', async () => {
        startServiceWorker();
        render(<AppUpdatePrompt />);
        wbListeners.get('waiting')?.();
        await waitFor(() => expect(screen.getByTestId('app-update-prompt')).toBeDefined());

        fireEvent.click(screen.getByTestId('app-update-later'));

        expect(screen.queryByTestId('app-update-prompt')).toBeNull();
        // Dismissing must not discard the update or trigger one: the waiting worker is still
        // there and arrives on the next natural reload.
        expect(messageSkipWaiting).not.toHaveBeenCalled();
    });

    it('also announces an update installed by another tab', async () => {
        startServiceWorker();
        render(<AppUpdatePrompt />);

        /*
         * A worker installed by ANOTHER tab of the same app arrives on this same event with
         * `isExternal: true`. Older workbox-window had a separate `externalwaiting` event, and
         * the first draft of the registration listened for it -- which does not type-check
         * against the version in use, and would have silently covered nothing if it had.
         */
        wbListeners.get('waiting')?.();

        await waitFor(() => expect(screen.getByTestId('app-update-prompt')).toBeDefined());
    });
});

describe('registerServiceWorker', () => {
    const originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

    afterEach(() => {
        if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW);
    });

    it('does nothing where there is no service worker, so importing it is always safe', () => {
        // The dev server builds no sw.js and some browsers refuse one outright. A component
        // under test importing this must not explode.
        delete (navigator as { serviceWorker?: unknown }).serviceWorker;
        const onUpdate = vi.fn();
        const teardown = registerServiceWorker(onUpdate);

        expect(register).not.toHaveBeenCalled();
        expect(onUpdate).not.toHaveBeenCalled();
        expect(() => teardown()).not.toThrow();
    });

    it('registers, and reports a waiting worker exactly once per event', () => {
        const onUpdate = vi.fn();
        registerServiceWorker(onUpdate);

        expect(register).toHaveBeenCalledTimes(1);
        wbListeners.get('waiting')?.();
        expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it('stops reporting after teardown, so an unmounted prompt cannot set state', () => {
        const onUpdate = vi.fn();
        const teardown = registerServiceWorker(onUpdate);
        teardown();

        wbListeners.get('waiting')?.();
        expect(onUpdate).not.toHaveBeenCalled();
    });
});
