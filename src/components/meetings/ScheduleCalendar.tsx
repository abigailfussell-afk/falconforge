import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { eventTypeMeta } from '../../lib/meetings';
import type { Meeting } from '../../types';
import { useSchedule } from './useSchedule';
import { formatClock, isSameDay, startOfDay } from './format';

/**
 * The calendar view (1j) — a month grid at desktop, a week strip below `lg`.
 *
 * WHY THE WEEK IS NOT A NARROWER MONTH. A month grid at 768px gives each day about 100px of
 * width and 60px of height, into which "6:00p Build session, Room 214" does not go. The
 * mockup answers that with a week strip, which is the same data at a density that fits, and
 * the toggle lets somebody on a tablet choose either. A month grid is genuinely unusable on a
 * phone at any density, so below `sm` the view falls back to the week.
 *
 * Weeks start on Sunday, matching `SprintCalendar` — the app should not disagree with itself
 * about what a week is.
 */
export interface ScheduleCalendarProps {
    /** Where a click on an event goes. Coaches get the detail; students get nothing. */
    interactive?: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ScheduleCalendar({ interactive = false }: ScheduleCalendarProps) {
    const navigate = useNavigate();
    const { all } = useSchedule();
    const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
    const [mode, setMode] = useState<'month' | 'week'>(() =>
        typeof window !== 'undefined' && window.innerWidth < 1024 ? 'week' : 'month',
    );

    const today = startOfDay(Date.now());

    const days = useMemo(
        () => (mode === 'month' ? monthGrid(anchor) : weekGrid(anchor)),
        [anchor, mode],
    );

    const byDay = useMemo(() => {
        const map = new Map<number, Meeting[]>();
        for (const meeting of all) {
            const key = startOfDay(meeting.startsAt);
            const list = map.get(key);
            if (list) list.push(meeting);
            else map.set(key, [meeting]);
        }
        return map;
    }, [all]);

    const step = (direction: -1 | 1) => {
        const date = new Date(anchor);
        if (mode === 'month') date.setMonth(date.getMonth() + direction);
        else date.setDate(date.getDate() + direction * 7);
        setAnchor(startOfDay(date.getTime()));
    };

    const heading =
        mode === 'month'
            ? new Date(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
            : `${new Date(days[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(
                  days[days.length - 1],
              ).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 px-3 py-2">
                <div className="flex items-center gap-1.5">
                    <h2 className="text-base font-bold text-slate-800 dark:text-white">{heading}</h2>
                    <button
                        type="button"
                        onClick={() => step(-1)}
                        aria-label={mode === 'month' ? 'Previous month' : 'Previous week'}
                        className="touch-target rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <button
                        type="button"
                        onClick={() => step(1)}
                        aria-label={mode === 'month' ? 'Next month' : 'Next week'}
                        className="touch-target rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        <ChevronRight size={14} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setAnchor(today)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        Today
                    </button>
                </div>

                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                    {(['week', 'month'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setMode(value)}
                            aria-pressed={mode === value}
                            className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                                mode === value
                                    ? 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white'
                                    : 'text-slate-500 dark:text-slate-400'
                            } ${value === 'month' ? 'hidden sm:block' : ''}`}
                        >
                            {value}
                        </button>
                    ))}
                </div>
            </header>

            <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                {WEEKDAYS.map((label, index) => (
                    <div
                        key={label}
                        className={`px-2 py-1.5 text-center text-2xs font-bold uppercase tracking-wider ${
                            mode === 'week' && isSameDay(days[index], today)
                                ? 'text-forge-600 dark:text-forge-400'
                                : 'text-slate-400'
                        }`}
                    >
                        {label}
                    </div>
                ))}
            </div>

            <div
                data-testid="calendar-grid"
                className={`grid grid-cols-7 ${mode === 'month' ? 'auto-rows-[minmax(5.5rem,auto)]' : 'auto-rows-[minmax(11rem,auto)]'}`}
            >
                {days.map((day) => {
                    const events = byDay.get(day) ?? [];
                    const inMonth = mode === 'week' || new Date(day).getMonth() === new Date(anchor).getMonth();
                    const isNow = isSameDay(day, today);

                    return (
                        <div
                            key={day}
                            className={`border-b border-r border-slate-100 dark:border-slate-700/60 p-1.5 ${
                                inMonth ? '' : 'bg-slate-50/60 dark:bg-slate-900/30'
                            } ${isNow ? 'bg-forge-50 dark:bg-forge-900/10' : ''}`}
                        >
                            <p
                                className={`mb-1 text-xs font-semibold ${
                                    isNow
                                        ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-forge-500 text-white'
                                        : inMonth
                                          ? 'text-slate-500 dark:text-slate-400'
                                          : 'text-slate-300 dark:text-slate-600'
                                }`}
                            >
                                {new Date(day).getDate()}
                            </p>

                            <div className="space-y-1">
                                {events.map((meeting) => {
                                    const type = eventTypeMeta(meeting.eventType);
                                    const content = (
                                        <>
                                            <span className="block truncate font-semibold">
                                                {formatClock(meeting.startsAt).replace(':00', '')}{' '}
                                                {meeting.title}
                                            </span>
                                            {meeting.location && (
                                                <span className="block truncate opacity-80">
                                                    {meeting.location}
                                                </span>
                                            )}
                                        </>
                                    );

                                    return interactive ? (
                                        <button
                                            key={meeting.id}
                                            type="button"
                                            onClick={() => navigate(`/app/meetings/${meeting.id}`)}
                                            className={`block w-full rounded px-1.5 py-1 text-left text-2xs ${type.calendar} hover:brightness-110`}
                                        >
                                            {content}
                                        </button>
                                    ) : (
                                        <div
                                            key={meeting.id}
                                            className={`rounded px-1.5 py-1 text-2xs ${type.calendar}`}
                                        >
                                            {content}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** Every day shown in a month view: the month, padded out to whole weeks. */
function monthGrid(anchor: number): number[] {
    const first = new Date(anchor);
    first.setDate(1);
    first.setDate(first.getDate() - first.getDay());

    const days: number[] = [];
    // Six rows always, so the grid does not change height as the months go by — a calendar
    // that reflows the page under the pointer is a calendar people mis-click.
    for (let i = 0; i < 42; i++) {
        const day = new Date(first);
        day.setDate(first.getDate() + i);
        days.push(startOfDay(day.getTime()));
    }
    return days;
}

/** The Sunday-to-Saturday week containing the anchor. */
function weekGrid(anchor: number): number[] {
    const start = new Date(anchor);
    start.setDate(start.getDate() - start.getDay());

    return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        return startOfDay(day.getTime());
    });
}
