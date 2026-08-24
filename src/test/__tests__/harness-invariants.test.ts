import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

/**
 * Source-level invariants that no runtime test can express.
 *
 * These are ratchets, in the same spirit as the `as any` count: a number that may only go
 * down. They exist because eight sprints of history say the same few mistakes come back, and
 * because a rule that lives only in prose drifts — CLAUDE.md's Gate command, the `.agent/`
 * README's file count, and the capture script's "CI uploads it as an artifact" note were all
 * true when written and false by Sprint 8.
 *
 * The pattern here is not new: `mock-drift.test.ts`, `ios-zoom-floor.test.ts` and
 * `meetings.test.ts`'s migration read are the same idea. A check added here costs no new
 * dependency and no new CI step — it runs inside `npm run test:run`, so inside the Gate.
 *
 * See docs/failure-modes.md for the incident behind each one.
 */

const repoRoot = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
/** Written once so a failure message can join a list without an inline escape. */
const NL = String.fromCharCode(10);

/**
 * Every .ts/.tsx file under a directory, recursively — except this one.
 *
 * The exclusion is load-bearing, not tidiness: the comments below quote the very patterns
 * being counted (`as any`, `text-[10px]`, `describe.skip`), so without it every ratchet
 * measures its own documentation and the numbers mean nothing.
 */
const sourceFiles = (rel: string, exts = ['.ts', '.tsx']): string[] => {
    const abs = join(repoRoot, rel);
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (exts.some((e) => entry.name.endsWith(e)) && p !== __filename) out.push(p);
        }
    };
    walk(abs);
    return out;
};

const countMatches = (files: string[], re: RegExp): { total: number; hits: string[] } => {
    const hits: string[] = [];
    for (const f of files) {
        for (const m of readFileSync(f, 'utf8').matchAll(re)) {
            hits.push(`${f.slice(repoRoot.length + 1)}  ${m[0].trim().slice(0, 80)}`);
        }
    }
    return { total: hits.length, hits };
};

describe('type-escape and token ratchets', () => {
    /*
     * `as any`, counted ONE way.
     *
     * The plan has tracked this by hand since Sprint 1 and the method was never written down,
     * so three greps gave three answers (55 / 56 / 57) and the recorded figure had drifted
     * from all of them. Worse, Sprint 6 recorded a *false* increase: the privacy policy's
     * "as any operator of any service does" tripped a plain grep, so English prose was being
     * counted as a type escape.
     *
     * The rule below is `as any` NOT followed by a lowercase word — which keeps every real
     * cast (`as any)`, `as any;`, `as any,`, `as any.`) and drops the prose.
     */
    it('holds the `as any` count at or below its recorded ceiling', () => {
        const { total, hits } = countMatches(sourceFiles('src'), /\bas any\b(?!\s+[a-z])/g);
        expect(total, `as any sites:\n${hits.join('\n')}`).toBeLessThanOrEqual(55);
    });

    /*
     * Arbitrary Tailwind values, e.g. `text-[10px]`.
     *
     * Sprint 5 collapsed 49 of these to 1 by retuning the type scale, because 15 independent
     * `text-[10px]`/`[11px]` choices had been drifting apart. A Tailwind arbitrary value
     * always has a hyphen immediately before the bracket, which array indexing (`parts[0]`)
     * never does — that distinction is the whole regex.
     */
    it('holds arbitrary Tailwind values at or below their recorded ceiling', () => {
        const re = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]]+\]/g;
        const { total, hits } = countMatches(sourceFiles('src'), re);
        expect(total, `arbitrary values:\n${hits.join('\n')}`).toBeLessThanOrEqual(2);
    });

    /*
     * `dark:text-slate-500`, held at zero (WALK-A-09).
     *
     * WHY THIS ONE VALUE AND NOT A GENERAL CONTRAST RULE. Contrast depends on the ground, and
     * a grep cannot see the ground — which is why the real check is axe in a real browser
     * (`scripts/probe-accessibility.mjs`), and why jsdom will never catch this class
     * (`docs/failure-modes.md` §5: CSS with no error channel). But slate-500 is the one value
     * that needs no ground to judge: #64748b fails 4.5:1 against every dark surface this app
     * uses — 3.07:1 on slate-800, 2.52:1 on slate-700/60, 2.18:1 on slate-700, all measured.
     * There is no dark ground on which it is legible, so its count can be zero and stay zero.
     *
     * All five sites were written as `text-slate-400 dark:text-slate-500`, which reads as
     * careful — dimmer text on a dimmer ground — and inverts the requirement: a dark ground
     * needs LIGHTER muted text, not darker. That is the shape a grep can catch and a reviewer
     * repeatedly did not.
     */
    it('has no `dark:text-slate-500`, which fails 4.5:1 on every dark ground in the app', () => {
        const { total, hits } = countMatches(sourceFiles('src'), /dark:text-slate-500/g);
        expect(total, `illegible muted text:\n${hits.join('\n')}`).toBe(0);
    });
});

