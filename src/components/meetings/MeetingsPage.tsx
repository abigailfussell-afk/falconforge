import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, CalendarDays, KeyRound, List, Plus } from 'lucide-react';
import { useAppShell } from '../AppShell';
import { useAccessState } from '../../lib/entitlement';
import type { Meeting } from '../../types';
import EventManager from './EventManager';
import EventFormModal from './EventFormModal';
import StudentSchedule from './StudentSchedule';
import ScheduleCalendar from './ScheduleCalendar';
import Button from '../ui/Button';

/**
 * The Meetings view — one nav item, two experiences.
 *
 * The nav entry is visible to EVERYBODY, because the schedule is the whole student experience
 * and hiding it would leave students with no way to find out when anything is. What differs is
 * what the page does: an admin, coach or mentor gets the event manager (1a), a student gets
 * their own schedule (1i). The list/calendar toggle is shared, because "when is everything" is
 * the same question whichever side of it you are on.
 *
 * The role check mirrors `can_manage_meetings` server-side and is UX only — a student who
 * types the create URL still meets a database that refuses the insert.
 */
export default function MeetingsPage() {
    const navigate = useNavigate();
    const { canManageMeetings } = useAppShell();
    const { canEdit, editRefusalReason } = useAccessState();
    const [view, setView] = useState<'list' | 'calendar'>('list');
    const [editing, setEditing] = useState<Meeting | null>(null);
    const [creating, setCreating] = useState(false);

    return (
        <div className="space-y-4">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                        {canManageMeetings ? 'Meetings & Events' : 'My schedule'}
                    </h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {canManageMeetings
                            ? 'Schedule practices, meetings and competitions. Post a QR code and attendance records itself.'
                            : 'Read-only. Scan the QR at the meeting to check in, or enter the code by hand.'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                        <ViewButton
                            active={view === 'list'}
                            onClick={() => setView('list')}
                            icon={List}
                            label="List"
                        />
                        <ViewButton
                            active={view === 'calendar'}
                            onClick={() => setView('calendar')}
                            icon={CalendarDays}
                            label="Calendar"
                        />
                    </div>

                    {canManageMeetings ? (
                        <>
                            <Link
                                to="/app/meetings/summary"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                                <BarChart3 size={15} />
                                <span className="hidden sm:inline">Attendance</span>
                            </Link>
                            <Button
                                onClick={() => setCreating(true)}
                                disabled={!canEdit}
                                title={canEdit ? undefined : editRefusalReason}
                                data-testid="new-event"
                            >
                                <Plus size={15} />
                                New event
                            </Button>
                        </>
                    ) : (
                        <Link
                            to="/app/checkin"
                            data-testid="enter-code"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-forge-700 px-3 py-2 text-sm font-semibold text-white shadow-card hover:bg-forge-800"
                        >
                            <KeyRound size={15} />
                            Enter code
                        </Link>
                    )}
                </div>
            </header>

            {view === 'calendar' ? (
                <ScheduleCalendar interactive={canManageMeetings} />
            ) : canManageMeetings ? (
                <EventManager
                    canEdit={canEdit}
                    onCreate={() => setCreating(true)}
                    onEdit={(meeting) => setEditing(meeting)}
                />
            ) : (
                <StudentSchedule />
            )}

            {(creating || editing) && (
                <EventFormModal
                    meeting={editing}
                    onClose={() => {
                        setCreating(false);
                        setEditing(null);
                    }}
                    onCreated={(id) => navigate(`/app/meetings/${id}`)}
                />
            )}
        </div>
    );
}

function ViewButton({
    active,
    onClick,
    icon: Icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: typeof List;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                active
                    ? 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
        >
            <Icon size={14} />
            {label}
        </button>
    );
}
