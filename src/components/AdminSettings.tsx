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

    return (
        <div className="w-full">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Admin Settings</h2>



            {/* Invite Links Section - only show for coaches when Supabase is configured */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6">
                    <InviteManager teamId={currentTeamId || ''} />
                </div>
            )}

            {/* Team Roster Section - only show when Supabase is configured */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <Users className="text-forge-600" size={24} />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Team Roster</h3>
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
