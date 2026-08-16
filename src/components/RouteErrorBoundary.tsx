import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from './ui/Button';
import { reportError } from '../lib/error-reporting';

interface Props {
    /** Changing this resets the boundary — the route path, so navigating away recovers. */
    resetKey: string;
    children: React.ReactNode;
}

interface State {
    error: Error | null;
}

/**
 * One crashing view must not take the whole app with it.
 *
 * Before this, the app had NO error boundary anywhere. React's default for an uncaught render
 * error is to unmount the entire tree, so a single bad render — a malformed scouting report, a
 * task with a shape the board did not expect — replaced the app with a blank white page. At a
 * competition that is indistinguishable from the app being broken, and the natural response
 * (close it, reopen it) lands on the same crashing route again.
 *
 * Scoped INSIDE the shell rather than around it, deliberately. The sidebar, the season picker
 * and the sync indicator keep working, so the user can navigate away from the crash under their
 * own steam — which is also the reset: `resetKey` is the pathname, so leaving the route clears
 * the error rather than requiring a reload.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not offer to "report this", because there is nowhere to report it to yet
 * (`error-reporting.ts` explains the current story: structured console output, reviewed through
 * Supabase logs). Offering a button that quietly does nothing would be worse than not offering
 * one. It also does not show the stack to the user — that goes to the console, where it is
 * useful, rather than to a coach, to whom it is noise.
 */
export default class RouteErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        reportError(error, { boundary: 'route', route: this.props.resetKey, componentStack: info.componentStack });
    }

    componentDidUpdate(prev: Props) {
        // Navigating to another view clears the error. Without this the boundary would keep
        // rendering its fallback over whatever route the user escaped to.
        if (this.state.error && prev.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <div className="flex h-full items-center justify-center p-6" data-testid="route-error">
                <div className="max-w-prose text-center">
                    <AlertTriangle size={28} className="mx-auto mb-3 text-amber-500" aria-hidden="true" />
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                        This view ran into a problem
                    </h2>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        The rest of the app is still working, and nothing you have saved has been lost —
                        your changes are stored on this device and will sync as usual. Try this view again,
                        or pick another from the menu.
                    </p>
                    <div className="mt-4 flex justify-center">
                        <Button size="sm" onClick={() => this.setState({ error: null })} data-testid="route-error-retry">
                            Try again
                        </Button>
                    </div>
                </div>
            </div>
        );
    }
}
