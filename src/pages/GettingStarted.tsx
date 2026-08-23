import { Link } from 'react-router-dom';
import {
    Rocket,
    Users,
    CalendarDays,
    WifiOff,
    Baby,
    LifeBuoy,
    QrCode,
    ExternalLink,
} from 'lucide-react';
import SectionHeader from '../components/ui/SectionHeader';
import { useFeedbackLink } from '../lib/use-feedback-link';
import { pathFor } from '../lib/navigation';

/**
 * What to do first, for each kind of person who signs in.
 *
 * WHY THIS PAGE EXISTS. Beta support arrives as email, and every hour spent answering "where
 * do I put the sub-teams" is an hour not spent on the thing the beta is for. There was no help
 * of any kind in the app before this: the only inbound channel was the feedback mailto in the
 * sidebar, which is a fine way to report a bug and a poor way to ask a question you could have
 * answered yourself.
 *
 * IT IS NOT TEAM-SCOPED, deliberately, and that is the one interesting decision here. Every
 * other view carries `requiresTeam` because it would render an empty screen without one — but
 * the two people most likely to need instructions are a coach who has not created a team yet
 * and a guardian who never will have one. Gating the help behind having finished the thing the
 * help explains is the shape this page exists to avoid.
 *
 * The links go through `pathFor` rather than hardcoded strings, so a route that moves takes
 * this page with it instead of leaving a page of confident 404s. That is the same reason
 * `navigation.ts` exists at all.
 */
export default function GettingStarted() {
    const feedbackLink = useFeedbackLink();

    return (
        <div className="mx-auto max-w-3xl space-y-4 pb-8">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
                    <Rocket size={22} className="text-forge-600 dark:text-forge-400" aria-hidden="true" />
                    Getting started
                </h1>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    FalconForge is in beta. If something here does not match what you see, that is
                    worth telling us about — the link at the bottom goes straight to a person.
                </p>
            </header>

            {/* ---------------------------------------------------------------- coaches */}
            <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={Users} title="If you registered the team" />
                <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                    You are the team&apos;s primary admin. Five things, roughly in this order, and
                    the whole lot takes about ten minutes.
                </p>
                <ol className="space-y-3">
                    {[
                        {
                            title: 'Check your season',
                            body: (
                                <>
                                    Registering the team created your first season. Everything else —
                                    the board, scouting, match plans — hangs off it. You can rename it
                                    or add next year&apos;s from{' '}
                                    <Link to={pathFor('admin')} className="text-forge-600 underline dark:text-forge-400">
                                        Admin Settings
                                    </Link>
                                    .
                                </>
                            ),
                        },
                        {
                            title: 'Set up your sub-teams',
                            body: (
                                <>
                                    Build, Programming, Media, Outreach — whatever your team actually
                                    uses. Tasks and members are assigned to these, so it is worth doing
                                    before you invite anybody. Next season can clone the structure
                                    without carrying over who was on it.
                                </>
                            ),
                        },
                        {
                            title: 'Invite your team',
                            body: (
                                <>
                                    Admin Settings gives you an invite code. Share it however you
                                    already talk to your team — a code is not an email, so nobody has
                                    to wait for one to arrive. Each person signs up, enters the code,
                                    and lands in your approval queue.
                                </>
                            ),
                        },
                        {
                            title: 'Approve the people you recognise',
                            body: (
                                <>
                                    Joining does not grant access; approving does. Until you approve
                                    someone they can see nothing of your team&apos;s data. If a parent
                                    is joining on behalf of a child under 13, you will be asked to
                                    confirm that — see the guardians section below.
                                </>
                            ),
                        },
                        {
                            title: 'Schedule your first meeting',
                            body: (
                                <>
                                    <Link to={pathFor('meetings')} className="text-forge-600 underline dark:text-forge-400">
                                        Meetings
                                    </Link>{' '}
                                    handles practices, builds, competitions, outreach and deadlines,
                                    one-off or recurring. Print the QR poster for the session and
                                    students check themselves in as they arrive.
                                </>
                            ),
                        },
                    ].map((step, i) => (
                        <li key={i} className="flex gap-3">
                            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-forge-500/15 text-xs font-bold text-forge-700 dark:text-forge-400">
                                {i + 1}
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                                    {step.title}
                                </div>
                                <p className="text-sm text-slate-600 dark:text-slate-400">{step.body}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </section>

            {/* ---------------------------------------------------------------- students */}
            <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={QrCode} title="If you are on the team" />
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                    <li>
                        <strong className="text-slate-800 dark:text-slate-200">Checking in.</strong>{' '}
                        Point your phone&apos;s camera at the poster at the meeting, or type the
                        four-digit code on it. Each session has its own code, and it only works during
                        that session — a photo of last week&apos;s poster will not check you in.
                    </li>
                    <li>
                        <strong className="text-slate-800 dark:text-slate-200">The board.</strong> Your
                        tasks live in{' '}
                        <Link to={pathFor('kanban')} className="text-forge-600 underline dark:text-forge-400">
                            Sprint Planning
                        </Link>
                        , grouped by sub-team. Drag a card as the work moves.
                    </li>
                    <li>
                        <strong className="text-slate-800 dark:text-slate-200">
                            Install it on your phone.
                        </strong>{' '}
                        Use your browser&apos;s &ldquo;Add to Home Screen&rdquo;. It then opens like an
                        app and works without signal, which is the point at a competition venue.
                    </li>
                </ul>
            </section>

            {/* ---------------------------------------------------------------- offline */}
            <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={WifiOff} title="It works without WiFi" />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                    Venue WiFi is unreliable, so FalconForge does not depend on it. Keep working with
                    no signal — add tasks, log scouting, tick the checklist — and everything syncs when
                    you are back online. The indicator in the sidebar tells you what is still waiting
                    to sync. Nothing is dropped: if a change cannot be sent, it is held and retried
                    rather than discarded quietly.
                </p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    The one thing that does need a connection is signing in for the first time on a
                    device. Sign in once at home before a competition.
                </p>
            </section>

            {/* ---------------------------------------------------------------- guardians */}
            <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={Baby} title="If your child is under 13" />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                    Children under 13 do not get their own login. Instead you — the parent or guardian
                    — sign up, add a profile for your child, and join the team with the coach&apos;s
                    ordinary invite code on their behalf. You give consent at the same time, so there
                    is nothing to chase afterwards.
                </p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    You manage everything from{' '}
                    <Link to={pathFor('guardian')} className="text-forge-600 underline dark:text-forge-400">
                        My children
                    </Link>
                    : consents given, upcoming meetings, attendance. Your child cannot check themselves
                    in — a coach marks them present — and when they are old enough you can give them
                    their own login without losing their place on the team or their history.
                </p>
            </section>

            {/* ---------------------------------------------------------------- meetings */}
            <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={CalendarDays} title="Taking attendance" />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                    Coaches, mentors and admins can open a session&apos;s roster and mark people
                    present directly — there is a rapid-tap grid for walking the room. Use it alongside
                    the QR poster rather than instead of it: the poster covers everyone who arrives on
                    time, and the roster covers the stragglers and anyone whose phone is flat.
                </p>
            </section>

            {/* ---------------------------------------------------------------- support */}
            <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={LifeBuoy} title="Still stuck?" />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                    This is a beta run by one person, and questions are genuinely welcome — a question
                    you had is usually a page that needed writing.
                </p>
                <a
                    href={feedbackLink}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-forge-600 px-3 py-2 text-sm font-medium text-white hover:bg-forge-700"
                >
                    <ExternalLink size={16} aria-hidden="true" />
                    Email support
                </a>
            </section>
        </div>
    );
}
