import { useMemo, useState } from 'react';
import { AlertTriangle, ClipboardPaste, Check, X } from 'lucide-react';
import { parseSchedule, summarise, type ParsedMatch } from '../../lib/schedule-parse';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

/**
 * Paste a schedule, look at what we made of it, then import (D2).
 *
 * THE PREVIEW IS THE FEATURE. D2: *"the parser is heuristic (pasted text has no table
 * structure, and team names contain digits), so the preview-and-confirm step is load-bearing
 * and an import must never write silently."* Everything below exists to make the coach's
 * five-second scan of the result productive:
 *
 *   - OUR OWN MATCHES ARE MARKED, because that is what they came for and it is the fastest way
 *     to spot that the parser mis-split a name — if your team is missing from a match you know
 *     you are in, something went wrong on that row.
 *   - WARNINGS ARE PER MATCH AND IN WORDS, not a count at the top. "Ignored 108, 11 — usually
 *     the scores" is checkable against the page in one glance; "3 warnings" is not.
 *   - SKIPPED LINES ARE SHOWN WITH THEIR TEXT. A line the parser could not use is the one most
 *     likely to matter, and hiding it behind a number is how a coach discovers at the venue
 *     that match 14 is missing.
 *
 * WHAT THIS SCREEN DOES NOT DO: fetch anything. The coach copies from their own browser. A
 * paid product scraping FIRST's pages carries the same commercial-use exposure as the API that
 * D2 exists to avoid, and arguably worse.
 */
export interface SchedulePasteImportProps {
    /** Our own team number, so the preview can mark the matches the coach cares about. */
    ourTeamNumber?: string;
    /** 2 for FTC, 3 for FRC — from the season's game definition, never assumed. */
    allianceSize: 2 | 3;
    onCancel: () => void;
    onConfirm: (matches: ParsedMatch[]) => void;
}

