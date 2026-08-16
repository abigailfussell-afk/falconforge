/**
 * Build the licensing states that no UI can reach, on the LOCAL stack only.
 *
 * The Sprint 6 hand-off is explicit that the happy path is not where a licensing screen fails,
 * and that several of the interesting states have to be constructed deliberately in the database
 * because no button produces them. This script produces them:
 *
 *   iron-falcons   an ordinary licensed team, 15 seats, some used — the "12 of 15" case
 *   full-house     every seat taken, with pending requests that cannot be approved
 *   lapsed         a grant that expired YESTERDAY, so the team is read-only
 *   expiring       a grant ending in 9 days, so the amber warning shows
 *   stranded       a team whose admin row has been deleted — the operator's rescue case
 *
 * Each team's admin signs in with the same password, so a reviewer can move between them.
 *
 * REFUSES TO RUN AGAINST ANYTHING BUT LOCALHOST. `.env.local` points at the HOSTED project and
 * Sprint 2 overwrote it once, unrecoverably; this script writes rows rather than files, but the
 * same instinct applies — a seeding script that could reach production is a mistake waiting for a
 * tired evening.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

if (!/(127\.0\.0\.1|localhost)/.test(URL)) {
    console.error(`Refusing to seed a non-local stack: ${URL}`);
    process.exit(1);
}

const PASSWORD = 'ForgeReview!2026-local';
const svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const day = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

async function must(label, promise) {
    const { data, error } = await promise;
    if (error) throw new Error(`${label}: ${error.message}`);
    return data;
}

async function makeUser(email, fullName, age = '18_plus') {
    // Delete first so the script is re-runnable.
    const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u) => u.email === email);
    if (existing) await svc.auth.admin.deleteUser(existing.id);

    const { data, error } = await svc.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName, age_classification: age },
    });
    if (error) throw new Error(`createUser(${email}): ${error.message}`);
    return data.user;
}

async function attest(userId, type) {
    await svc
        .from('user_attestations')
        .upsert({ user_id: userId, attestation_type: type, version: '2.0' }, {
            onConflict: 'user_id,attestation_type,version',
            ignoreDuplicates: true,
        });
}

/**
 * A team with an admin, a season, and however many extra members are asked for.
 * `grant` describes the licence: { seats, validFrom, validUntil } or null for no licence at all.
 */
async function makeTeam({ slug, name, adminEmail, grant, approved = 0, pending = 0, expireTo = null }) {
    const { data: old } = await svc.from('teams').select('id').eq('name', name);
    for (const t of old ?? []) await svc.from('teams').delete().eq('id', t.id);

    const admin = await makeUser(adminEmail, `${name} Admin`);
    // The admin role requires an attestation, and Sprint 6 raised the version to 2.0.
    await attest(admin.id, 'coach_terms');

    const team = await must(
        'team',
        svc.from('teams').insert({ name, team_number: '9000', owner_id: admin.id }).select().single(),
    );

    if (grant) {
        await must(
            'grant',
            svc.from('license_grants').insert({
                team_id: team.id,
                source: 'gift',
                seats: grant.seats,
                valid_from: grant.validFrom ?? iso(Date.now() - 30 * day),
                valid_until: grant.validUntil ?? null,
                created_by: admin.id,
                notes: `${slug} review licence`,
            }),
        );
    }

    // The admin holds a seat, like everybody approved.
    await must(
        'admin member',
        svc.from('team_members').insert({
            team_id: team.id,
            user_id: admin.id,
            role: 'admin',
            status: 'approved',
            seat_assigned: true,
            full_name: `${name} Admin`,
            email: adminEmail,
        }),
    );

    await must(
        'season',
        svc.from('seasons').insert({ team_id: team.id, name: '2026-2027 Season', game_title: 'DECODE' }),
    );

    for (let i = 0; i < approved; i++) {
        const user = await makeUser(`${slug}-student${i}@falconforge.test`, `Student ${i + 1}`, '13_to_17');
        await must(
            'approved member',
            svc.from('team_members').insert({
                team_id: team.id,
                user_id: user.id,
                role: 'student',
                status: 'approved',
                seat_assigned: true,
                full_name: `Student ${i + 1}`,
                email: user.email,
            }),
        );
    }

    for (let i = 0; i < pending; i++) {
        const user = await makeUser(`${slug}-hopeful${i}@falconforge.test`, `Hopeful ${i + 1}`, '13_to_17');
        await must(
            'pending member',
            svc.from('team_members').insert({
                team_id: team.id,
                user_id: user.id,
                role: 'student',
                status: 'pending',
                seat_assigned: false,
                full_name: `Hopeful ${i + 1}`,
                email: user.email,
            }),
        );
    }

    /*
     * Expire the grant only AFTER the members exist.
     *
     * `enforce_seat_capacity` counts in-force grants, so a team whose licence has already lapsed
     * has zero seats and CANNOT be given a seated member — not even by the service role, which is
     * exempt from the authority check but not from the arithmetic. The lapsed state therefore has
     * to be reached the way reality reaches it: license the team, fill the seats, then let cover
     * run out. Discovered by this script failing, which is the trigger being right.
     */
    if (expireTo) {
        await must(
            'expire grant',
            svc
                .from('license_grants')
                .update({ valid_from: iso(Date.now() - 200 * day), valid_until: expireTo })
                .eq('team_id', team.id),
        );
    }

    return { team, admin };
}

