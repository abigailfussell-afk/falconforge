/**
 * Turning a pasted FIRST schedule into matches (D2).
 *
 * WHY PASTE AND NOT A FETCH. Kevin, 2026-08-23: *"FalconForge never calls the API … a paid
 * product scraping FIRST data server-side carries the same commercial-use exposure as the API,
 * arguably worse."* The FTC Events API terms say the data *"may not be used for commercial
 * purposes"*. The coach copies their own event's public page and pastes it; the fetch stays
 * with the human, which is the entire legal position.
 *
 * WHAT THE INPUT ACTUALLY LOOKS LIKE, verified 2026-08-23 against
 * `ftc-events.firstinspires.org/<year>/<code>/qualifications` — a real page, needing no token.
 * Copied out of a browser, one match is one line and the table structure is gone:
 *
 *     Qualification 1  Sat 2/21 - 11:42 AM  22857 Mechanical Mustangs  8424 Cyber Eagles  15654 Nanoknights  25756 Nano Ninjas  108  11
 *                                           └─────────── red ───────────┘  └────────────── blue ──────────────┘  red  blue
 *
 * THE PARSER IS HEURISTIC AND SAYS SO. There is no delimiter between a team's number and its
 * name, no delimiter between one team and the next, and **team names contain digits** —
 * "Nanoknights" does not, but "Team 5 Robotics", "RoboHawks 2.0" and "24 Karat" all do, and
 * they are ordinary names. So "read a number, then read words until the next number" is wrong
 * on real data, and no amount of care makes it right.
 *
 * Which is why D2 calls the preview LOAD-BEARING: *"the preview-and-confirm step is
 * load-bearing and an import must never write silently."* This module's job is to produce a
 * BEST GUESS plus an honest account of what it was unsure about. The screen shows both, the
 * coach fixes what is wrong, and only then does anything reach the database.
 *
 * The parser is also not the substrate. Every field it fills is enterable and editable by hand,
 * because a coach whose schedule is not published yet — normal on the morning of an event — has
 * to be able to build the whole thing without this file existing.
 */

/** How many teams per alliance we expect. FTC is 2, FRC is 3; taken from the game definition. */
export type AllianceSize = 2 | 3;

export interface ParsedParticipant {
    alliance: 'red' | 'blue';
    station: number;
    teamNumber: string;
    teamName: string;
    isSurrogate: boolean;
}

export interface ParsedMatch {
    /** 1-based, from the "Qualification N" label. */
    matchNumber: number;
    phase: 'practice' | 'qualification' | 'playoff';
    /** As it appeared. Not parsed into a timestamp — see `scheduledText` below. */
    scheduledText: string;
    participants: ParsedParticipant[];
    /**
     * Things the parser is not sure about, in words a coach can check against the page.
     *
     * Not an error list. A match with warnings is still imported — after the coach has looked
     * at it — because a wrong team NAME beside a right team NUMBER is worth importing and
     * correcting, and refusing the whole paste over one odd row is how a coach ends up typing
     * sixty matches by hand at 8am.
     */
    warnings: string[];
}

export interface ParseResult {
    matches: ParsedMatch[];
    /** Lines that looked like they should be matches and were not usable. */
    skipped: { line: string; reason: string }[];
    /** True when nothing at all was recognised — a different message from "0 matches found". */
    unrecognised: boolean;
}

const PHASES: Record<string, ParsedMatch['phase']> = {
    practice: 'practice',
    qualification: 'qualification',
    qual: 'qualification',
    playoff: 'playoff',
    elimination: 'playoff',
    elim: 'playoff',
    semifinal: 'playoff',
    final: 'playoff',
};

/**
 * A team number as FIRST issues them: 1–5 digits, no leading zero.
 *
 * The leading-zero rule is what makes this usable at all. Without it, `2.0` in "RoboHawks 2.0"
 * matches as team 0, and a date fragment like `02` matches as team 2. FIRST has never issued a
 * number with a leading zero, so excluding them costs nothing and removes the two commonest
 * false positives on this page.
 */
const TEAM_NUMBER = /\b([1-9][0-9]{0,4})\b/g;

/**
 * The time column, which has to be removed BEFORE looking for team numbers.
 *
 * `Sat 2/21 - 11:42 AM` contains 2, 21, 11 and 42, every one of which is a plausible team
 * number, and three of them are in the FTC range. Stripping the whole fragment is more robust
 * than trying to exclude those four values, because the alternative is a parser whose
 * correctness depends on which teams happen to be at the event.
 */
const TIME_FRAGMENT =
    /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*[-–]?\s*\d{1,2}:\d{2}\s*(?:am|pm)?/i;

/** A bare time, for pages that print the day once and the time per row. */
const BARE_TIME = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i;

const MATCH_LABEL = /^\s*([A-Za-z]+)\s+(\d{1,3})\b/;

/**
 * Scores, which trail the row and are NOT team numbers.
 *
 * The example row ends `… 25756 Nano Ninjas 108 11` — 108 and 11 are the red and blue scores of
 * a played match, and both are valid FTC team numbers. This is the single most dangerous
 * ambiguity on the page: mistaking them for teams puts two robots into an alliance that has
 * two already.
 *
 * Resolved structurally rather than by cleverness: take the FIRST `2 × allianceSize` numbers on
 * the line and warn about anything after them. The schedule always lists red then blue, in
 * station order, before any scores — so position answers a question that content cannot.
 */