describe('the harness cannot quietly stop verifying', () => {
    /*
     * A swallowed ACTION, not a swallowed wait.
     *
     * `.catch(() => {})` on a `waitFor`/`waitForLoadState` is ordinary Playwright: the wait is
     * best-effort by design. On an *action* it is how a harness reports success while doing
     * nothing — Sprint 7's venue simulation located `input[type=checkbox]`, swallowed the
     * miss, and passed. The toggle is a <button>, so it had matched nothing for its whole
     * life, and only a screenshot of eight untouched circles gave it away.
     *
     * Two sites remain (venue-simulation.mjs and e2e/helpers.ts, both `box.check()`), which is
     * why this is a ceiling rather than a ban. They are recorded in the plan's parking lot.
     */
    it('does not add new swallowed Playwright actions', () => {
        const files = [...sourceFiles('e2e'), ...sourceFiles('scripts', ['.mjs'])];
        const re = /\.(?:check|click|fill|press|selectOption|setChecked|uncheck)\([^)]*\)\s*\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g;
        const { total, hits } = countMatches(files, re);
        expect(total, `swallowed actions:\n${hits.join('\n')}`).toBeLessThanOrEqual(2);
    });

    /*
     * Node's clock in an end-to-end spec.
     *
     * The form composes local wall-clock parts into an instant in Chromium; a spec that builds
     * the same values from Node's clock is correct only while the two processes happen to share
     * a timezone. Sprint 8 shipped a meetings spec that was green in US Central at 18:32 and red
     * on a UTC runner at 23:32, having built an event that ended twenty-one hours before it
     * began. The fix reads the time via `page.evaluate`.
     *
     * Three sites remain in meetings.spec.ts. They survive only because they sit far from a
     * day boundary, which is luck rather than design — see the parking lot.
     */
    it('does not add new uses of Node\'s clock in e2e specs', () => {
        const files = sourceFiles('e2e');
        const re = /(?<!\/\/[^\n]{0,200})(?:\bDate\.now\(\)|\bnew Date\((?!\s*[a-zA-Z_$]))/g;
        const { total, hits } = countMatches(files, re);
        expect(total, `Node clock in e2e:\n${hits.join('\n')}`).toBeLessThanOrEqual(3);
    });

    /*
     * Skipped tests.
     *
     * CLAUDE.md forbids adding `describe.skip`. One predates the rule (MatchPlanner's drawing
     * actions, recorded in the plan as "+2 skips"). The ceiling keeps it from becoming two.
     */
    it('does not add new skipped suites', () => {
        const files = [...sourceFiles('src'), ...sourceFiles('e2e')];
        const { total, hits } = countMatches(files, /\b(?:describe|it|test)\.skip\b/g);
        expect(total, `skips:\n${hits.join('\n')}`).toBeLessThanOrEqual(1);
    });
});

