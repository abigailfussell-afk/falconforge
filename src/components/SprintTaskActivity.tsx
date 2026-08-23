import React, { useState } from 'react';
import { TeamMember, TimelineEvent } from '../types';
import { Send, Trash2 } from 'lucide-react';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { getMemberDisplayName, getMemberInitials } from '../lib/member-utils';
import { useAuth } from '../lib/auth';

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
    const { profile, displayName, initials: userInitials } = useAuth();

    const submit = () => {
        if (!newComment.trim()) return;
        onAddComment(newComment);
        setNewComment('');
    };

    /**
     * An author is one of: the signed-in user, the System pseudo-author used for automatic
     * history entries, a member still on the roster, or -- for comments left by someone
     * since removed from the team -- nobody we can name, hence "Guest".
     *
     * TWO IDS ARE ACCEPTED, AND THAT IS NOT BELT-AND-BRACES (FEAT-01).
     *
     * `TimelineEvent.authorId` is documented as a TeamMember id and the writer stored the
     * AUTH USER id, so every comment anybody else left rendered as "Guest" with a "G" —
     * on the board's only collaboration surface, from the first day a team used it. The
     * author saw their own name, because the `profile.id` line above short-circuits before
     * the lookup ever runs, which is why nobody writing it would notice.
     *
     * The writer stores the member id now. This still matches `userId` as well, because
     * every comment written before today is on a device and in a database somewhere with the
     * old value in it, and a fix that renamed everybody's history to "Guest" for ever would
     * be a worse bug than the one it closed.
     *
     * `!m.managedProfileId` is the same load-bearing clause as `AppShell`'s `currentMember`:
     * a guardian's roster row carries THEIR user id and their CHILD's profile, so without it
     * a guardian's comment would be attributed to their child.
     */
    const describeAuthor = (authorId: string): { name: string; initials: string } => {
        if (authorId === 'System') return { name: 'System', initials: 'S' };
        if (profile && authorId === profile.id) {
            return { name: displayName, initials: userInitials };
        }
        const member =
            teamMembers.find((m) => m.id === authorId) ??
            teamMembers.find((m) => m.userId === authorId && !m.managedProfileId);
        if (member) {
            return { name: getMemberDisplayName(member), initials: getMemberInitials(member) };
        }
        return { name: 'Guest', initials: 'G' };
    };

    return (
        <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
            <h3 className="font-bold text-slate-800 dark:text-white mb-3">Activity &amp; Comments</h3>

            <div className="flex items-center gap-2 mb-4">
                <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    className="field flex-1"
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
                {/* `!px-2.5`: the sm recipe's px-3 would win the cascade over a plain px-2.5,
                    so the icon-only override needs the important modifier. */}
                <Button size="sm" onClick={submit} disabled={!newComment.trim()} className="!px-2.5" title="Send comment">
                    <Send size={18} />
                </Button>
            </div>

            <div className="space-y-3">
                {timeline.map((event) => {
                    const author = describeAuthor(event.authorId);

                    return (
                        <div key={event.id} className="flex items-start gap-3 text-sm">
                            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300 flex-shrink-0">
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
                                        <IconButton
                                            danger
                                            onClick={() => onDeleteComment(event.id)}
                                            className="p-1 text-xs gap-1"
                                            title="Delete comment"
                                        >
                                            <Trash2 size={12} /> Delete
                                        </IconButton>
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
