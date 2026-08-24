/**
 * A populated example team, so a beta coach sees the app in use rather than an empty shell.
 *
 * `seed-review-states.mjs` (Sprint 6) builds the AWKWARD states — a team at capacity, a lapsed
 * grant, a stranded team — because those are what licensing screens fail on. This is the
 * opposite and complementary job: one ordinary team with a season's worth of real-looking work,
 * for demonstrating, for screenshots that are not staged by hand, and for showing somebody what
 * they are being asked to sign up to.
 *
 * REFUSES TO RUN AGAINST ANYTHING BUT LOCALHOST, like the review seeder. `.env.local` points at
 * the hosted project, and a seeding script that could reach production is a mistake waiting for
 * a tired evening.
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

const PASSWORD = 'ForgeDemo!2026-local';
const EMAIL = 'demo@falconforge.test';
const svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const day = 86_400_000;
const uuid = () => crypto.randomUUID();

async function must(label, promise) {
    const { data, error } = await promise;
    if (error) throw new Error(`${label}: ${error.message}`);
    return data;
}

const STUDENTS = [
    ['Ava Restrepo', 'Build'],
    ['Marcus Oyelaran', 'Programming'],
    ['Priya Raghunathan', 'Build'],
    ['Sam Whitfield', 'Outreach'],
    ['Nadia Kowalczyk', 'Programming'],
    ['Theo Brennan', 'Media'],
];

const TASKS = [
    ['Rebuild the intake for the wider sample', 'Done', 'Build'],
    ['Tune the auto path off the left wall', 'Done', 'Programming'],
    ['Cut new polycarb side panels', 'In Progress', 'Build'],
    ['Odometry drift on long runs', 'In Progress', 'Programming'],
    ['Sponsor letter for the regional', 'In Progress', 'Outreach'],
    ['Spare battery charging rota', 'To Do', 'Build'],
    ['Driver practice schedule before the meet', 'To Do', 'Programming'],
    ['Pit banner artwork', 'To Do', 'Media'],
    ['Engineering notebook: week 6 entry', 'Backlog', 'Media'],
    ['Outreach visit to the middle school', 'Backlog', 'Outreach'],
];

async function main() {
    // Re-runnable: clear the previous demo team and account first.
    const { data: old } = await svc.from('teams').select('id').eq('name', 'Demo Robotics');
    for (const t of old ?? []) await svc.from('teams').delete().eq('id', t.id);
    const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of list?.users ?? []) {
        if (u.email === EMAIL || u.email?.endsWith('@demo.falconforge.test')) {
            await svc.auth.admin.deleteUser(u.id);
        }
    }

    const { data: adminUser, error: userErr } = await svc.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Coach Dana Whitlock', age_classification: '18_plus' },
    });
    if (userErr) throw new Error(`createUser: ${userErr.message}`);
    const admin = adminUser.user;

    await svc.from('user_attestations').upsert(
        { user_id: admin.id, attestation_type: 'coach_terms', version: '2.0' },
        { onConflict: 'user_id,attestation_type,version', ignoreDuplicates: true },
    );

    const team = await must(
        'team',
        svc.from('teams').insert({ name: 'Demo Robotics', team_number: '14822', owner_id: admin.id }).select().single(),
    );

    await must(
        'licence',
        svc.from('license_grants').insert({
            team_id: team.id,
            source: 'gift',
            seats: 15,
            valid_from: new Date(Date.now() - 30 * day).toISOString(),
            valid_until: new Date(Date.now() + 300 * day).toISOString(),
            created_by: admin.id,
            notes: 'demo team',
        }),
    );

    await must(
        'admin member',
        svc.from('team_members').insert({
            team_id: team.id,
            user_id: admin.id,
            role: 'admin',
            status: 'approved',
            seat_assigned: true,
            full_name: 'Coach Dana Whitlock',
            email: EMAIL,
        }),
    );

    const season = await must(
        'season',
        svc
            .from('seasons')
            .insert({ team_id: team.id, name: '2026-2027 Season', game_title: 'DECODE' })
            .select()
            .single(),
    );

    // Sub-teams first: tasks reference them by department.
    const subTeamIds = {};
    for (const name of ['Build', 'Programming', 'Outreach', 'Media']) {
        const st = await must(
            'sub team',
            svc
                .from('sub_teams')
                .insert({ id: uuid(), team_id: team.id, season_id: season.id, name, member_ids: [] })
                .select()
                .single(),
        );
        subTeamIds[name] = st.id;
    }

    const memberIds = {};
    for (const [index, [fullName, group]] of STUDENTS.entries()) {
        const email = `student${index}@demo.falconforge.test`;
        const { data: created, error } = await svc.auth.admin.createUser({
            email,
            password: PASSWORD,
            email_confirm: true,
            user_metadata: { full_name: fullName, age_classification: '13_to_17' },
        });
        if (error) throw new Error(`createUser(${email}): ${error.message}`);

        const member = await must(
            'member',
            svc
                .from('team_members')
                .insert({
                    team_id: team.id,
                    user_id: created.user.id,
                    role: 'student',
                    status: 'approved',
                    seat_assigned: true,
                    full_name: fullName,
                    email,
                })
                .select()
                .single(),
        );
        memberIds[fullName] = member.id;
        (subTeamIds[group] ? memberIds : {})[`${fullName}:group`] = group;
    }

    // Put each student on their sub-team.
    for (const group of Object.keys(subTeamIds)) {
        const ids = STUDENTS.filter(([, g]) => g === group).map(([name]) => memberIds[name]);
        await svc.from('sub_teams').update({ member_ids: ids }).eq('id', subTeamIds[group]);
    }

    for (const [index, [title, status, group]] of TASKS.entries()) {
        await must(
            'task',
            svc.from('tasks').insert({
                id: uuid(),
                team_id: team.id,
                season_id: season.id,
                title,
                description: '',
                status,
                type: 'Feature',
                sub_team_id: subTeamIds[group],
                assigned_to: memberIds[STUDENTS[index % STUDENTS.length][0]],
                checklist: [],
                timeline: [],
                // A spread of due dates, including two in the past, so the dashboard's
                // Upcoming Deadlines panel and its overdue styling both have something to show.
                due_date: new Date(Date.now() + (index - 2) * 3 * day).toISOString(),
            }),
        );
    }

    for (const [index, [teamNumber, notes]] of [
        ['7331', 'Fast cycle, struggles with the far zone.'],
        ['4232', 'Strong auto. Watch their parking.'],
        ['11208', 'Good partner — consistent, low penalties.'],
        ['9905', 'Defensive. Plan around them.'],
    ].entries()) {
        await must(
            'scouting report',
            svc.from('scouting_reports').insert({
                id: uuid(),
                team_id: team.id,
                season_id: season.id,
                opponent_team_number: teamNumber,
                match_number: index + 1,
                event_name: 'League Meet #2',
                // `data` is the scouting payload jsonb; the notes field lives inside it.
                data: { notes },
                created_by: memberIds[STUDENTS[index][0]],
            }),
        );
    }

    console.log('\nDemo team seeded.\n');
    console.log(`  Team:     Demo Robotics #14822`);
    console.log(`  Sign in:  ${EMAIL} / ${PASSWORD}`);
    console.log(`  Contents: 1 season, 4 sub-teams, ${STUDENTS.length} students, ${TASKS.length} tasks, 4 scouting reports`);
    console.log(`  Licence:  15 seats, ${1 + STUDENTS.length} used, ~300 days remaining\n`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