describe('every test asserts something', () => {
    /*
     * OPS-02 — seven tests with no assertion at all, and ~25 more with their assertion behind
     * an `if`.
     *
     * `it('opens task details when clicking a task', () => { const el = screen.queryByText(...);
     * if (el) { fireEvent.click(el); } })` passes whether or not the element exists, whether or
     * not the click does anything, and whether or not the component still exists. Four of them
     * were in the board's own suite — the screen a team uses at a competition.
     *
     * This is `docs/failure-modes.md` §2, the class that document calls the most dangerous
     * because it manufactures confidence and hides every other class. The unit count is a
     * number this project quotes in its own progress log, so a test that cannot fail inflates
     * the one figure everybody reads.
     *
     * PARSING, NOT AST. A regex over `it(`/`test(` bodies, in the style of the ratchets above:
     * no new dependency and no new CI step. The trade is that it counts braces rather than
     * understanding them, and that a helper called INSTEAD of `expect` has to be named here —
     * `denied()` in the season-lifecycle db tests is the one that exists. Both stated rather
     * than hidden.
     */
    const ASSERTING = /\b(expect|assert|denied|expectDenied|expectRefused)\s*\(|\.rejects\b|\.resolves\b|toThrow/;

    /** Every `it(...)` / `test(...)` body in a file, by brace-matching from the callback. */
    const testBodies = (source: string): { title: string; body: string }[] => {
        const out: { title: string; body: string }[] = [];
        const opener = /\b(?:it|test)(?:\.\w+)?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,/g;
        for (const match of source.matchAll(opener)) {
            const from = source.indexOf('{', (match.index ?? 0) + match[0].length);
            if (from === -1) continue;
            let depth = 0;
            let to = from;
            for (; to < source.length; to++) {
                if (source[to] === '{') depth++;
                else if (source[to] === '}' && --depth === 0) break;
            }
            out.push({ title: match[2], body: source.slice(from, to) });
        }
        return out;
    };

    const testFiles = () => sourceFiles('src').filter((f) => /\.(test|spec)\.tsx?$/.test(f));

    it('has no test body without an assertion', () => {
        const offenders: string[] = [];
        for (const file of testFiles()) {
            for (const { title, body } of testBodies(readFileSync(file, 'utf8'))) {
                if (!ASSERTING.test(body)) {
                    offenders.push(`${file.slice(repoRoot.length + 1)}  ${title}`);
                }
            }
        }

        const message =
            'tests that assert nothing (OPS-02) - they pass whether the feature works or not:'
            + NL + offenders.join(NL);
        expect(offenders, message).toEqual([]);
    });

    /*
     * The extractor has to actually find tests, or the check above is a very confident `[]`.
     *
     * This is the same trap the thing being measured fell into: a scan that matches nothing
     * reports perfect health. `harness-invariants.test.ts` is excluded from `sourceFiles`, so
     * the number below is every OTHER suite in the repo.
     */
    it('actually finds the tests it is checking', () => {
        const counted = testFiles().reduce(
            (n, f) => n + testBodies(readFileSync(f, 'utf8')).length,
            0,
        );
        expect(counted, 'the test-body extractor matched almost nothing').toBeGreaterThan(500);
    });

    /*
     * The softer half of the same finding: `if (element) { fireEvent.click(element) }`.
     *
     * These have an assertion somewhere, so the check above passes them — but the ACTION is
     * conditional, so when the element stops existing the test quietly stops testing and stays
     * green. Sprint 7's venue simulation is the cautionary version: it located
     * `input[type=checkbox]`, matched nothing for its whole life, and reported success.
     */
    it('does not put an action behind an `if (element)` guard', () => {
        const re = /if\s*\(\s*\w+\s*\)\s*\{[^}]*\bfireEvent\b/g;
        const { total, hits } = countMatches(testFiles(), re);
        /*
         * TWO, not zero, and both are inside `describe.skip('Drawing actions')` in
         * `MatchPlanner.test.tsx` — the repo's one recorded skip. Editing assertions inside a
         * block nothing runs would be a change nobody could verify, which is the opposite of
         * OPS-02's point. Un-skipping that block is what takes this to zero.
         */
        expect(total, `conditional actions:${NL}${hits.join(NL)}`).toBeLessThanOrEqual(2);
    });
});

describe('the landing page describes the product that exists', () => {
    /*
     * LAND-03 — eight phrases on the marketing page for features that do not exist.
     *
     * "analyze scouting data", "Detailed match analysis", "Data-driven alliance selection",
     * "powerful metrics for your picklist", "Team progression charts", "tag key starting
     * positions", "assign tasks to alliance partners", "Analyze aggregate scouting data".
     * None of them shipped. The assessment's note is the one that matters: this is the claim
     * most likely to generate "where is…" support mail, at the first event, from the coach
     * who trusted it.
     *
     * A source-level ratchet rather than a rendering test, in the spirit of the ones below: the
     * failure mode is somebody writing enthusiastic copy months from now, and the thing that
     * catches that is a list of the exact words, not a DOM query.
     */
    it('does not make the claims LAND-03 found', () => {
        const overclaims = [
            'analyze scouting data',
            'Analyze aggregate scouting data',
            'Detailed match analysis',
            'Data-driven alliance selection',
            'powerful metrics',
            'Team progression charts',
            'tag key starting positions',
            'assign tasks to alliance partners',
        ];
        const landing = read('src/pages/Landing.tsx');
        const found = overclaims.filter((phrase) =>
            landing.toLowerCase().includes(phrase.toLowerCase()),
        );

        expect(
            found,
            'Landing.tsx claims features that do not exist: ' + found.join(', ') +
            '. If one of these has since been BUILT, delete it from this list in the same commit.',
        ).toEqual([]);
    });

    /*
     * LAND-01 — the page had zero `<a>` elements, measured.
     *
     * Terms, Privacy, Acceptable use and the support address were unreachable from the one page
     * a district privacy officer or a careful parent looks at, on a product holding minors'
     * data. Counted in the source because the alternative is rendering a 1,000-line marketing
     * page in jsdom to count anchors, and the thing that would break this is somebody replacing
     * a link with a `navigate()` button — which is exactly what the source shows.
     */
    it('links to the legal documents and the support address', () => {
        const landing = read('src/pages/Landing.tsx');
        for (const href of ['#/legal/terms', '#/legal/privacy', '#/legal/community', 'mailto:']) {
            expect(landing, `the landing page does not link to ${href}`).toContain(href);
        }
        const anchors = landing.match(/<a[\s>]/g) ?? [];
        expect(anchors.length, 'the landing page is back below five links').toBeGreaterThanOrEqual(5);
    });

    /*
     * LAND-02 — the body copy never said "FTC" or "FIRST Tech Challenge".
     *
     * Only the `<meta description>` did, so the page read as generic robotics to both a human
     * and a search engine, while the buyer is typing "FTC team management".
     */
    it('names the program it is for', () => {
        const landing = read('src/pages/Landing.tsx');
        expect(landing).toMatch(/FTC|Tech Challenge/);
    });

    /*
     * LAND-01 — the trademark disclaimer.
     *
     * FIRST asks third-party tools to say it, and a coach's first question about an unfamiliar
     * tool is whether it is official. Its absence is not neutral.
     */
    it('says it is not affiliated with FIRST', () => {
        expect(read('src/pages/Landing.tsx')).toMatch(/not affiliated with/i);
    });
});

describe('the game is data, not code (P-01 phase S)', () => {
    /*
     * WHY THIS RATCHET EXISTS. FTC replaces the game every September, and until Sprint 18 the
     * game was spelled out in TypeScript: `intakeType: 'No Intake' | 'Human Player' |
     * 'Automatic'` in `types.ts`, `FIELD_IMAGE_URL = "DecodeField.png"` in `constants.ts`,
     * "Lifted Park" as a checkbox label in `MatchPlanner.tsx`, and ten enumerated keys in the
     * entity registry. Supporting the next game meant editing a type, a constant, two
     * components and the sync layer — in September, three weeks before kickoff.
     *
     * The coupling is gone. This is what stops it coming back one convenient literal at a
     * time, which is exactly how it accumulated: nobody adds a game-specific type on purpose.
     *
     * P-01's exit criterion names these four files, so these four files are what is checked.
     * `src/games/*.json` is where every one of these strings now lives, and this test does not
     * look there.
     */
    const GAME_LITERALS = [
        'FIELD_IMAGE_URL',
        'DecodeField',
        'DECODE',
        'BIOBUZZ',
        'intakeType',
        'Lifted Park',
        'No Intake',
        'Human Player',
        'Full Park',
        'Partial Park',
        'hasAutonomous',
        'shotsTaken',
        'shotsMissed',
        'farShooting',
        'autoAim',
    ];

    const FILES = [
        'src/components/ScoutingReports.tsx',
        'src/components/MatchPlanner.tsx',
        'src/constants.ts',
        'src/types.ts',
    ];

    for (const file of FILES) {
        it(`${file} names no game`, () => {
            const source = read(file);
            /*
             * COMMENTS ARE STRIPPED FIRST, and that is not a loophole.
             *
             * Every one of these files explains what used to be there and why it is gone — the
             * `FIELD_IMAGE_URL` note in `constants.ts` is a whole paragraph naming the constant
             * it replaced. A ratchet that failed on the explanation would force the explanation
             * out, and this repo's own guidance is that the reasoning is the valuable part.
             * What matters is that no CODE branches on a game.
             */
            const code = source
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '')
                .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

            const found = GAME_LITERALS.filter((literal) => code.includes(literal));
            expect(
                found,
                `${file} still names ${found.join(', ')} in code. A game belongs in ` +
                    'src/games/<id>.json, which is the whole point of P-01 phase S.',
            ).toEqual([]);
        });
    }

    /*
     * The registry is the fifth place the coupling lived, and the one that would be silent:
     * an enumerated `toRemote` drops an unknown key rather than failing, so a report carrying
     * a field a team added under D4(b) would lose it on the next round trip through an older
     * build — and the row would still save.
     */
    it('the entity registry does not enumerate scouting fields', () => {
        const code = read('src/lib/entity-registry.ts')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        for (const key of ['hasAutonomous', 'shotsTaken', 'intakeType', 'endGameNotes']) {
            expect(
                code.includes(key),
                `entity-registry.ts still enumerates ${key}; the data bag must pass through opaque.`,
            ).toBe(false);
        }
    });

    /*
     * And the bundled files are valid. `import x from './x.json'` is typed by the literal
     * contents, never checked against `GameDefinition`, so a typo'd key compiles and ships and
     * fails at render time — on the scouting screen, which is used at a venue. `games.ts`
     * throws at module load; importing it here is what makes that a Gate failure.
     */
    it('every bundled game definition loads', async () => {
        const { BUNDLED_GAMES } = await import('../../lib/games');
        expect(BUNDLED_GAMES.length).toBeGreaterThan(0);
        for (const game of BUNDLED_GAMES) {
            expect(game.id, 'a bundled game has no id').toBeTruthy();
            expect(game.scouting.match.sections.length).toBeGreaterThan(0);
        }
    });
});

