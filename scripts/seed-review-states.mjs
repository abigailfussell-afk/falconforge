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

/**
 * A term of meetings for one team, plus a roster's worth of attendance.
 *
 * Sprint 8. Meetings are the one feature whose screens are ALL about accumulated history — a
 * summary needs events that have happened, a roster needs scans that arrived at plausible
 * times, and "check-in open" needs an event happening RIGHT NOW, which is a state that exists
 * for two hours a week and cannot be waited for during a review.
 *
 * So the schedule is built relative to now: eight weekly build sessions behind us with real
 * attendance, one running at this moment with check-in open and two thirds of the roster
 * scanned in, and a handful ahead. Codes are drawn per occurrence, exactly as the client draws
 * them, because the unique index does not care who is inserting.
 */
async function seedMeetings(teamId) {
    const { data: season } = await svc
        .from('seasons')
        .select('id')
        .eq('team_id', teamId)
        .limit(1)
        .single();

    const { data: members } = await svc
        .from('team_members')
        .select('id, role')
        .eq('team_id', teamId)
        .eq('status', 'approved');

    const coach = members.find((m) => m.role === 'admin') ?? members[0];

    const taken = new Set();
    const code = () => {
        let next;
        do {
            next = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
        } while (taken.has(next));
        taken.add(next);
        return next;
    };

    /** The given hour, local, on the day `offsetDays` from today. */
    const at = (offsetDays, hour, minute = 0) => {
        const date = new Date();
        date.setDate(date.getDate() + offsetDays);
        date.setHours(hour, minute, 0, 0);
        return date.getTime();
    };

    const seriesId = crypto.randomUUID();
    const series = (extra) => ({
        team_id: teamId,
        season_id: season.id,
        title: 'Build session — chassis rebuild',
        event_type: 'build',
        location: 'Room 214 — engineering lab',
        attendance_required: true,
        series_id: seriesId,
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;UNTIL=20261214',
        created_by: coach.id,
        ...extra,
    });

    const rows = [];

    // Eight weekly build sessions behind us.
    for (let week = 8; week >= 1; week--) {
        rows.push(
            series({
                public_code: code(),
                starts_at: iso(at(-week * 7, 18)),
                ends_at: iso(at(-week * 7, 20, 30)),
            }),
        );
    }

    // Two past events of other kinds, so the type filter has something to filter.
    rows.push({
        team_id: teamId,
        season_id: season.id,
        title: 'Team meeting — season kickoff',
        event_type: 'team_meeting',
        location: 'Room 214',
        public_code: code(),
        attendance_required: true,
        starts_at: iso(at(-11, 18)),
        ends_at: iso(at(-11, 19, 30)),
        created_by: coach.id,
    });
    rows.push({
        team_id: teamId,
        season_id: season.id,
        title: 'Outreach — Lincoln Middle School',
        event_type: 'outreach',
        location: 'Lincoln MS cafeteria',
        public_code: code(),
        // Tracked but NOT required — the state that needed a second control in a form the
        // mockup only drew one switch for.
        attendance_required: false,
        starts_at: iso(at(-4, 16)),
        ends_at: iso(at(-4, 17)),
        created_by: coach.id,
    });

    /*
     * HAPPENING RIGHT NOW: started twenty minutes ago, ends in two hours.
     *
     * So `checkinState` is 'open' the moment a reviewer signs in. That is the state the live
     * feed, the QR panel and both dashboard cards are designed around, and no fixed date can
     * produce it.
     */
    const liveCode = code();
    rows.push(
        series({
            public_code: liveCode,
            starts_at: iso(Date.now() - 20 * 60_000),
            ends_at: iso(Date.now() + 2 * 60 * 60_000),
        }),
    );

    // Ahead of us: the rest of the series, a practice, a competition and a deadline.
    for (const week of [1, 2, 3]) {
        rows.push(
            series({
                public_code: code(),
                starts_at: iso(at(week * 7, 18)),
                ends_at: iso(at(week * 7, 20, 30)),
            }),
        );
    }
    rows.push({
        team_id: teamId,
        season_id: season.id,
        title: 'Practice — driver drills',
        event_type: 'practice',
        location: 'Main gym',
        public_code: code(),
        attendance_required: true,
        starts_at: iso(at(5, 9)),
        ends_at: iso(at(5, 13)),
        created_by: coach.id,
    });
    rows.push({
        team_id: teamId,
        season_id: season.id,
        title: 'League Meet #3',
        event_type: 'competition',
        location: 'Ridgeview HS',
        public_code: code(),
        attendance_required: true,
        starts_at: iso(at(12, 8)),
        ends_at: iso(at(12, 16)),
        created_by: coach.id,
    });
    // A deadline: no code, no attendance. The constraint refuses anything else.
    rows.push({
        team_id: teamId,
        season_id: season.id,
        title: 'Engineering notebook — week 6 entry',
        event_type: 'deadline',
        public_code: null,
        attendance_required: false,
        starts_at: iso(at(20, 23, 59)),
        created_by: coach.id,
    });

    const meetings = await must('meetings', svc.from('meetings').insert(rows).select());

    /*
     * Attendance for what has already happened, deliberately uneven.
     *
     * One member is at everything, one is below 75%, one has excusals with notes — and TWO
     * PAST EVENTS HAVE NO ROSTER AT ALL, because "unrecorded events: 2" is a number on the
     * summary screen and an empty state on the roster, and neither exists unless some rosters
     * were genuinely never saved.
     */
    const now = Date.now();
    const attendance = [];
    const held = meetings
        .filter((m) => m.event_type !== 'deadline' && new Date(m.starts_at).getTime() <= now)
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

    held.forEach((meeting, index) => {
        if (index === held.length - 3 || index === held.length - 4) return;

        const startedAt = new Date(meeting.starts_at).getTime();
        const live = startedAt > now - 60 * 60_000;

        members.forEach((member, position) => {
            // A third of the roster has not scanned into the live session yet, so the coach's
            // screen shows an "of 21 recorded" that is not complete.
            if (live && position % 3 === 2) return;

            const scenario = position % 7;
            const status =
                scenario === 3 && index % 3 === 0
                    ? 'absent'
                    : scenario === 5 && index % 4 === 0
                      ? 'excused'
                      : 'present';

            attendance.push({
                meeting_id: meeting.id,
                team_id: teamId,
                team_member_id: member.id,
                status,
                method: status === 'present' ? (position % 5 === 0 ? 'code' : 'qr') : 'coach',
                notes: status === 'excused' ? 'Family trip' : null,
                attested_by: status === 'present' ? member.id : coach.id,
                // Scans land in the ten minutes around the start, so the live feed's
                // timestamps look like a real evening rather than a fixture.
                attested_at: iso(startedAt - 5 * 60_000 + position * 47_000),
            });
        });
    });

    await must('attendance', svc.from('meeting_attendance').insert(attendance));

    return { count: meetings.length, liveCode, attendance: attendance.length };
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

    // 7. A term of meetings on the ordinary team, including one running right now.
    const mentor = await makeUser('mentor@falconforge.test', 'Ms Okonkwo');
    await must(
        'mentor',
        svc.from('team_members').insert({
            team_id: ordinary.team.id,
            user_id: mentor.id,
            role: 'mentor',
            status: 'approved',
            seat_assigned: true,
            full_name: 'Ms Okonkwo',
            email: 'mentor@falconforge.test',
        }),
    );
    const meetings = await seedMeetings(ordinary.team.id);

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
    console.log('  mentor@falconforge.test    MENTOR on Iron Falcons - runs meetings, not the roster');
    console.log('  iron-student0@falconforge.test  a STUDENT on Iron Falcons - read-only schedule');
    console.log(
        `\n  ${meetings.count} meetings on Iron Falcons, ${meetings.attendance} attendance rows.`,
    );
    console.log(`  Check-in is OPEN RIGHT NOW for code FF-${meetings.liveCode}.`);
    console.log(`  stranded team id: ${stranded.team.id} (no admin; successor member ${strandedCoach.id})`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