async function main() {
    // 1. The ordinary case the brief's sentence describes: "12 of 15 seats".
    const ordinary = await makeTeam({
        slug: 'iron',
        name: 'Iron Falcons',
        adminEmail: 'reviewer@falconforge.test',
        grant: { seats: 15 },
        approved: 11, // + the admin = 12
        pending: 2,
    });
    // A coach who could take the handover, and who has NOT accepted the admin terms — so the
    // nomination flow can be exercised through its refusal as well as its success.
    const successor = await makeUser('successor@falconforge.test', 'Mr Adeyemi');
    await must(
        'successor',
        svc.from('team_members').insert({
            team_id: ordinary.team.id,
            user_id: successor.id,
            role: 'coach',
            status: 'approved',
            seat_assigned: true,
            full_name: 'Mr Adeyemi',
            email: 'successor@falconforge.test',
        }),
    );

    // 2. Every seat taken, with people waiting who cannot be approved.
    await makeTeam({
        slug: 'full',
        name: 'Full House Robotics',
        adminEmail: 'full@falconforge.test',
        grant: { seats: 3 },
        approved: 2, // + admin = 3 of 3
        pending: 4,
    });

    // 3. The grant that expired YESTERDAY.
    await makeTeam({
        slug: 'lapsed',
        name: 'Lapsed Legends',
        adminEmail: 'lapsed@falconforge.test',
        grant: { seats: 10 },
        approved: 3,
        expireTo: iso(Date.now() - day),
    });

    // 4. Expiring inside the warning window.
    await makeTeam({
        slug: 'expiring',
        name: 'Nearly Out Engineering',
        adminEmail: 'expiring@falconforge.test',
        grant: { seats: 10, validUntil: iso(Date.now() + 9 * day) },
        approved: 4,
    });

    // 5. The stranded team: admin row deleted, so no warm path can produce an admin.
    const stranded = await makeTeam({
        slug: 'stranded',
        name: 'Stranded Robotics',
        adminEmail: 'stranded@falconforge.test',
        grant: { seats: 10 },
        approved: 2,
    });
    const { data: strandedCoach } = await svc
        .from('team_members')
        .select('id, user_id')
        .eq('team_id', stranded.team.id)
        .eq('role', 'student')
        .limit(1)
        .single();
    // Promote one student to coach and give them the terms, so they are a valid successor.
    await svc.from('team_members').update({ role: 'coach' }).eq('id', strandedCoach.id);
    await attest(strandedCoach.user_id, 'terms');
    await svc.from('team_members').delete().eq('team_id', stranded.team.id).eq('role', 'admin');

    // 6. The operator identity, so the operator console is reachable.
    await svc.from('platform_operators').delete().eq('user_id', ordinary.admin.id);
    await must(
        'operator',
        svc.from('platform_operators').insert({ user_id: ordinary.admin.id }),
    );

    const { data: entitlements } = await svc
        .from('team_entitlement')
        .select('team_id, status, seats_total, seats_used, valid_until');

    console.log('\nSeeded. Password for every account:', PASSWORD, '\n');
    console.table(
        (entitlements ?? []).map((e) => ({
            status: e.status,
            seats: `${e.seats_used} / ${e.seats_total ?? '∞'}`,
            until: e.valid_until ? e.valid_until.slice(0, 10) : 'open-ended',
            team: e.team_id.slice(0, 8),
        })),
    );
    console.log('\nAccounts:');
    console.log('  reviewer@falconforge.test  Iron Falcons (12/15) + PLATFORM OPERATOR');
    console.log('  full@falconforge.test      Full House Robotics (3/3, 4 waiting)');
    console.log('  lapsed@falconforge.test    Lapsed Legends (expired yesterday)');
    console.log('  expiring@falconforge.test  Nearly Out Engineering (9 days left)');
    console.log('  successor@falconforge.test Coach on Iron Falcons, has NOT accepted admin terms');
    console.log(`  stranded team id: ${stranded.team.id} (no admin; successor member ${strandedCoach.id})`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
