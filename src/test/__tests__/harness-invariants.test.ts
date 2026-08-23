import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
        expect(total, `as any sites:\n${hits.join('\n')}`).toBeLessThanOrEqual(56);
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
