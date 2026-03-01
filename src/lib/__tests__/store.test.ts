import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store';

describe('AppStore', () => {
    beforeEach(() => {
        // Reset store to initial state before each test
        useAppStore.setState({
            tasks: [],
            checklist: [],
            scoutingReports: [],
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

            const checklist = useAppStore.getState().checklist;
            expect(checklist).toHaveLength(1);
            expect(checklist[0].text).toBe('New checklist item');
            expect(checklist[0].checked).toBe(false);
        });

        it('should toggle a checklist item', () => {
            const store = useAppStore.getState();

            store.addChecklistItem('Toggle me');
            const itemId = useAppStore.getState().checklist[0].id;

            // Toggle to checked
            store.toggleChecklistItem(itemId);
            expect(useAppStore.getState().checklist[0].checked).toBe(true);

            // Toggle back to unchecked
            store.toggleChecklistItem(itemId);
            expect(useAppStore.getState().checklist[0].checked).toBe(false);
        });

        it('should delete a checklist item', () => {
            const store = useAppStore.getState();

            store.addChecklistItem('Delete me');
            const itemId = useAppStore.getState().checklist[0].id;
            expect(useAppStore.getState().checklist).toHaveLength(1);

            store.deleteChecklistItem(itemId);
            expect(useAppStore.getState().checklist).toHaveLength(0);
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
                        checklist: [], timeline: [], createdAt: 1000,
                    },
                ],
                scoutingReports: [
                    {
                        id: 'sr-1', teamNumber: '12345', matchNumber: 1, hasAutonomous: false,
                        autoScore: 0, intakeType: 'No Intake' as const, autoAim: false,
                        farShooting: false, shotsTaken: 0, shotsMissed: 0,
                        parking: 'No Park' as const, rating: 1, endGameNotes: '',
                    },
                ],
                checklist: [{ id: 'cl-1', text: 'Dirty item', checked: true }],
                matchPlans: [{ id: 'mp-1', title: 'Plan 1', notes: 'Dirty', drawingData: '', allianceTeam: '', partnerAutonomous: false, partnerPark: false, updatedAt: 1000 }],
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
            // Seasons should be reset to default (1 default season)
            expect(state.seasons).toHaveLength(1);
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

    describe('PortfolioHistory', () => {
        beforeEach(() => {
            useAppStore.setState({ portfolioHistory: [] });
        });

        it('should add a portfolio entry', () => {
            useAppStore.getState().addPortfolioEntry('Summary', 5);
            const entries = useAppStore.getState().portfolioHistory;

            expect(entries).toHaveLength(1);
            expect(entries[0].content).toBe('Summary');
            expect(entries[0].taskCount).toBe(5);
        });

        it('should delete a portfolio entry', () => {
            useAppStore.getState().addPortfolioEntry('Summary', 5);
            const entryId = useAppStore.getState().portfolioHistory[0].id;

            useAppStore.getState().deletePortfolioEntry(entryId);
            expect(useAppStore.getState().portfolioHistory).toHaveLength(0);
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
});
