/**
 * A READ-ONLY check that the live site is actually alive, run after a deploy.
 *
 * Kevin's call at Sprint 7 kickoff: the smoke pack proper stays a pre-merge gate against the
 * local stack, and production gets a check that WRITES NOTHING. The cost of the alternative is
 * real — a write-path smoke test against production needs a dedicated account and team, and a
 * flow that creates a season or a task leaves rows behind in the database beta teams will share.
 *
 * What it is for: telling a solo maintainer, within about two minutes of a deploy, that the
 * thing everyone loads is still loading. Nothing here is a substitute for the smoke pack; it
 * catches the deploy-shaped failures the smoke pack cannot see because the smoke pack never
 * touches production — a bundle that 404s, a custom domain that has come unbound, an anon key
 * that has been rotated out from under the site, a database that is refusing everything.
 *
 * EVERY REQUEST BELOW IS A GET OR A HEAD. That is the whole contract. If a future edit needs a
 * POST to prove something, it belongs in the smoke pack against the local stack instead.
 */

const SITE = process.env.PRODUCTION_URL ?? 'https://falcon-forge.com';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const results = [];
let failed = false;

async function check(name, fn) {
    try {
        const detail = await fn();
        results.push({ ok: true, name, detail });
    } catch (err) {
        failed = true;
        results.push({ ok: false, name, detail: err.message });
    }
}

/** Fetch with a bounded wait: a hung request must fail the check, not hang the workflow. */
async function get(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

await check('site responds', async () => {
    const res = await get(SITE);
    if (!res.ok) throw new Error(`GET ${SITE} returned ${res.status}`);
    return `${res.status} ${res.headers.get('content-type') ?? ''}`.trim();
});

await check('index.html references a bundle that exists', async () => {
    /*
     * The specific failure this catches: gh-pages published an index.html whose hashed asset
     * names do not match what actually landed. The page loads, and every user gets a blank
     * screen with a 404 in the console -- which looks like "the app is broken", not "the deploy
     * is broken", and is exactly the thing a solo maintainer wants told to them in two minutes.
     */
    const html = await (await get(SITE)).text();
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    if (scripts.length === 0) throw new Error('no <script src> in index.html');

    for (const src of scripts) {
        const url = new URL(src, SITE).toString();
        const res = await get(url, { method: 'HEAD' });
        if (!res.ok) throw new Error(`asset ${url} returned ${res.status}`);
    }
    return `${scripts.length} script asset(s) served`;
});

await check('custom domain is still bound', async () => {
    // public/CNAME is copied into dist, and deploy.yml refuses to publish without it. This is
    // the other end of that check: the domain answering, rather than the file existing.
    const host = new URL(SITE).host;
    const res = await get(SITE);
    const finalHost = new URL(res.url).host;
    if (finalHost !== host) throw new Error(`${host} redirected to ${finalHost}`);
    return host;
});

await check('service worker is published', async () => {
    // Offline-first is the product. A missing sw.js means no precache, which means the venue
    // case silently stops working while everything looks fine on a good connection.
    const res = await get(new URL('/sw.js', SITE).toString(), { method: 'HEAD' });
    if (!res.ok) throw new Error(`GET /sw.js returned ${res.status}`);
    return 'sw.js served';
});

await check('no sourcemaps published', async () => {
    // deploy.yml refuses to publish .map files; this confirms the site as served agrees.
    const html = await (await get(SITE)).text();
    const first = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])[0];
    if (!first) return 'no scripts to check';
    const res = await get(new URL(`${first}.map`, SITE).toString(), { method: 'HEAD' });
    if (res.ok) throw new Error(`${first}.map is downloadable — the app source is public`);
    return `${res.status} for ${first}.map`;
});

if (SUPABASE_URL && ANON_KEY) {
    await check('auth endpoint answers', async () => {
        // GET /auth/v1/settings is anonymous and read-only. A 401 here means the anon key the
        // site was built with is no longer valid, which no amount of frontend checking reveals.
        const res = await get(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: ANON_KEY } });
        if (!res.ok) throw new Error(`auth settings returned ${res.status}`);
        return `${res.status}`;
    });

    await check('team_entitlement answers anon with an empty set', async () => {
        /*
         * Sprint 3 verified that every table and this view answer anon with `200 []`, and that
         * property is load-bearing: it is what makes a signed-out visitor see an empty app
         * rather than an error page. A 500 here means RLS or a policy predicate is broken for
         * anonymous callers -- which is precisely the risk Sprint 7's REVOKE migration had to
         * be careful of, so it is worth re-asking of the real database after it lands.
         */
        const res = await get(`${SUPABASE_URL}/rest/v1/team_entitlement?select=team_id&limit=1`, {
            headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        });
        if (res.status !== 200) throw new Error(`team_entitlement returned ${res.status}`);
        const body = await res.json();
        if (!Array.isArray(body)) throw new Error('team_entitlement did not return an array');
        if (body.length !== 0) throw new Error(`anon read ${body.length} row(s) it should not see`);
        return '200 []';
    });
} else {
    results.push({
        ok: true,
        name: 'supabase checks',
        detail: 'skipped — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set',
    });
}

for (const { ok, name, detail } of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (failed) {
    console.error('\nProduction check FAILED. The deploy is live and something about it is wrong.');
    process.exit(1);
}
console.log('\nProduction check passed. Nothing was written.');
