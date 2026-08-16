import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RouteErrorBoundary from '../RouteErrorBoundary';

/**
 * Before this boundary existed there was NO error boundary anywhere in the app, so React's
 * default applied: an uncaught render error unmounts the whole tree and the user gets a blank
 * page. At a competition that is indistinguishable from the app being broken, and the natural
 * response — close it and reopen it — lands on the same crashing route again.
 */
function Boom({ explode }: { explode: boolean }): React.ReactElement {
    if (explode) throw new Error('kaboom');
    return <p>the view rendered</p>;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    // React logs caught errors itself; silencing keeps the suite output about the assertions.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleError.mockRestore();
});

describe('RouteErrorBoundary', () => {
    it('renders its child when nothing is wrong', () => {
        render(
            <RouteErrorBoundary resetKey="/app/board">
                <Boom explode={false} />
            </RouteErrorBoundary>,
        );

        expect(screen.getByText('the view rendered')).toBeDefined();
        expect(screen.queryByTestId('route-error')).toBeNull();
    });

    it('catches a crashing view instead of blanking the app', () => {
        render(
            <RouteErrorBoundary resetKey="/app/board">
                <Boom explode={true} />
            </RouteErrorBoundary>,
        );

        expect(screen.getByTestId('route-error')).toBeDefined();
    });

    it('tells the user their work is safe, which is the thing they actually need to know', () => {
        render(
            <RouteErrorBoundary resetKey="/app/board">
                <Boom explode={true} />
            </RouteErrorBoundary>,
        );

        // The queue is in IndexedDB and survives this entirely. Saying so is the difference
        // between a recoverable moment and a team assuming they have lost their scouting.
        expect(screen.getByText(/nothing you have saved has been lost/i)).toBeDefined();
    });

    it('recovers when the user navigates to another route', () => {
        const { rerender } = render(
            <RouteErrorBoundary resetKey="/app/board">
                <Boom explode={true} />
            </RouteErrorBoundary>,
        );
        expect(screen.getByTestId('route-error')).toBeDefined();

        // The shell stays mounted around this boundary precisely so the user can navigate away
        // under their own steam. If the pathname change did not clear the error, the fallback
        // would sit on top of whatever route they escaped to.
        rerender(
            <RouteErrorBoundary resetKey="/app/scouting">
                <Boom explode={false} />
            </RouteErrorBoundary>,
        );

        expect(screen.queryByTestId('route-error')).toBeNull();
        expect(screen.getByText('the view rendered')).toBeDefined();
    });

    it('lets the user retry the same route without a reload', () => {
        /*
         * Controlled from outside the component rather than by flipping a ref during render:
         * React re-renders a throwing component a second time in development to reconstruct the
         * component stack, so "throw only on the first render" is not a thing a test can rely on.
         */
        let shouldExplode = true;
        function Flaky() {
            if (shouldExplode) throw new Error('kaboom once');
            return <p>recovered</p>;
        }

        render(
            <RouteErrorBoundary resetKey="/app/board">
                <Flaky />
            </RouteErrorBoundary>,
        );
        expect(screen.getByTestId('route-error')).toBeDefined();

        // Whatever was transiently wrong is no longer wrong -- a failed fetch, a half-synced
        // record. Retrying must re-attempt the SAME route without a page reload.
        shouldExplode = false;
        fireEvent.click(screen.getByTestId('route-error-retry'));

        expect(screen.getByText('recovered')).toBeDefined();
    });

    it('reports the route it crashed on, because that is what makes it reproducible', () => {
        render(
            <RouteErrorBoundary resetKey="/app/scouting">
                <Boom explode={true} />
            </RouteErrorBoundary>,
        );

        const reported = consoleError.mock.calls.find((call: unknown[]) => call[0] === '[falconforge:error]');
        expect(reported, 'the boundary did not report through reportError').toBeDefined();
        expect(reported?.[1]).toMatchObject({ message: 'kaboom', boundary: 'route', route: '/app/scouting' });
    });
});
