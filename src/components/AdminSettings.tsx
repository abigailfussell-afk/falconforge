import React from 'react';
import { Users } from 'lucide-react';
import { SubTeam, TeamMember } from '../types';
import { useAppStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import InviteManager from './InviteManager';
import MemberManager from './MemberManager';
import SubTeamManager from './SubTeamManager';
import SeasonManager from './SeasonManager';
import { getMemberDisplayName } from '../lib/member-utils';
import SectionHeader from './ui/SectionHeader';
import EntitlementPanel from './admin/EntitlementPanel';
import AdminTransferPanel from './admin/AdminTransferPanel';
import AcceptAdminNomination from './admin/AcceptAdminNomination';
import { fetchTeamData } from '../lib/server-pull';


interface AdminSettingsProps {
    teamMembers: TeamMember[];
    subTeams: SubTeam[];
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ teamMembers, subTeams }) => {
    // Auth state for displaying sections
    const { user, isConfigured } = useAuth();
    const currentTeamId = useAppStore((state) => state.currentTeamId);

    // Wrapper for getMemberDisplayName used by SubTeamManager
    const getMemberDisplayNameWrapper = (member: TeamMember): string => {
        return getMemberDisplayName(member);
    };

    /**
     * Re-read the team after something that changes who is on it.
     *
     * `onMembersChange` was an empty function with a comment saying the store handles it. It
     * does not: `fetchTeamData` runs on team change, and approving a member or accepting a
     * handover alters the roster without changing the team. So the seat count and the role
     * badges stayed stale until a navigation — which is exactly the screen where "12 of 15
     * seats" must not lie the moment after you approve somebody.
     */
    const refreshTeam = () => {
        if (currentTeamId) fetchTeamData(currentTeamId).catch(console.error);
    };

    return (
        <div className="w-full">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Admin Settings</h2>

            {/*
              * FIRST, ABOVE EVERYTHING. A nomination waiting on this person is the only thing on
              * this page that another human is blocked on, and it renders nothing at all unless
              * they are the nominee.
              */}
            {isConfigured && user && (
                <AcceptAdminNomination
                    teamId={currentTeamId || ''}
                    teamMembers={teamMembers}
                    onTransferred={refreshTeam}
                />
            )}

            {/* Licence and seats — the answer to "can I approve one more member". */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6">
                    <EntitlementPanel />
                </div>
            )}

            {/* Invite Links Section - only show for coaches when Supabase is configured */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6">
                    <InviteManager teamId={currentTeamId || ''} />
                </div>
            )}

            {/* Team Roster Section - only show when Supabase is configured */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6">
                    <SectionHeader icon={Users} title="Team Roster" />
                    <MemberManager
                        teamId={currentTeamId || ''}
                        teamMembers={teamMembers}
                        onMembersChange={refreshTeam}
                    />
                </div>
            )}

            {/* Handing the team over. */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6">
                    <AdminTransferPanel teamId={currentTeamId || ''} teamMembers={teamMembers} />
                </div>
            )}

            {/* Sub-Teams Management */}
            <SubTeamManager
                subTeams={subTeams}
                teamMembers={teamMembers}
                getMemberDisplayName={getMemberDisplayNameWrapper}
            />

            {/* Season Manager */}
            <SeasonManager />
        </div>
    );
};

export default AdminSettings;