export default function SchedulePasteImport({
    ourTeamNumber,
    allianceSize,
    onCancel,
    onConfirm,
}: SchedulePasteImportProps) {
    const [text, setText] = useState('');

    const parsed = useMemo(
        () => (text.trim() ? parseSchedule(text, allianceSize) : null),
        [text, allianceSize],
    );
    const counts = useMemo(
        () => (parsed ? summarise(parsed, ourTeamNumber) : null),
        [parsed, ourTeamNumber],
    );

    const isOurs = (match: ParsedMatch) =>
        !!ourTeamNumber && match.participants.some((p) => p.teamNumber === ourTeamNumber.trim());

    return (
        <Modal label="Import a schedule" width="dialog" className="flex flex-col overflow-hidden" onClose={onCancel}>
            <div className="border-b border-slate-200 bg-slate-50 p-4 text-lg font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                Import a schedule
            </div>

            <div className="space-y-4 overflow-y-auto p-4 md:p-6">
                {/*
                  * THE INSTRUCTIONS ARE PART OF THE FEATURE, and D2 asks for them by name
                  * ("With instructions"). A coach who has never done this has no idea that the
                  * app expects a browser copy rather than a screenshot or a PDF.
                  */}
                <ol className="list-inside list-decimal space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">
                    <li>
                        Open your event&apos;s schedule at{' '}
                        <code className="font-mono text-xs">
                            ftc-events.firstinspires.org
                        </code>{' '}
                        and find the Qualifications tab.
                    </li>
                    <li>Select the whole table and copy it.</li>
                    <li>Paste it below. Nothing is saved until you press Import.</li>
                </ol>

                <div>
                    <label
                        htmlFor="schedule-paste"
                        className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                        Pasted schedule
                    </label>
                    <textarea
                        id="schedule-paste"
                        data-testid="schedule-paste"
                        rows={6}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Qualification 1  Sat 2/21 - 11:42 AM  22857 Mechanical Mustangs  8424 Cyber Eagles  15654 Nanoknights  25756 Nano Ninjas"
                        className="field w-full font-mono text-xs"
                    />
                </div>

                {/*
                  * NOTHING PASTED YET is a different state from NOTHING RECOGNISED, which is a
                  * different state from a schedule with problems. `docs/failure-modes.md` §4:
                  * the zero case is the first case, not an edge one, and here there are three
                  * of them.
                  */}
                {parsed && parsed.unrecognised && (
                    <p
                        role="alert"
                        data-testid="paste-unrecognised"
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
                    >
                        Nothing here looks like a match schedule. Each row should start with
                        &ldquo;Qualification&rdquo; and a number. If you copied the rankings tab
                        by mistake, go back and pick Qualifications.
                    </p>
                )}

                {counts && !parsed?.unrecognised && (
                    <div
                        data-testid="paste-summary"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                    >
                        <p className="font-semibold text-slate-800 dark:text-white">
                            {counts.matchCount} match{counts.matchCount === 1 ? '' : 'es'} found
                            {ourTeamNumber
                                ? ` · ${counts.ourMatchCount} with team ${ourTeamNumber}`
                                : ''}
                        </p>
                        {/*
                          * "0 of yours" on a schedule that parsed fine is the single most
                          * useful warning this screen can give: it almost always means the
                          * coach pasted another division's page.
                          */}
                        {ourTeamNumber && counts.ourMatchCount === 0 && counts.matchCount > 0 && (
                            <p className="mt-1 text-amber-700 dark:text-amber-400">
                                Team {ourTeamNumber} is not in any of these. Is this the right
                                division?
                            </p>
                        )}
                        {counts.skippedCount > 0 && (
                            <p className="mt-1 text-amber-700 dark:text-amber-400">
                                {counts.skippedCount} line
                                {counts.skippedCount === 1 ? '' : 's'} could not be read — see
                                below.
                            </p>
                        )}
                    </div>
                )}

                {parsed && parsed.matches.length > 0 && (
                    <div>
                        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            What we made of it
                        </h4>
                        <ul data-testid="paste-preview" className="space-y-2">
                            {parsed.matches.map((match) => (
                                <li
                                    key={`${match.phase}-${match.matchNumber}`}
                                    data-testid="paste-preview-match"
                                    className={`rounded-lg border p-2 text-xs ${
                                        isOurs(match)
                                            ? 'border-forge-400 bg-forge-500/10'
                                            : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/40'
                                    }`}
                                >
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <span className="font-semibold text-slate-800 dark:text-white">
                                            {match.phase === 'qualification'
                                                ? 'Qual'
                                                : match.phase === 'playoff'
                                                  ? 'Playoff'
                                                  : 'Practice'}{' '}
                                            {match.matchNumber}
                                            {isOurs(match) && (
                                                <span className="ml-2 rounded-full bg-forge-500/20 px-2 py-0.5 text-2xs font-bold text-forge-700 dark:text-forge-300">
                                                    yours
                                                </span>
                                            )}
                                        </span>
                                        <span className="text-slate-500 dark:text-slate-400">
                                            {match.scheduledText || 'no time'}
                                        </span>
                                    </div>
                                    <div className="mt-1 grid grid-cols-2 gap-2">
                                        {(['red', 'blue'] as const).map((alliance) => (
                                            <div key={alliance}>
                                                <span
                                                    className={
                                                        alliance === 'red'
                                                            ? 'text-2xs font-bold uppercase text-red-600 dark:text-red-400'
                                                            : 'text-2xs font-bold uppercase text-blue-600 dark:text-blue-400'
                                                    }
                                                >
                                                    {alliance}
                                                </span>
                                                {match.participants
                                                    .filter((p) => p.alliance === alliance)
                                                    .map((p) => (
                                                        <div
                                                            key={`${p.alliance}-${p.station}`}
                                                            className="truncate text-slate-700 dark:text-slate-200"
                                                        >
                                                            {p.teamNumber}{' '}
                                                            <span className="text-slate-500 dark:text-slate-400">
                                                                {p.teamName || '(no name)'}
                                                            </span>
                                                            {p.isSurrogate && (
                                                                <span className="ml-1 text-amber-600 dark:text-amber-400">
                                                                    surrogate
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                            </div>
                                        ))}
                                    </div>
                                    {match.warnings.length > 0 && (
                                        <ul
                                            data-testid="paste-preview-warnings"
                                            className="mt-1 space-y-0.5 text-amber-700 dark:text-amber-400"
                                        >
                                            {match.warnings.map((warning) => (
                                                <li key={warning} className="flex items-start gap-1">
                                                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                                    <span>{warning}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {parsed && parsed.skipped.length > 0 && (
                    <div>
                        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                            Lines we could not read
                        </h4>
                        {/* WITH THEIR TEXT, not just a count. A line the parser could not use is
                            the one most likely to matter, and a number hides which match is
                            about to be missing at the venue. */}
                        <ul data-testid="paste-skipped" className="space-y-1">
                            {parsed.skipped.map((entry, i) => (
                                <li
                                    key={i}
                                    className="rounded border border-amber-300 bg-amber-50 p-2 text-2xs dark:border-amber-700/60 dark:bg-amber-900/20"
                                >
                                    <div className="font-mono text-slate-700 dark:text-slate-200">
                                        {entry.line.slice(0, 120)}
                                    </div>
                                    <div className="mt-0.5 text-amber-800 dark:text-amber-300">
                                        {entry.reason} — add it by hand after importing.
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                <Button variant="secondary" onClick={onCancel} data-testid="paste-cancel">
                    <X size={15} /> Cancel
                </Button>
                <Button
                    data-testid="paste-confirm"
                    onClick={() => parsed && onConfirm(parsed.matches)}
                    disabled={!parsed || parsed.matches.length === 0}
                    title={
                        !parsed
                            ? 'Paste a schedule first'
                            : parsed.matches.length === 0
                              ? 'Nothing here could be read as a match'
                              : `Import ${parsed.matches.length} matches`
                    }
                >
                    <Check size={15} />
                    Import {parsed?.matches.length ?? 0}{' '}
                    {parsed?.matches.length === 1 ? 'match' : 'matches'}
                </Button>
            </div>
        </Modal>
    );
}

export { ClipboardPaste };
