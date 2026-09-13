/**
 * Render `DashboardHome` the way the app does: as an OUTLET of `AppShell`.
 *
 * Two test files render this component, and when it started reading the shell's `currentMember`
 * to decide who the empty-team sentence is addressed to (R-06), both broke in the same way —
 * `useOutletContext` returns null outside a layout route. Fixing that twice would have left two
 * spellings of "how the dashboard is mounted" to drift apart, which is principle 9's most
 * frequent defect class in this repo.
 *
 * A REAL LAYOUT ROUTE RATHER THAN A MOCKED `useAppShell`. A stub of the hook would keep passing
 * if the component started getting the role from somewhere else entirely, and the thing worth
 * pinning is that there is exactly one place it comes from.
 */
import { render } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import DashboardHome from '../components/DashboardHome';
import type { TeamMember } from '../types';

/**
 * @param currentMember the caller's row on the team, or null for "not known yet" — which is
 * what a device that has not pulled the roster has, and is treated as "cannot plan work".
 */
export function renderDashboard(currentMember: Partial<TeamMember> | null = null) {
    return render(
        <MemoryRouter>
            <Routes>
                <Route element={<Outlet context={{ currentMember }} />}>
                    <Route path="*" element={<DashboardHome />} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}
