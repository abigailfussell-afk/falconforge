import React, { useState } from 'react';
import { TeamMember, TimelineEvent } from '../types';
import { Send, Trash2 } from 'lucide-react';
import { useCurrentUser } from '../lib/user-context';
import { getMemberDisplayName, getMemberInitials } from '../lib/member-utils';

/**
 * The activity feed and comment box for a task.
 *
 * Split out of SprintTaskDetail because it is the only part of that modal with real logic
 * rather than form bindings: resolving each timeline entry's author across three different
 * cases (the current user, another roster member, or the System pseudo-author), with a
 * fallback for authors who are no longer on the team.
 */
interface SprintTaskActivityProps {
    timeline: TimelineEvent[];
    teamMembers: TeamMember[];
    onAddComment: (text: string) => void;
    onDeleteComment: (commentId: string) => void;
}

const SprintTaskActivity: React.FC<SprintTaskActivityProps> = ({
    timeline,
    teamMembers,
    onAddComment,
    onDeleteComment,
}) => {
    const [newComment, setNewComment] = useState('');
    const { currentUser, displayName, initials: userInitials } = useCurrentUser();

    const submit = () => {
        if (!newComment.trim()) return;
        onAddComment(newComment);
        setNewComment('');
    };

    /**
     * An author is one of: the signed-in user, the System pseudo-author used for automatic
     * history entries, a member still on the roster, or -- for comments left by someone
     * since removed from the team -- nobody we can name, hence "Guest".
     */
    const describeAuthor = (authorId: string): { name: string; initials: string } => {
        if (authorId === 'System') return { name: 'System', initials: 'S' };
        if (currentUser && authorId === currentUser.id) {
            return { name: displayName, initials: userInitials };
        }
        const member = teamMembers.find((m) => m.id === authorId);
        if (member) {
            return { name: getMemberDisplayName(member), initials: getMemberInitials(member) };
        }
        return { name: 'Guest', initials: 'G' };
    };

    return (
        <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Activity &amp; Comments</h3>

            <div className="flex items-center gap-2 mb-6">
                <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
                <button onClick={submit} className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 flex items-center justify-center">
                    <Send size={18} />
                </button>
            </div>

            <div className="space-y-4">
                {timeline.map((event) => {
                    const author = describeAuthor(event.authorId);

                    return (
                        <div key={event.id} className="flex gap-3 text-sm">
                            <div className="mt-1 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300 flex-shrink-0">
                                {author.initials}
                            </div>
                            <div className="flex-1 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-r-lg rounded-bl-lg">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-bold text-slate-700 dark:text-slate-200">
                                        {author.name}
                                    </span>
                                    <span className="text-xs text-slate-400">{new Date(event.timestamp).toLocaleDateString()}</span>
                                </div>
                                <div className={event.type === 'history' ? 'italic text-slate-500' : 'text-slate-800 dark:text-slate-300'}>
                                    {event.content}
                                </div>
                                {event.type === 'comment' && (
                                    <div className="flex justify-end mt-2">
                                        <button onClick={() => onDeleteComment(event.id)} className="text-xs text-red-500 hover:text-red-700 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded inline-flex items-center gap-1 transition-colors">
                                            <Trash2 size={12} /> Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SprintTaskActivity;