describe('the guidance describes the repo that exists', () => {
    /*
     * Every `npm run <script>` named in the agent-facing docs must exist.
     *
     * This is the cheapest possible answer to the most repeated meta-defect in the history.
     * CLAUDE.md told eight sprints of agents to run `npm run test:rls` "(once it exists)" long
     * after it existed, and described `npm run lint` as linting when it was `tsc --noEmit` and
     * no ESLint was installed. Both were true the day they were written.
     */
    it('names only npm scripts that exist', () => {
        const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        // README included: it is the file a fresh clone follows first, and OPS-11 found six
        // false claims in it — three of which a new contributor hits in the first ten minutes.
        const docs = ['CLAUDE.md', 'docs/failure-modes.md', 'README.md'];
        const missing: string[] = [];

        for (const doc of docs) {
            for (const m of read(doc).matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) {
                if (!(m[1] in pkg.scripts)) missing.push(`${doc}: npm run ${m[1]}`);
            }
        }

        expect(missing, `documented scripts that do not exist:\n${missing.join('\n')}`).toEqual([]);
    });

    /*
     * The Gate is defined in exactly one place.
     *
     * There used to be three: CLAUDE.md's prose, `test:all` in package.json (which swapped
     * `build` for `test:db`), and ci.yml's job (which called `npx tsc --noEmit` directly, so
     * renaming the lint script would not have broken it). Three definitions of done means the
     * one an agent reads is not the one that runs.
     */
    it('keeps the Gate as one script that CLAUDE.md points at', () => {
        const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        expect(pkg.scripts.gate).toBe(
            'npm run lint && npm run test:run && npm run test:integration && npm run build'
        );
        expect(read('CLAUDE.md')).toContain('npm run gate');
    });

    /*
     * ...and the deploy runs THAT, not a fourth copy of it (OPS-10).
     *
     * `deploy.yml` used to spell the Gate out as four steps and call `tsc --noEmit` directly.
     * It had already drifted: Sprint 9 added ESLint to `lint`, and the change never reached
     * the workflow that ships to production, so every deploy since ran a Gate missing its
     * linter. That is the same defect as the three definitions above, on the one path where
     * nobody would notice.
     */
    it('runs the Gate in the deploy, rather than restating it', () => {
        /*
         * Comments stripped FIRST, and both assertions read the stripped text.
         *
         * The step this replaced is described at length in that file, `tsc --noEmit` and all —
         * and the comment explaining the fix says "npm run gate" too. A check that reads prose
         * as if it were a command passes on the strength of its own documentation, which is
         * this repo's most-repeated test defect wearing yet another hat.
         */
        const commands = read('.github/workflows/deploy.yml')
            .split(NL)
            .filter((line) => !line.trim().startsWith('#'))
            .join(NL);
        expect(commands, 'deploy.yml no longer runs `npm run gate`').toContain('npm run gate');
        expect(
            commands.includes('tsc --noEmit'),
            'deploy.yml calls tsc directly again - that is the drift OPS-10 removed',
        ).toBe(false);
    });

    /*
     * `npm run lint` actually lints.
     *
     * It was `tsc --noEmit` with no ESLint in the repo for eight sprints, while every rule
     * document called it the lint step. The first ESLint run found a live invalid hook call
     * (B26) on the join-team profile path.
     */
    it('runs eslint as part of the lint script', () => {
        const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        expect(pkg.scripts.lint).toContain('eslint');
        expect(pkg.scripts.lint).toContain('tsc --noEmit');
    });
});
/**
 * The precache is the app's first venue load, and it was 60% one image copied four times.
 *
 * OPS-08 / SYNC-12: `logo.png`, `falcon_logo.png`, `icon-192.png` and `icon-512.png` were the
 * SAME 1024x1024 802,825-byte PNG under four names — 3.2 MB of a 5.2 MB precache, downloaded in
 * full by every device on every cold install, which on a 2 Mbps gym connection is the difference
 * between roughly 20 seconds and 8 before the app is offline-capable. Nothing in the build
 * reported it, because four identical files are four perfectly valid files.
 *
 * These two checks are the countermeasure, and both had to be *derived* rather than asserted as
 * a number, per `docs/failure-modes.md` §12: a byte-count ceiling would be a hand-maintained
 * figure that goes stale, where "no two files are the same file" and "the manifest tells the
 * truth about its icons" stay true whatever the assets become.
 */
