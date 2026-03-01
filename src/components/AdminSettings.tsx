import React from 'react';
import { Users } from 'lucide-react';
import { SubTeam, TeamMember } from '../types';
import { useAppStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import InviteManager from './InviteManager';
import MemberManager from './MemberManager';
import TeamRosterManager from './TeamRosterManager';
import SubTeamManager from './SubTeamManager';
import SeasonManager from './SeasonManager';
import { getMemberDisplayName, getMemberInitials } from '../lib/member-utils';


interface AdminSettingsProps {
    teamMembers: TeamMember[];
    setTeamMembers: (members: TeamMember[]) => void;
    subTeams: SubTeam[];
    setSubTeams: (subTeams: SubTeam[]) => void;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ teamMembers, setTeamMembers, subTeams, setSubTeams }) => {
    // Auth state for displaying sections
    const { user, isConfigured } = useAuth();
    const currentTeamId = useAppStore((state) => state.currentTeamId);

    // Filter subteams for the current season if desired, or show all
    // Left as-is from original code to show all subteams
    const getMemberDisplayNameWrapper = (member: TeamMember): string => {
        return getMemberDisplayName(member);
    };

    const getMemberInitialsWrapper = (member: TeamMember): string => {
        return getMemberInitials(member);
    };

    return (
        <div className="max-w-6xl mx-auto w-full h-full overflow-y-auto overflow-x-hidden">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">Admin Settings</h2>



            {/* Invite Links Section - only show for coaches when Supabase is configured */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 mb-6">
                    <InviteManager teamId={currentTeamId || ''} />
                </div>
            )}

            {/* Member Management Section - only show when Supabase is configured */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 mb-6">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <Users className="text-orange-600" size={24} />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Member Management</h3>
                    </div>
                    <MemberManager
                        teamId={currentTeamId || ''}
                        teamMembers={teamMembers}
                        onMembersChange={() => {
                            // Refresh team members from store
                            // The store handles syncing with Supabase
                        }}
                    />
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8">
                {/* Team Roster (TeamMembers) */}
                <TeamRosterManager
                    teamMembers={teamMembers}
                    setTeamMembers={setTeamMembers}
                    subTeams={subTeams}
                    setSubTeams={setSubTeams}
                    getMemberDisplayName={getMemberDisplayNameWrapper}
                    getMemberInitials={getMemberInitialsWrapper}
                />

                {/* Sub-Teams Management */}
                <SubTeamManager
                    subTeams={subTeams}
                    teamMembers={teamMembers}
                    getMemberDisplayName={getMemberDisplayNameWrapper}
                />
            </div>

            {/* Season Manager */}
            <SeasonManager />
        </div>
    );
};

export default AdminSettings;