export function parseSchedule(text: string, allianceSize: AllianceSize = 2): ParseResult {
    const matches: ParsedMatch[] = [];
    const skipped: { line: string; reason: string }[] = [];
    let sawAnything = false;

    const lines = text
        .split(/\r?\n/)
        .map((l) => l.replace(/\t/g, ' ').trim())
        .filter(Boolean);

    for (const line of lines) {
        const label = MATCH_LABEL.exec(line);
        if (!label) continue;

        const phase = PHASES[label[1].toLowerCase()];
        if (!phase) continue;

        sawAnything = true;
        const matchNumber = Number(label[2]);
        const warnings: string[] = [];

        // Strip the label, then the time, before looking for numbers.
        let rest = line.slice(label[0].length);
        const timeHit = TIME_FRAGMENT.exec(rest) ?? BARE_TIME.exec(rest);
        const scheduledText = timeHit ? timeHit[0].trim() : '';
        if (timeHit) rest = rest.replace(timeHit[0], ' ');

        const found: { number: string; index: number; end: number }[] = [];
        TEAM_NUMBER.lastIndex = 0;
        let hit: RegExpExecArray | null;
        while ((hit = TEAM_NUMBER.exec(rest)) !== null) {
            found.push({ number: hit[1], index: hit.index, end: hit.index + hit[0].length });
        }

        const wanted = allianceSize * 2;
        if (found.length < wanted) {
            skipped.push({
                line,
                reason: `Found ${found.length} team number${found.length === 1 ? '' : 's'}, expected ${wanted}`,
            });
            continue;
        }
        if (found.length > wanted) {
            /*
             * Almost always the scores. Said out loud rather than swallowed, because the other
             * cause is a team name containing a number — and a coach reading "we ignored 108
             * and 11" can tell in one glance which it was.
             */
            warnings.push(
                `Ignored ${found.length - wanted} number(s) after the teams (${found
                    .slice(wanted)
                    .map((f) => f.number)
                    .join(', ')}) — usually the scores.`,
            );
        }

        const taken = found.slice(0, wanted);
        const participants: ParsedParticipant[] = taken.map((entry, i) => {
            /*
             * BOUNDED BY THE NEXT NUMBER ON THE LINE, not by the next TAKEN one.
             *
             * The last team's name ran to end-of-line, so on a played match it came out as
             * "Nano Ninjas 108 11" -- the scores appended to a team's name, which is then what
             * the preview shows and what the coach confirms. Caught by the very first test in
             * `schedule-parse.test.ts`, which is the argument for asserting the whole
             * participant list rather than just the numbers.
             */
            const next = found[i + 1];
            const nameRaw = rest.slice(entry.end, next ? next.index : rest.length);
            const teamName = cleanName(nameRaw);
            if (!teamName) {
                warnings.push(`No name found for team ${entry.number}.`);
            }
            /*
             * FIRST marks a surrogate with an asterisk beside the number. Read from the raw
             * slice rather than the cleaned name, because cleaning removes it — and a surrogate
             * silently imported as an ordinary participant is a match that counts for a team it
             * should not, which is exactly what D2 says makes an uncorrectable import "wrong by
             * lunchtime".
             */
            const isSurrogate = /^\s*\*/.test(nameRaw) || /\*\s*$/.test(rest.slice(0, entry.end));
            if (isSurrogate) {
                warnings.push(`Team ${entry.number} looks like a surrogate — check the page.`);
            }
            return {
                alliance: i < allianceSize ? ('red' as const) : ('blue' as const),
                station: (i % allianceSize) + 1,
                teamNumber: entry.number,
                teamName,
                isSurrogate,
            };
        });

        const numbers = participants.map((p) => p.teamNumber);
        if (new Set(numbers).size !== numbers.length) {
            warnings.push('The same team appears twice in this match — check the page.');
        }
        if (!scheduledText) {
            warnings.push('No time found on this line.');
        }

        matches.push({ matchNumber, phase, scheduledText, participants, warnings });
    }

    return { matches, skipped, unrecognised: !sawAnything };
}

/**
 * Tidy a team name out of the text between two numbers.
 *
 * Bounded at 60 characters, because this ends up in a column on a phone and the parser's own
 * failure mode is grabbing far too much — if the number-splitting goes wrong, the "name" is
 * half the row. A truncated name a coach can fix beats a row that breaks the layout.
 */
function cleanName(raw: string): string {
    return raw
        .replace(/[*]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s\-–—|,]+|[\s\-–—|,]+$/g, '')
        .slice(0, 60)
        .trim();
}

/**
 * Everything the coach should look at before confirming.
 *
 * Deliberately counts rather than describes: the preview lists the matches themselves, and this
 * is the one line above the Import button. `docs/failure-modes.md` §4 — the zero case is a
 * different sentence, not a "0" in this one.
 */
export function summarise(result: ParseResult, ourTeamNumber?: string): {
    matchCount: number;
    warningCount: number;
    skippedCount: number;
    ourMatchCount: number;
} {
    const ours = (ourTeamNumber ?? '').trim();
    return {
        matchCount: result.matches.length,
        warningCount: result.matches.reduce((n, m) => n + m.warnings.length, 0),
        skippedCount: result.skipped.length,
        ourMatchCount: ours
            ? result.matches.filter((m) => m.participants.some((p) => p.teamNumber === ours)).length
            : 0,
    };
}