describe('the precached assets (OPS-08 / SYNC-12)', () => {
    const PUBLIC_DIR = 'public';

    /** Every file directly under `public/`. It is flat today and there is no reason it would not be. */
    const publicFiles = () =>
        readdirSync(join(repoRoot, PUBLIC_DIR), { withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => e.name);

    it('has no two files in public/ with identical bytes', () => {
        const byHash = new Map<string, string[]>();
        for (const name of publicFiles()) {
            const hash = createHash('md5')
                .update(readFileSync(join(repoRoot, PUBLIC_DIR, name)))
                .digest('hex');
            byHash.set(hash, [...(byHash.get(hash) ?? []), name]);
        }
        const dupes = [...byHash.values()].filter((names) => names.length > 1);
        expect(
            dupes,
            `public/ holds the same bytes under more than one name, and every copy is precached:${NL}` +
                dupes.map((names) => `  ${names.join(' == ')}`).join(NL),
        ).toEqual([]);
    });

    /**
     * The PWA manifest's declared icon sizes are the icons' real sizes.
     *
     * `icon-192.png` was declared `192x192` and was 1024x1024 for the whole life of the project.
     * An installer takes the declaration at its word, so nothing anywhere reported it — the
     * install worked, the icon looked right, and the device downloaded 800 KB for a 192-pixel
     * square. This reads the IHDR header of the actual file, which is the only thing a lie about
     * a size cannot survive.
     */
    it('declares each PWA icon at the size the file actually is', () => {
        const config = read('vite.config.ts');
        const icons = [
            ...config.matchAll(/src:\s*'([^']+)',\s*[\s\S]{0,40}?sizes:\s*'(\d+)x(\d+)'/g),
        ].map((m) => ({ src: m[1], w: Number(m[2]), h: Number(m[3]) }));

        expect(icons.length, 'no manifest icons found — did the PWA config move?').toBeGreaterThan(
            0,
        );

        for (const icon of icons) {
            const bytes = readFileSync(join(repoRoot, PUBLIC_DIR, icon.src));
            // PNG: 8-byte signature, then the IHDR chunk — 4 length, 4 type, then width and
            // height as big-endian uint32s at byte 16 and 20.
            expect(bytes.subarray(12, 16).toString('ascii'), `${icon.src} is not a PNG`).toBe(
                'IHDR',
            );
            const width = bytes.readUInt32BE(16);
            const height = bytes.readUInt32BE(20);
            expect(
                [width, height],
                `${icon.src} is declared ${icon.w}x${icon.h} and is ${width}x${height}`,
            ).toEqual([icon.w, icon.h]);
        }
    });

    /**
     * Every asset the app asks for by name is in `public/`.
     *
     * The hero was `hero_bg.png` in `Landing.tsx` and the file it named is now a `.webp`; the
     * apple-touch-icon in `index.html` pointed at `logo.png`, which this sprint deleted as the
     * fourth copy of the logo. Both are string references no compiler checks, and a broken one
     * is a 404 that only shows up as a missing image on a page nobody screenshots.
     */
    it('resolves every public asset the source names', () => {
        const present = new Set(publicFiles());
        const referenced = new Set<string>();

        /*
         * The two forms that actually resolve to `public/` at runtime, and only those. A plain
         * search for anything ending in `.png` also finds every filename mentioned in a comment
         * and every screenshot named in this repo's own documentation — nine of them — which
         * would make this check fail on prose. Narrow beats noisy: a check that cries wolf gets
         * deleted, and `docs/failure-modes.md` §3 is full of checks that quietly stopped
         * verifying instead.
         */
        for (const file of sourceFiles('src')) {
            const text = readFileSync(file, 'utf8');
            // `${import.meta.env.BASE_URL}falcon_logo.png` — how src/ names a public asset.
            for (const m of text.matchAll(/BASE_URL\}([\w-]+\.(?:png|webp|svg|ico|jpg))/g)) {
                referenced.add(m[1]);
            }
        }
        // `<link rel="apple-touch-icon" href="/icon-192.png">` — how index.html names one.
        const html = read('index.html');
        for (const m of html.matchAll(/(?:href|src)="\/([\w-]+\.(?:png|webp|svg|ico|jpg))"/g)) {
            referenced.add(m[1]);
        }

        expect(
            referenced.size,
            'no public assets found in src/ or index.html — did the reference form change?',
        ).toBeGreaterThan(1);
        const missing = [...referenced].filter((name) => !present.has(name));
        expect(missing, `named in source and absent from public/: ${missing.join(', ')}`).toEqual(
            [],
        );
    });
});
/**
 * The Supabase CLI version is pinned in three places and they have to be the same one.
 *
 * OPS-15, and `docs/environment-divergences.md` §6 is the incident: local and CI have disagreed
 * about the CLI version twice. Once the newer CLI stopped auto-granting default privileges in
 * `public`, so the schema CI built was not the schema a developer built. Once a harness read the
 * stack's status with a different binary than the one that started it. A third time a note in
 * this repo CLAIMED the pin existed when it did not, and the unpinned resolution went through
 * the rate-limited GitHub API and took CI red on a docs-only commit.
 *
 * Three `version:` lines under `supabase/setup-cli` across two workflows, plus the
 * devDependency. A caret on the devDependency is the same defect in slow motion: `npm ci` honours
 * the lockfile, `npm install` on a fresh clone does not, so the machine that ran `npm install`
 * gets whatever is newest and CI keeps the pin.
 *
 * WHAT WOULD MAKE THIS FAIL: bumping any one of the four without the others.
 */
