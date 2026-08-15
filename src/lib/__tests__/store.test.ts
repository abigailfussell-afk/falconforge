import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore, selectChecklist } from '../store';
/**
 * A season for the store to work in.
 *
 * Every season-scoped action refuses to run without one now: `season_id` is NOT NULL in the
 * schema, so a task, report, plan or checklist item created with no season could never be
 * pushed. `checklist()` reads the current season's list, which is what the UI does.
 */
const SEASON_ID = '00000000-0000-4000-8000-0000000000aa';
const checklist = () => selectChecklist(useAppStore.getState());


// The store persists through `indexedDBStorage`; jsdom has no IndexedDB, and this suite is
// about store actions rather than persistence.
vi.mock('../offline-db');

// No Supabase mock here any more: the store no longer talks to the server at all. Reads
// moved to `server-pull.ts` (C3), writes go through the offline queue. If this file ever
// needs a Supabase mock again, that is a sign a second read path has grown back.

describe('AppStore', () => {
    beforeEach(() => {
        // Reset store to initial state before each test
        useAppStore.setState({
            tasks: [],
            checklistsBySeason: {},
            scoutingReports: [],
            currentSeasonId: SEASON_ID,
            theme: 'dark',
        });
    });

    describe('Tasks', () => {
        it('should add a task', () => {
            const store = useAppStore.getState();

            store.addTask({
                title: 'Test Task',
                description: 'Test Description',
                status: 'To Do',
                type: 'Feature',
                assignedTo: 'member-1',
                department: 'programming',
                tags: ['urgent'],
                checklist: [],
            });

            const tasks = useAppStore.getState().tasks;
            expect(tasks).toHaveLength(1);
            expect(tasks[0].title).toBe('Test Task');
            expect(tasks[0].status).toBe('To Do');
        });

        it('should update a task', () => {
            const store = useAppStore.getState();

            // Add a task first
            store.addTask({
                title: 'Original Title',
                description: 'Original Description',
                status: 'To Do',
                type: 'Feature',
                assignedTo: 'member-1',
                department: 'programming',
                tags: [],
                checklist: [],
            });

            const taskId = useAppStore.getState().tasks[0].id;

            // Update the task
            store.updateTask(taskId, { title: 'Updated Title', status: 'In Progress' });

            const updatedTask = useAppStore.getState().tasks.find(t => t.id === taskId);
            expect(updatedTask?.title).toBe('Updated Title');
            expect(updatedTask?.status).toBe('In Progress');
        });

        it('should delete a task', () => {
            const store = useAppStore.getState();

            store.addTask({
                title: 'Task to Delete',
                description: 'Will be deleted',
                status: 'To Do',
                type: 'Bug',
                assignedTo: 'member-1',
                department: 'build',
                tags: [],
                checklist: [],
            });

            const taskId = useAppStore.getState().tasks[0].id;
            expect(useAppStore.getState().tasks).toHaveLength(1);

            store.deleteTask(taskId);
            expect(useAppStore.getState().tasks).toHaveLength(0);
        });
    });

    describe('Checklist', () => {
        it('should add a checklist item', () => {
            const store = useAppStore.getState();

            store.addChecklistItem('New checklist item');

            expect(checklist()).toHaveLength(1);
            expect(checklist()[0].text).toBe('New checklist item');
            expect(checklist()[0].checked).toBe(false);
        });

        it('should toggle a checklist item', () => {
            const store = useAppStore.getState();

            store.addChecklistItem('Toggle me');
            const itemId = checklist()[0].id;

            // Toggle to checked
            store.toggleChecklistItem(itemId);
            expect(checklist()[0].checked).toBe(true);

            // Toggle back to unchecked
            store.toggleChecklistItem(itemId);
            expect(checklist()[0].checked).toBe(false);
        });

        it('should delete a checklist item', () => {
            const store = useAppStore.getState();

            store.addChecklistItem('Delete me');
            const itemId = checklist()[0].id;
            expect(checklist()).toHaveLength(1);

            store.deleteChecklistItem(itemId);
            expect(checklist()).toHaveLength(0);
        });
    });

    describe('Theme', () => {
        it('should set theme to light', () => {
            const store = useAppStore.getState();

            store.setTheme('light');
            expect(useAppStore.getState().theme).toBe('light');
        });

        it('should set theme to dark', () => {
            const store = useAppStore.getState();

            store.setTheme('dark');
            expect(useAppStore.getState().theme).toBe('dark');
        });
    });

    describe('Scouting Reports', () => {
        it('should add a scouting report', () => {
            const store = useAppStore.getState();

            store.addScoutingReport({
                teamNumber: '12345',
                matchNumber: 1,
                hasAutonomous: true,
                autoScore: 25,
                intakeType: 'Automatic',
                autoAim: true,
                farShooting: false,
                shotsTaken: 10,
                shotsMissed: 2,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Great match!',
            });

            const reports = useAppStore.getState().scoutingReports;
            expect(reports).toHaveLength(1);
            expect(reports[0].teamNumber).toBe('12345');
            expect(reports[0].rating).toBe(4);
        });

        it('should delete a scouting report', () => {
            const store = useAppStore.getState();

            store.addScoutingReport({
                teamNumber: '12345',
                matchNumber: 1,
                hasAutonomous: true,
                autoScore: 25,
                intakeType: 'Automatic',
                autoAim: true,
                farShooting: false,
                shotsTaken: 10,
                shotsMissed: 2,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Great match!',
            });

            const reportId = useAppStore.getState().scoutingReports[0].id;
            store.deleteScoutingReport(reportId);
            expect(useAppStore.getState().scoutingReports).toHaveLength(0);
        });

        it('should update a scouting report in place', () => {
            const store = useAppStore.getState();

            store.addScoutingReport({
                teamNumber: '12345',
                matchNumber: 1,
                hasAutonomous: true,
                autoScore: 25,
                intakeType: 'Automatic',
                autoAim: true,
                farShooting: false,
                shotsTaken: 10,
                shotsMissed: 2,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Great match!',
            });

            const reportId = useAppStore.getState().scoutingReports[0].id;

            // Update the report
            store.updateScoutingReport(reportId, {
                rating: 5,
                endGameNotes: 'Updated notes',
                shotsTaken: 15,
            });

            const updated = useAppStore.getState().scoutingReports.find(r => r.id === reportId);
            expect(updated).toBeDefined();
            expect(updated!.id).toBe(reportId); // ID preserved
            expect(updated!.teamNumber).toBe('12345'); // Unchanged fields preserved
            expect(updated!.rating).toBe(5); // Updated
            expect(updated!.endGameNotes).toBe('Updated notes'); // Updated
            expect(updated!.shotsTaken).toBe(15); // Updated
        });
    });

    describe('resetToDefaults', () => {
        it('should clear ALL stateful fields including currentTeamId, teams, and seasons', () => {
            const store = useAppStore.getState();

            // Set up dirty state — simulate a logged-in user with data
            useAppStore.setState({
                currentTeamId: 'team-123',
                teams: [{ id: 'team-123', name: 'Dirty Team', teamNumber: '999', ownerId: 'owner-1', createdAt: 1000 }],
                tasks: [
                    {
                        id: 'task-1', title: 'Dirty', description: '', status: 'To Do' as const,
                        type: 'Feature' as const, assignedTo: '', department: '', tags: [],
                        checklist: [], timeline: [], createdAt: 1000, seasonId: SEASON_ID,
                    },
                ],
                scoutingReports: [
                    {
                        id: 'sr-1', teamNumber: '12345', matchNumber: 1, hasAutonomous: false,
                        autoScore: 0, intakeType: 'No Intake' as const, autoAim: false,
                        farShooting: false, shotsTaken: 0, shotsMissed: 0,
                        parking: 'No Park' as const, rating: 1, endGameNotes: '', seasonId: SEASON_ID,
                    },
                ],
                checklistsBySeason: { [SEASON_ID]: [{ id: 'cl-1', text: 'Dirty item', checked: true }] },
                matchPlans: [{ id: 'mp-1', title: 'Plan 1', notes: 'Dirty', drawingData: '', allianceTeam: '', partnerAutonomous: false, partnerPark: false, updatedAt: 1000, seasonId: SEASON_ID }],
                isLoading: true,
            });

            // Verify dirty state is in place
            expect(useAppStore.getState().currentTeamId).toBe('team-123');
            expect(useAppStore.getState().teams).toHaveLength(1);
            expect(useAppStore.getState().tasks).toHaveLength(1);
            expect(useAppStore.getState().isLoading).toBe(true);

            // Reset
            store.resetToDefaults();

            // Verify ALL fields are cleared
            const state = useAppStore.getState();
            expect(state.currentTeamId).toBeNull();
            expect(state.teams).toHaveLength(0);
            expect(state.tasks).toHaveLength(0);
            expect(state.scoutingReports).toHaveLength(0);
            expect(state.matchPlans).toHaveLength(0);
            expect(state.isLoading).toBe(false);
            expect(state.checklistsBySeason).toEqual({});

            // NOTHING is seeded any more, seasons included.
            //
            // This used to assert one default season, because the store held a
            // `DEFAULT_SEASON` with a hardcoded uuid. That season existed on no server, and
            // `season_id` is NOT NULL with a composite foreign key, so every task created
            // under it was unpushable — a signed-out device that started collecting work
            // before the first pull was collecting it into a season that could never sync.
            // A team's seasons come from `create_team_as_admin` now.
            expect(state.seasons).toHaveLength(0);
            expect(state.currentSeasonId).toBeNull();
            expect(state.subTeams).toHaveLength(0);
        });
    });

    describe('SubTeams', () => {
        beforeEach(() => {
            useAppStore.setState({ subTeams: [] });
        });

        it('should add a subteam', () => {
            useAppStore.getState().addSubTeam('Programming');
            const subTeams = useAppStore.getState().subTeams;

            expect(subTeams).toHaveLength(1);
            expect(subTeams[0].name).toBe('Programming');
        });

        it('should remove a subteam', () => {
            useAppStore.getState().addSubTeam('Build');
            const subTeamId = useAppStore.getState().subTeams[0].id;

            useAppStore.getState().removeSubTeam(subTeamId);
            expect(useAppStore.getState().subTeams).toHaveLength(0);
        });

        it('should toggle a member in a subteam', () => {
            useAppStore.getState().addSubTeam('Design');
            const subTeamId = useAppStore.getState().subTeams[0].id;

            // Add member
            useAppStore.getState().toggleMemberInSubTeam(subTeamId, 'user-1');
            expect(useAppStore.getState().subTeams[0].memberIds).toContain('user-1');

            // Remove member
            useAppStore.getState().toggleMemberInSubTeam(subTeamId, 'user-1');
            expect(useAppStore.getState().subTeams[0].memberIds).not.toContain('user-1');
        });
    });

    describe('MatchPlans', () => {
        beforeEach(() => {
            useAppStore.setState({ matchPlans: [] });
        });

        it('should add a match plan', () => {
            useAppStore.getState().addMatchPlan({
                title: 'Auto Plan',
                notes: 'Test',
                drawingData: '',
                allianceTeam: 'Red',
                partnerAutonomous: false,
                partnerPark: false
            });

            const plans = useAppStore.getState().matchPlans;
            expect(plans).toHaveLength(1);
            expect(plans[0].title).toBe('Auto Plan');
        });

        it('should update a match plan', () => {
            useAppStore.getState().addMatchPlan({ title: 'Plan', notes: '', drawingData: '', allianceTeam: '', partnerAutonomous: false, partnerPark: false });
            const planId = useAppStore.getState().matchPlans[0].id;

            useAppStore.getState().updateMatchPlan(planId, { title: 'Updated Plan' });
            expect(useAppStore.getState().matchPlans[0].title).toBe('Updated Plan');
        });

        it('should delete a match plan', () => {
            useAppStore.getState().addMatchPlan({ title: 'Plan', notes: '', drawingData: '', allianceTeam: '', partnerAutonomous: false, partnerPark: false });
            const planId = useAppStore.getState().matchPlans[0].id;

            useAppStore.getState().deleteMatchPlan(planId);
            expect(useAppStore.getState().matchPlans).toHaveLength(0);
        });
    });

    describe('Seasons', () => {
        beforeEach(() => {
            useAppStore.setState({ seasons: [], currentSeasonId: null });
        });

        it('should add a season and set it as current', () => {
            useAppStore.getState().addSeason('New Season');
            const state = useAppStore.getState();

            expect(state.seasons).toHaveLength(1);
            expect(state.seasons[0].name).toBe('New Season');
            expect(state.currentSeasonId).toBe(state.seasons[0].id);
        });
    });

    describe('Additional Checklist Actions', () => {
        beforeEach(() => {
            useAppStore.setState({ checklistsBySeason: {}, currentSeasonId: SEASON_ID });
        });

        it('should reset checklist', () => {
            const store = useAppStore.getState();
            store.addChecklistItem('Item 1');
            store.toggleChecklistItem(checklist()[0].id);
            expect(checklist()[0].checked).toBe(true);
            
            store.resetChecklist();
            expect(checklist()[0].checked).toBe(false);
        });

        it('should update checklist assignment', () => {
            const store = useAppStore.getState();
            store.addChecklistItem('Item 1');
            const itemId = checklist()[0].id;
            
            store.updateChecklistAssignment(itemId, 'member-1');
            expect(checklist()[0].assignedTo).toBe('member-1');
        });

        it('should move checklist item up or down', () => {
            const store = useAppStore.getState();
            store.addChecklistItem('Item 1');
            store.addChecklistItem('Item 2');
            
            const id1 = checklist()[0].id;
            const id2 = checklist()[1].id;
            
            store.moveChecklistItem(id2, 'up');
            expect(checklist()[0].id).toBe(id2);
            expect(checklist()[1].id).toBe(id1);
            
            store.moveChecklistItem(id2, 'down'); // Undo it
            expect(checklist()[0].id).toBe(id1);
            expect(checklist()[1].id).toBe(id2);
        });
        
        it('ignores move out of bounds or not found', () => {
            const store = useAppStore.getState();
            store.addChecklistItem('Item 1');
            const id1 = checklist()[0].id;
            
            store.moveChecklistItem(id1, 'up'); // Can't move up
            expect(checklist()[0].id).toBe(id1);
            
            store.moveChecklistItem(id1, 'down'); // Can't move down
            expect(checklist()[0].id).toBe(id1);
            
            store.moveChecklistItem('invalid-id', 'up'); // Not found
        });
    });

    describe('Top-level Setters', () => {
        it('sets basic state fields', () => {
            const store = useAppStore.getState();

            store.setCurrentTeam('team-1');
            expect(useAppStore.getState().currentTeamId).toBe('team-1');
            
            store.setCurrentUserId('user-1');
            expect(useAppStore.getState().currentUserId).toBe('user-1');
            
            store.setTeams([{ id: 't-1' } as any]);
            expect(useAppStore.getState().teams).toHaveLength(1);
            
            store.setTeamMembers([{ id: 'm-1' } as any]);
            expect(useAppStore.getState().teamMembers).toHaveLength(1);
            
            store.setIsLoading(true);
            expect(useAppStore.getState().isLoading).toBe(true);
        });
    });

    describe('initializeStore', () => {
        it('migrates from localStorage to IndexedDB', async () => {
            const spy = vi.spyOn(Storage.prototype, 'removeItem');
            localStorage.setItem('falconforge-storage', 'legacy-data');
            
            await useAppStore.getState().initializeStore();
            
            expect(spy).toHaveBeenCalledWith('falconforge-storage');
        });
    });

});