describe('the Supabase CLI is one version (OPS-15)', () => {
    it('pins the devDependency exactly and matches every workflow', () => {
        const pkg = JSON.parse(read('package.json')) as {
            devDependencies: Record<string, string>;
        };
        const pinned = pkg.devDependencies.supabase;

        expect(pinned, 'the supabase devDependency is gone').toBeTruthy();
        expect(
            /^\d+\.\d+\.\d+$/.test(pinned),
            `supabase is "${pinned}" — a range floats on \`npm install\` while CI stays pinned`,
        ).toBe(true);

        const workflows = readdirSync(join(repoRoot, '.github/workflows'))
            .filter((f) => f.endsWith('.yml'))
            .map((f) => [f, read(`.github/workflows/${f}`)] as const);

        const found: string[] = [];
        for (const [name, text] of workflows) {
            const lines = text.split(NL);
            lines.forEach((line, i) => {
                if (!line.includes('supabase/setup-cli')) return;
                /*
                 * Scan forward to the next STEP, not a fixed number of lines.
                 *
                 * The first version of this looked five lines ahead and reported MISSING for
                 * both `ci.yml` steps, whose `version:` sits under a nine-line comment
                 * explaining the pin. A check that reports a false failure is on its way to
                 * being deleted, which is how at least eight steps in this repo's history
                 * stopped verifying (`docs/failure-modes.md` §3).
                 */
                for (const next of lines.slice(i + 1)) {
                    if (/^\s*- /.test(next)) break;
                    const m = /^\s*version:\s*['"]?([\d.]+)['"]?\s*$/.exec(next);
                    if (m) {
                        found.push(`${name}:${m[1]}`);
                        return;
                    }
                }
                found.push(`${name}:MISSING`);
            });
        }

        expect(found.length, 'no supabase/setup-cli steps found — did the workflows move?')
            .toBeGreaterThan(0);
        expect(
            found.filter((f) => !f.endsWith(`:${pinned}`)),
            `these setup-cli steps do not pin ${pinned}: ${found.join(', ')}`,
        ).toEqual([]);
    });
});
