# MKT — Market and competition research for FalconForge

Research date: 2026-08-22. All URLs were accessed on that date unless noted. Sources older than 2024 are flagged. Figures marked **(est.)** are my estimates; figures marked **(primary)** were queried directly from a live API during this research. Chief Delphi threads were read from their Discourse JSON endpoints (`/t/<id>.json`); Reddit blocks automated access, so r/FTC evidence is absent — see "Confidence / not checked".

Context for this report: FalconForge (README, `FALCONFORGE_V2_PLAN.md` §1–2) is a per-named-user, per-team SaaS for FTC teams — roster/roles, sprint planner, scouting, match planning, checklists, meetings/attendance with QR check-in, guardian-managed under-13 profiles, seasons as fresh starts, offline-first PWA, Supabase backend, Stripe later, beta at FTC kickoff (12 Sept 2026).

---

## 1. Market size

### FTC teams and students

| Metric | Value | Source |
|---|---|---|
| FTC students, 2024–25 season | "more than 109,000 students ages 12-18 in 81 countries" | FIRST program page / 2025 Annual Impact Report [S1][S2] |
| FTC **active teams that played a match**, 2023 / 2024 / 2025 seasons | **6,808 / 8,076 / 8,866** (primary) | FTCScout GraphQL `activeTeamsCount` [S3] |
| FTC matches played, 2025 season | 45,135 (primary) | [S3] |
| FTC events listed, 2025 season | 1,927 total: 373 Qualifiers, 641 League Meets, 129 League Tournaments, 149 Championships, 317 Scrimmages, 164 Kickoffs, 52 Off-season, 7 FIRST Championship divisions (primary) | [S3] |
| US vs non-US events, 2025 | 1,473 US / 454 non-US (76% US). Top regions by event count: Texas 178(+45 Houston), Michigan 113, Romania 103, Iowa 78, MO/KS 78, California-LA 69, California-North 59, Illinois 57, UK 54, NJ 54 (primary) | [S3] |
| All-time team records in FTCScout | 22,652; USA 14,922 (66%), Canada 839, Kazakhstan 808, Romania 599, UK 508 (primary) | [S3] |
| Teams with rookie year 2023 / 2024 / 2025 | 2,823 / 3,499 / 4,347 (primary; includes teams that registered and never played) | [S3] |
| Wikipedia table (2024–25) | "~11,000 teams, 109,000+ participants" | [S4] — the 11,000 is **registered** teams; the 8,866 above is teams that played |
| 2026 FIRST Championship | 336 FTC teams (up 31% from 256) | [S5] |
| FRC teams, 2026 season | 3,696 registered/secured as of 15 Dec 2025 (official snapshot); Wikipedia says 3,724–3,791 | [S6][S7] |
| FRC students 2025 | "more than 93,000 students in 35 countries" | [S2] |

So the FTC addressable universe is **~9,000 active teams/season (≈6,000–6,500 in the US, est.)**, growing ~10%/yr (6,808 → 8,076 → 8,866 in two seasons). The rookie counts are striking: ~4,300 teams with rookie year 2025 against 8,866 active implies **high churn — roughly a third to a half of active teams each season are in their first year** (est.; FTCScout's `rookieYear` may include teams that registered but never competed). That matters: a large share of the market is a coach who has never run a team before and will not be looking for a "team management platform" — they are looking for "how do I do this at all".

### Team size, coach profile, budget

- **Team size:** FIRST regions state max 15 students, "ideal 10–12" / "many teams include 8–12" [S8]. The only peer-reviewed data I found (ASEE 2025 paper surveying 451 FTC teams across five Texas regional/state and two World championships, 2022–24) measured **average team size 8.6–10.2 (±3.5–4.1)** across all levels [S9]. So a "seat" model has ~10 students + 2–4 adults per team ≈ **12–14 named users per team**.
- **School vs community teams:** same paper: **82% school-affiliated at the regional level, 70–74% at state, 49–53% at Worlds** [S9]. i.e. the *median* team is school-based (procurement constraints apply, §4), but the *serious* end is disproportionately community/parent-run. The paper attributes this to school teams pausing over breaks, coach availability, and "school district purchasing rules".
- **Coach profile:** FIRST requires two screened 18+ lead coaches per team before the roster opens, annual Youth Protection training, and (new in 2025–26) a ~2-hour "Mentor Ready" path [S10]. I found no published teacher-vs-parent split for FTC coaches. **(est.)** From the school-affiliation numbers, roughly three-quarters of teams have a teacher as at least one lead coach; the community teams are parent/engineer-led.
- **Season expenditure (ASEE survey):** regional-level teams **$4,062**, state **$9,710**, Worlds **$18,846–19,844** per season [S9]. Teams at Worlds work >12 h/week Sept–April and >30 h/week in the final month; regional teams 6–9 h/week. The **most frequently raised concern at Worlds 2024 was "time management, particularly how to effectively coordinate team members to collaborate on tasks"** [S9] — which is exactly FalconForge's sprint-planner pitch.
- **Fixed costs every team already pays:** FIRST registration **$325 (2025–26) → $350 (2026–27)**; FRC $6,300 → $6,500 [S11][S12]. Regional event fees on top: e.g. FIRST Chesapeake $500 for two qualifiers, Indiana $300, Colorado $250 [S13]. FIRST's own first-year estimate: **~$1,850** ($350 + ~$1,500 for driver kit $295, Control Hub $350, build kit $660) [S12]. Onshape, Fusion 360, Creo, SolidWorks are all free to teams on education licences [S14]. Veteran teams with Worlds ambitions spend $10–20k, much of it on goBILDA/REV parts and travel.
- **"Serious/organized" segment (est.):** using the ASEE expenditure tiers and event structure, the state-championship-and-above tier is roughly 149 championships × ~40–70 teams ≈ **2,500–3,500 teams worldwide**, of which perhaps 1,800–2,500 US. Those teams already spend $10k+/season; a $150–400/yr software line is <4% of budget. Below that tier, budgets are $4k and the registration fee increase alone ($25) prompted a Chief Delphi thread, so price sensitivity is real.

### Season calendar and sales cycle

- Kickoff: **12 Sept 2026** (BIOBUZZ) [S1]; 2025–26 kickoff was 6 Sept. Qualifiers/league meets Oct/Nov–Feb; regional/state championships Jan–March; FIRST Championship Houston late April [S4]; FTCScout shows 2025 events from 15 Nov (first qualifier) through May (UAE regional, 2 May 2026) [S3].
- Team registration opens in May, and the FIRST Dashboard redesign lands "mid-June 2026" [S10]. Coaches build rosters and collect consent forms June–September.
- **Implication:** the buying window is **May–September** (budget set, roster forming, coach has time). By October coaches are heads-down; by February the season is ending and nobody adopts a new tool. A product that misses September has effectively missed the year — but in-season *scouting* adoption can happen per-event (a scouting feature is bought in November; a team-management feature is bought in August).
- Off-season (May–Aug) is when the ASEE data says 83–89% of Worlds teams keep meeting — attendance/meetings has a year-round use, the planner does not.

---

## 2. Competitors and adjacent tools

### Competitor matrix

| Tool | What it does | Pricing | Strengths | Weaknesses / gaps | Maintained? |
|---|---|---|---|---|---|
| **FTC TeamForge** (ftcteamforge.com) [S15][S16][S17] | Direct competitor: engineering notebook (Notion-like), Kanban tasks, calendar + attendance + RSVP, budget/fundraising, scouting notes pulling FTC Events API, mentoring log, roles. Next.js + Supabase, self-host on Vercel/Supabase free tiers. | Free, AGPL-3.0, "commercial use prohibited" | Feature list overlaps FalconForge almost 1:1 plus notebook + budget. Launched on Chief Delphi 12 Nov 2025 by FTC team 26336; "deploy your own instance in 10–15 min". | Built by a student team "100% using AI-assisted programming"; **8 stars / 8 forks; last push 14 Dec 2025 (8 months stale)**; each team self-hosts (no multi-tenant SaaS, no billing, no COPPA story); offline only for the notebook. CD thread had 406 views, 1 confirmed adopter (team 27406). | Stalling |
| **FTCScout.org** [S18][S19] | Public stats site: teams, events, match results, rankings, OPR/"TEP" records, 3D field maps; free GraphQL + REST API (api.ftcscout.org). GPL-3.0, 1,317 commits, pushed July 2026. | Free | De-facto community standard for FTC stats (listed in gm0 resources); API open and unkeyed; data back to 2019. | Read-only public data, no private scouting, no team ops. **No published API terms** — unclear whether a commercial app may consume it (and its upstream is the FIRST API, see below). | Yes, active |
| **FTC Events + FTC Events API** (ftc-events.firstinspires.org, ftc-api.firstinspires.org) [S20][S21] | Official: events, schedules, match results/scores with per-season score breakdowns, rankings, alliances, awards, teams, regions, leagues. Username+token (free, automatic). Data published after event scoring is uploaded (FTC-Live scorekeeper uploads to cloud; during the event the local FTC-Live server is "source of truth" [S22]). | Free | Authoritative, free key, Last-Modified/If-Modified-Since caching. | **Terms: "The data from this API may not be used for commercial purposes. There can be no financial gain from acquiring an access token."** and a link-back is required [S20][S21]. Data is not live during the event (depends on scorekeeper upload). No OPR — computed by third parties. | Yes, official |
| **The Blue Alliance** (FRC) [S23] | FRC stats, API v3 with free key (`X-TBA-Auth-Key`), webhooks, historical data to 1992. | Free | The FRC ecosystem's backbone; many scouting apps build on it. | FRC only. | Yes |
| **Statbotics** (FRC) [S24] | EPA/Elo ratings, Python API. | Free | Best-in-class predictive metrics. | FRC only. | Yes |
| **Scoutradioz** (FRC) [S24] | Multi-team scouting-as-a-service on AWS, by FRC team The Gearheads. | Free | Hosted, multi-team. | FRC only. | Yes |
| **Maneuver** (FRC) [S25] | Offline-first FRC scouting/strategy PWA; no accounts, no server, QR/local data transfer; "over 1500 users" in 2025. 161-post CD thread Jan 2026. | Free, open source | Proves offline-first PWA scouting is the community's preferred architecture; year-agnostic core + per-season game module. | FRC only; no team management. | Yes |
| **FTC Tracker** (iOS/Android) [S26] | Live rankings/matches/schedules, scouting note templates, voice scouting with AI parsing, rulebook chat, practice scorer. Released Feb 2026, 8 languages. | Free with in-app purchases | Polished native app, event-day focus. | Scouting only, no team ops; AI cost model. | Yes (new) |
| **"FTC Scouting and Scoring"** (team 11253 / Cobalt Colts), **TeamTrack: FTC Scouting**, **FTC Scouting** (id6474563665) [S27] | Team-built app-store scouting apps with shared DB and alliance-pick summaries. | Free | Exist. | Per-season rebuilds, mostly single-team projects, uncertain maintenance. | Mixed |
| **MyTeam by BNI** [S28] | iOS app: scouting, messages, tasks, events, hours tracking with "approved and verifiable" reports. | Unknown (App Store page 404 on fetch) | Closest prior attempt at "FTC team app". | Page not reachable → likely dead. | Probably not |
| **FTCPortfolioLab** [S29] | Portfolio coaching/feedback against judging criteria, © 2026. | Undisclosed | Addresses judging prep, a real pain. | Narrow. | New |
| **Hudl** [S30] | Video capture/review/highlights; club soccer from ~$500/team/yr, football $400–1,600/team/yr; annual prepay. | $400–1,600/team/yr | Sticky because the **video is the record**: every game is captured, athletes/parents/recruiters consume it, and leaving means losing the archive. Team comms and schedules are add-ons, not the hook. | FalconForge has no equivalent "irreplaceable artefact" yet — candidates: attendance history, season archive, scouting DB. | Yes |
| **TeamSnap** [S31][S32] | Youth-sports roster/schedule/availability/chat; used by FRC team 2451 and others ("has the calendar and going/not going functions, which some parents like"). | Free tier; paid ~$10–18/team/month per third-party listings (TeamSnap's own page shows "$0 to start", upgrade for availability/larger rosters) | Parents already know it; YPP-friendly DM rules ("requiring two adults on DMs"). | No robotics concepts (seasons, sub-teams, scouting, portfolio). | Yes |
| **Spond, Band, GroupMe, Remind, Slack, MS Teams, Basecamp, Discord** [S32][S33] | Comms + scheduling. CD survey thread (Sept 2025, 41 posts): Slack common but free tier drops history; districts block Discord and Slack; Remind limited to 140 chars; Basecamp education plan liked for kanban+auditable DMs; Spond for head-count/attendance. | Free/edu | Already installed. | Every thread notes an **unofficial student Discord the mentors can't see** ("It's endemic, unfortunately"). | Yes |
| **Notion / Trello / Jira / ClickUp / Monday** | Generic PM. Monday sells an "FRC Workspace Template"; TeamForge's own pitch is "Tired of juggling Google Docs, random spreadsheets, and messy Trello boards". | Free tiers; Notion/ClickUp edu | Flexible. | Not season-aware, not offline, no roster/roles/consent model, students under 13 cannot hold accounts. | Yes |
| **Google Sheets / paper scouting** [S34][S35] | The actual default. CD threads: "collect data on paper and enter it back at the hotel"; QR codes scanned by someone with signal; $300 Raspberry-Pi-plus-router offline scouting servers (Viper). | Free | Zero onboarding. | "One of the largest problems every system faces: event Wi-Fi" (Turtles, CD, Jun 2026); FIRST forbids hotspots near the field. | n/a |
| **FIRST's own tools** — Dashboard, Thinkscape, Team Management Resources [S10][S36][S37] | Dashboard: registration, roster, Youth Protection screening, electronic consent/release per season, event registration. Thinkscape: LMS with season guides/"Coach's Playbook"; Team Management Resources: fundraising, marketing, checklists, Mentor Manual PDF. | Free (included) | Official and mandatory for roster/consent. | No tasks, attendance, meetings, scouting, or match planning. Thinkscape has known privacy caveats ("users should not have actual student names or emails"). | Yes |
| **Engineering-notebook tools** | Google Docs/Slides, Canva, Adobe; portfolio capped at **15 pages + title page** [S38]. FIRST publishes an award-winning portfolio library [S14]. | Free | — | Nobody has a dominant tool; TeamForge and Notion templates attempt it. | — |

### Training resources and their licences (for the onboarding/training pillar)

| Resource | Licence | Can FalconForge (a commercial product) reuse it? |
|---|---|---|
| **Game Manual 0** (gm0.org) [S39] | **CC BY-NC 2.0** (verified from the repo LICENSE file) | **No embedding or derivative content** — the NC clause forbids use "primarily intended for … commercial advantage". Link only. |
| **FTC Docs** (ftc-docs.firstinspires.org) [S40][S41] | Repo is **BSD-3-Clause** (code/markup), but the site's Terms of Service grant only "personal, non-commercial use" and forbid copying "for any commercial purpose" or use "as part of any effort to compete with FIRST". | Link only; do not mirror. Treat the ToS as controlling for the prose. |
| **CTRL ALT FTC** (BenCaunt/CTRL-ALT-FTC) [S42] | No licence file found → all rights reserved by default | Link only. |
| **Learn Java for FTC** (alan412/LearnJavaForFTC) [S42] | No licence file found | Link only. |
| **REV / goBILDA docs** | Vendor copyright | Link only. |
| **FIRST Resource Library** (Mentor Manual, Coach's Playbook, checklists) | FIRST copyright, ToS as above | Link only. |
| **Unofficial FTC Discord** [S43] | ~16,000 members (discord.band listing; figure undated) | Link; it is the primary support channel. |

**Net:** none of the major FTC training corpora can be embedded in a paid product. An onboarding section must be **original** text that *points at* these resources, or a curated link-tree. That is also the defensible thing: the value is the *sequencing* and *role-specific checklist* ("first two weeks for a build-team rookie"), not the content itself.

---

## 3. What teams complain about (forum evidence)

All from Chief Delphi unless noted; quotes ≤15 words.

1. **Scouting data entry with no Wi-Fi** — "A solution to uploading scouting data with bad Wi-Fi" (Jun 2026, 45 posts) [S35]: "One of the largest problems every system faces: event Wi-Fi." (Turtles). Options listed: QR codes ("very annoying to scan every qr code"), $300 Pi+router offline servers, or "saving data offline and uploading when you have internet" — rejected only because "we want data instantly". FIRST forbids hotspots. Team 1073's Viper doc: "there are almost never power outlets in the stands." Maneuver's 1,500 users show offline-first PWA + local transfer is what wins [S25]. FalconForge's sync engine is the right architecture; the missing piece in every thread is *sharing between scouts without a server* (QR/Bluetooth/WebRTC relay).
2. **Coaches can't see student comms; districts block tools** — "Survey: Primary team communications tool" (Sept 2025) [S32]: "school district eliminated [Slack] due to the risk of inappropriate student-adult DMs"; "There is at least one unauthorized student discord server." (FrankJ); "Seeking Robust Multi-Team Communication Platform (Discord Blocked/Cell Service Poor/Band Not Cutting It)" (Oct 2025) [S33]: "not all students have cell phones (many use school-issued Chromebooks)". Pattern: the adults need an **auditable, district-allowed** system; the students will keep Discord regardless. FalconForge should not try to be chat; it should be the system of record that works on a Chromebook.
3. **Parent visibility / accountability** — "What to do about accountability within team leadership: Mentors and Parents" (Sept 2023, 49 posts, older than 2024) [S44]: a parent describes mentors who "REFUSE to communicate with parents". Replies: "Parental involvement is a huge strengthening factor to most teams." TeamSnap is cited elsewhere precisely because "parents like" going/not-going [S32]. FalconForge's guardian view is aimed at exactly this gap but today only covers under-13s.
4. **Time management / coordinating collaboration** — the #1 concern in the ASEE survey of Worlds 2024 teams [S9]; TeamForge's launch post names the incumbent: "juggling Google Docs, random spreadsheets, and messy Trello boards" [S17].
5. **Engagement, attendance, mentor ratio, pipeline** — "How to improve team culture and FIRST pipeline?" (Jan 2026) [S45]: "mentor-to-student ratio… around 10:1", priorities "meeting attendance, event involvement, and volunteering"; one team sets "40 hours for each student" outreach goals with rewards. Attendance and hours tracking with per-member totals is a real ask (also MyTeam's "verifiable" hours pitch).
6. **Knowledge loss at graduation / continuity** — "Rethinking our FTC team(s)" (Apr 2023, older) [S46]: FTC teams used as a one-year "filler gap" before FRC; "it highlights the importance of continuity" (vladb). Adam Reed's May 2026 retrospective (123 posts, also big on Discord) [S47] is about program design (cost of COTS swerve, scoring >150 balls without field auto-scoring → "impossible to accurately score without something like video review"), which also says manual scouting is getting *harder* as games scale.
7. **Judging / portfolio prep** — 15-page cap, the only required document [S38]; FTCPortfolioLab exists because teams want feedback against rubric. FalconForge has no artefact here yet; attendance + sprint history + outreach logs are raw material for the portfolio's "team management" section.
8. **Funding & school procurement** — ASEE: "funding can be restrictive in school-affiliated teams due to school district purchasing rules" [S9]; CD: district IT "if we give that to you, we'll have to give it to all the school clubs" [S32].

Not found (searched, no evidence retrieved): r/FTC threads (blocked), explicit "coach burnout" FTC threads, "knowledge transfer at graduation" FTC-specific threads post-2024.

---

## 4. Pricing

### Comparable youth-team/club software

| Product | Price | Notes |
|---|---|---|
| TeamSnap (per team) | Free tier; ~$10–18/team/month on third-party listings ($9.99 Basic / $12.49 Premium / $17.99 Ultra per TrustRadius) [S31]; TeamSnap's own page only says "$0 to start" | Annual discount; club plans separate |
| Hudl club | Soccer from $500/team/yr; football $400 / $1,000 / $1,600 per team/yr; annual prepay [S30] | Video is the product |
| SportsEngine HQ | $79 / $129 per month, Pro $2,199/yr (org-level) [S31] | Registration/payments |
| Basecamp | Free education/non-profit plan (cited by two CD teams) [S32][S33] | Kanban + auditable DMs |
| Slack | Free (60–90 day history) / non-profit plan | History loss is the complaint |
| FTC TeamForge, FTCScout, Maneuver, Scoutradioz, TBA, Statbotics | **Free** | The FIRST-tool norm is free and open source |

### What FTC teams might tolerate (est.)

- Everything in the FTC tool ecosystem is free. The only paid things teams routinely buy are hardware, registration, and travel. A $25 registration rise got its own CD thread [S11].
- Per-named-user pricing (the plan's model) at, say, $3/user/month × 13 users = ~$470/yr — that is **above Hudl's entry tier** and ~10% of a regional team's whole $4k season. It will not clear a school purchasing card without a DPA (below).
- Hypothesis that fits the evidence: **flat per-team-per-season pricing** — roughly **$99–149/team/season** for the serious tier (2,500–3,500 teams, <2% of their $10–20k spend), a free/gifted tier for rookies, and a sponsor/Program-Delivery-Partner bulk rate. Per-seat adds billing friction for exactly the people (guardians, mentors who show up twice) the product wants on the roster. Note this contradicts plan §2's locked "per named user" model; flagging, not deciding.
- Rookie tier is price-zero in practice: half the market is first-year, $4k budget, teacher-led, with a district card.

### School procurement constraints

- **COPPA** (<13) already handled by the guardian model; **FERPA** applies when a *school* discloses education records to a vendor — a robotics club roster with names/emails counts in most districts' reading.
- **SDPC National Data Privacy Agreement v2.2 (Nov 2025)**: 12,000+ districts and 6,674 vendors; "Districts that use the NDPA will expect vendors to sign it with minimal redlines"; "Any education app that collects, stores, or processes personally identifiable student information should have a signed DPA with the district before classroom use" [S48][S49]. Many states (CA, CT, IL, NY, etc.) require a DPA by statute.
- Practical consequence: a school-affiliated team (≈75–80% of regional-level teams [S9]) **cannot legally roster students into FalconForge on a teacher's initiative without the district signing a DPA** — and districts sign one per vendor, with an exhibit listing data elements and subprocessors (Supabase, GitHub Pages, Stripe, email provider). The free-tier Supabase with 1-day log retention and no PITR, and a gh-pages front end with no security headers, are things a district privacy officer will ask about (the plan §3 already lists CSP/headers as a trigger to leave gh-pages).
- Community/parent teams (the ones at Worlds) have no such gate; the primary admin is a parent with a personal card. **That is the beachhead.**
- Thinkscape's own guidance tells FIRST users "should not have actual student names or emails" in it [S36] — a signal that even FIRST sidesteps district data rules rather than solving them.

---

## 5. Distribution / growth channels

- **Unofficial FTC Discord** (~16k members, "the most active FTC community") [S43] and **Chief Delphi** (FTC subforum, FTC Open Alliance build threads) are where every tool in the matrix launched: TeamForge (CD, Nov 2025, 406 views, 1 adopter), Maneuver (CD, 161 posts, 1,500 users), Viper, Scoutradioz. A CD launch reaches the serious tier; it does not reach rookie teachers.
- **gm0's "Useful Resources" page** [S14] is the canonical link list (FTC Events, FTCScout, Discord, CAD libraries). Being listed there is worth more than any ad; gm0 is a community repo that accepts PRs.
- **Program Delivery Partners** (regional affiliates: FIRST in Texas, FIRST Chesapeake, FIRST Indiana, FIRST Washington, etc.) run coach training, publish "getting started" pages, and set event fees [S13]. They are the only channel that reaches rookie/teacher coaches, and they run coach workshops in August–September. A PDP-endorsed "team management" recommendation or a bulk gifted licence for their rookie cohort is the scalable rookie channel.
- **FIRST itself**: Dashboard (mandatory: roster, YPP, consent), Thinkscape (LMS), Team Management Resources, Mentor Ready (2025–26), new Dashboard design June 2026 [S10][S36][S37]. FIRST does **not** provide tasks, attendance, meetings, scouting or match planning, so FalconForge does not collide with a free official tool — but it must not duplicate the roster/consent of record (the Dashboard roster "is required at check-in" [S37]); import from / link to it instead.
- **Vendors (REV, goBILDA, AndyMark)**: publish curricula and kit docs; no evidence of software partnerships beyond Onshape/Autodesk education licences [S14]. Low priority.
- **Coach Facebook groups / regional coach listservs**: not researched (no access).
- **Event-day virality**: scouting tools spread at events when another team sees the screen. Maneuver's 1,500-user spike came from off-season events. FalconForge's scouting module is the only feature with that property.

---

## 6. FRC differences an abstraction should anticipate

| Dimension | FTC | FRC | Abstraction note |
|---|---|---|---|
| Alliance size | 2v2 (red/blue) | 3v3 | `alliance.size` per program; match-planner canvas and scouting forms keyed on it |
| Field | 12×12 ft tiles, new game each Sept | 27×54 ft, new game each Jan | Field image and coordinate system per `(program, season)` |
| Season | Sept kickoff → April Worlds; leagues/qualifiers/regionals | Jan kickoff → 6-week build → Mar–Apr events → Apr Worlds; **56 regionals + 144 district events** in 2026 [S7] | Season start date, event-type taxonomy (League Meet / Qualifier / Regional / District / DCMP) per program |
| Event data | FTC Events API (non-commercial), FTCScout | TBA API v3 (free key, webhooks), FRC Events API, Statbotics [S23][S24] | One `EventDataProvider` interface; never bake a provider into entity schemas |
| Team size | 8–12 students, 2–4 adults | 20–60+ students, 5–15 mentors, sub-teams are mandatory | Roster/sub-team features must scale ×4; per-seat pricing breaks here |
| Registration | $350 | $6,500 + $4–5k per extra event | FRC teams have budgets that tolerate SaaS; also far more likely to be school-run with DPAs |
| Tooling maturity | Under-served: no dominant scouting app, no team-ops app with traction, one stale OSS entrant | Saturated: TBA, Statbotics, Scoutradioz, Maneuver, Viper, dozens of team apps | **FTC is where the gap is**; FRC scouting is a red ocean — the team-ops/attendance side is the only FRC opening |
| Scoring | Manual referees; >150 game pieces per match this year; OPR computed by third parties | FMS auto-scoring for many elements; richer per-match breakdowns | Scouting form schema must be season-defined data, not code (Maneuver's `gameData.auto/teleop/endgame` pattern) |

---

## So what for FalconForge

1. **The market is ~9,000 active FTC teams, growing ~10%/yr, about 70% US, and roughly half first-year.** The serious tier that could pay is **~2,500–3,500 teams (est.)**; they are disproportionately community/parent-run, spend $10–20k/season, and meet year-round.
2. **There is no entrenched competitor in FTC team operations.** The one direct entrant (TeamForge) is free, self-hosted, AI-generated, and has not been pushed since Dec 2025. The bar is "be the first thing that actually works and is hosted".
3. **The strongest evidence-backed pain is offline scouting at events**, and the community's chosen architecture (Maneuver, 1,500 users) is exactly FalconForge's: offline-first PWA. What they lack and FalconForge could own is **multi-scout sharing without a server** (QR burst / Bluetooth / local relay) plus a hosted sync when signal returns. Build this before anything else in scouting; it is also the only feature with event-day virality.
4. **Do not build against the FTC Events API as a paid product.** Its terms forbid commercial use and "financial gain from acquiring an access token". Options: (a) FTCScout's API (ask them for written permission; its upstream is still FIRST's data), (b) user-side import (the user pastes/uploads an event schedule they fetched with their own key — legally their use, not yours), (c) make the schedule/rankings view a free, unlicensed feature. Get a legal read before kickoff; Match Planner and Scouting currently presume event data exists.
5. **Don't compete with FIRST's Dashboard for roster-of-record or consent; integrate by import.** FIRST owns registration, YPP screening and the per-season Consent & Release. FalconForge's roster should be the *operational* roster (sub-teams, roles, attendance) and must not pretend to be the legal one.
6. **Pricing hypothesis: flat per-team-per-season, ~$99–149, with a free rookie tier**, rather than per-named-user. Every other FTC tool is free, per-seat punishes guardians and drop-in mentors, and FRC (later) has 40-person rosters. This contradicts the locked plan §2 model and should be an explicit decision, not drift.
7. **School teams need a DPA before they can adopt; parent-run teams don't.** Beta with community teams. Before selling to schools: sign the SDPC NDPA v2.2 template once, publish a subprocessor list, move to Supabase Pro (PITR, log retention), and get off gh-pages (security headers) — the plan already names the last two triggers.
8. **Make something irreplaceable, the way Hudl's video is.** Candidates that accrue value across seasons: attendance/hours history per student (needed for portfolios, outreach awards, and parent visibility), the season archive ("full history backward"), and the scouting DB across events. Promote per-member season summaries and exportable "hours" reports to first-class features.
9. **Guardian visibility is a selling point beyond COPPA.** The parent-visibility thread and TeamSnap's appeal ("parents like going/not going") say a read-only parent view for *all* minors, not just under-13s, would be the feature a parent-run team's admin would pay for.
10. **Do not be chat.** Districts block Discord/Slack, students keep a secret Discord anyway; the adults want an auditable system of record that runs on a Chromebook. Be that, and link out to whatever chat they use.
11. **The training/onboarding pillar must be original or link-only.** gm0 is CC BY-NC, FTC Docs' ToS is non-commercial, CTRL ALT FTC and Learn Java for FTC have no licence. Ship role-specific onboarding *checklists and sequences* that point to those resources; never mirror their content.
12. **Sales window is May–September; scouting sells in-season.** The September 2026 beta is correctly timed for team-ops; plan a second "scouting-only" push for November qualifiers, where a team can adopt without migrating anything.
13. **Go-to-market order:** (i) Unofficial FTC Discord + Chief Delphi FTC launch thread with a live hosted demo (the thing TeamForge couldn't offer), (ii) a PR to gm0's resources page, (iii) one or two Program Delivery Partners (Texas and Michigan have the most events) for rookie cohort gifting, (iv) FRC only after the FTC season proves retention.
14. **Design the season/game layer as data, not code** (Maneuver's `core` + per-season module split), because the FTC game changes every September and FRC every January; the scouting form and match-planner field must be a `(program, season)` asset.
15. **Portfolio output is a cheap, high-value bridge**: attendance, sprint velocity, outreach hours and meeting logs exported as a one-page "team management" summary for the 15-page portfolio would be unique in the market and uses data FalconForge already holds.

---

## Summary

- ~8,900 FTC teams played in 2025 (primary, FTCScout), +10%/yr; ~70% US; half are rookies; the payable tier is ~2,500–3,500 teams at $10–20k/season.
- No maintained FTC team-ops competitor exists; TeamForge (free, AGPL, self-host, AI-built) is stale since Dec 2025. Scouting has FTCScout (stats) and FTC Tracker (native), both free.
- The FTC Events API forbids commercial use — a blocker for a paid product's scouting/match-planner data unless worked around (user-side import, FTCScout permission, or free feature).
- Offline scouting at events is the best-documented pain (CD Jun 2026, Maneuver's 1,500 users); the gap is serverless scout-to-scout sharing.
- Comms tools are blocked by districts and students use Discord regardless; adults want an auditable system of record on Chromebooks — not chat.
- School teams (75–80% at regional level) require an SDPC NDPA before rostering minors; parent-run teams (half of Worlds) do not — beta there.
- Flat per-team-per-season pricing (~$99–149, free rookie tier) fits the evidence better than per-named-user; flagged as a contradiction with plan §2.
- All major FTC training content (gm0 CC BY-NC, FTC Docs non-commercial ToS, unlicensed CTRL ALT FTC / Learn Java) is link-only for a commercial product.
- Buying window is May–September for team ops; scouting can be adopted per-event in Nov–Feb.

## Confidence / not checked

- **Reddit r/FTC** blocked automated access; no r/FTC evidence. Coach Facebook groups not accessible.
- **FTC Events API terms** quoted from the FTC services page and the FRC terms page (same wording); I did not find a separate FTC-specific legal terms document. Get a lawyer's read.
- **FTCScout API terms** — none published; I did not contact the maintainers.
- **TeamSnap prices** are from third-party listings (TrustRadius); TeamSnap's own page hides tiers. Hudl prices are from Hudl's sport pages via search snippets, not fetched directly.
- **Rookie-share estimate** relies on FTCScout `rookieYear`, which may count registered-but-never-played teams; the true first-year share of *active* teams could be 30–50%.
- **"Serious tier" size** (2,500–3,500) is an estimate from event counts × typical championship field sizes, not a FIRST figure.
- **Teacher vs parent coach split** — no published data found; inferred from school-affiliation rates in a Texas-centric survey (ASEE 2025), which may not generalise.
- **MyTeam by BNI** App Store page returned 404; "dead" is an inference.
- FIRST 2025 Annual Impact Report PDF exceeded fetch size; team totals taken from FIRST program pages and Wikipedia instead.
- FTC Discord member count (16,153) is from a third-party listing of unknown date.

## Sources

- [S1] FIRST Tech Challenge program page — https://www.firstinspires.org/programs/ftc/ (109,000 students, 81 countries, 12 Sept 2026 kickoff)
- [S2] FIRST 2025 Annual Impact Report — https://www.firstinspires.org/hubfs/web/about/report/annual_report_2025.pdf (via search snippet; PDF too large to fetch)
- [S3] FTCScout GraphQL API — https://api.ftcscout.org/graphql (queries `activeTeamsCount`, `matchesPlayedCount`, `eventsSearch`, `teamsSearch`, run 2026-08-22)
- [S4] Wikipedia, FIRST Tech Challenge — https://en.wikipedia.org/wiki/FIRST_Tech_Challenge
- [S5] FIRST Community blog, Advancement & FIRST Championship update — https://community.firstinspires.org/advancement-first-championship-update
- [S6] FIRST Community blog, Advancement to the 2026 FIRST Championship — https://community.firstinspires.org/2025-advancement-to-the-2026-first-championship
- [S7] Wikipedia, Rebuilt (FIRST) — https://en.wikipedia.org/wiki/Rebuilt_(FIRST)
- [S8] FIRST in Tennessee, FTC Run a Team — https://www.tnfirst.org/ftc-run-a-team ; FIRST get-started — https://www.firstinspires.org/programs/ftc/get-started
- [S9] ASEE 2025, "Bridging Gaps in Robotics Education: Insights from Team Surveys on FIRST Tech Challenge" — https://peer.asee.org/bridging-gaps-in-robotics-education-insights-from-team-surveys-on-first-tech-challenge.pdf (451 responses, 2022–24; local copy `$S/mkt/asee.pdf`)
- [S10] FIRST Community, Key Updates for Youth Protection Program, Mentors, Volunteers — https://community.firstinspires.org/updates-to-first-youth-protection-for-mentors-volunteers ; Youth Registration — https://www.firstinspires.org/programs/youth-registration
- [S11] FIRST Community, 2025-2026 FIRST Program Registration Pricing — https://community.firstinspires.org/2025-2026-first-program-registration-pricing ; CD thread https://www.chiefdelphi.com/t/497550
- [S12] FIRST, FTC Cost & Registration (2026–27) — https://www.firstinspires.org/robotics/ftc/cost-and-registration
- [S13] FIRST Chesapeake — https://www.firstchesapeake.org/post/august-ftc-link-decode-season-registration-and-qualifiers ; FIRST Indiana — https://www.firstindianarobotics.org/ftc/events/ ; FIRST in Texas fees — https://firstintexas.org/news/2025-2026-first-tech-challenge-texas-season-fees-and-regional-breakdown
- [S14] Game Manual 0, Useful Resources — https://gm0.org/en/latest/docs/useful-resources.html
- [S15] FTC TeamForge docs — https://www.ftcteamforge.com/docs/getting-started/introduction
- [S16] GitHub incredibotsftc/teamforge — https://github.com/incredibotsftc/teamforge (GitHub API: 8 stars, 8 forks, created 2025-11-01, pushed 2025-12-14)
- [S17] Chief Delphi, "Introducing FTC TeamForge" (2025-11-12) — https://www.chiefdelphi.com/t/508120
- [S18] FTCScout — https://ftcscout.org/ ; API — https://ftcscout.org/api
- [S19] GitHub ftc-scout/ftc-scout — https://github.com/ftc-scout/ftc-scout (GPL-3.0, 50 stars, pushed 2026-07-21)
- [S20] FTC Events API information page — https://ftc-events.firstinspires.org/services/API ("may not be used for commercial purposes")
- [S21] FRC/FTC API Terms of Use — https://frc-events.firstinspires.org/services/API/terms ; API docs — https://ftc-events.firstinspires.org/api-docs/index.html ; endpoint list via https://github.com/maths22/ftc-api-v3-client-ruby
- [S22] FTC-Live Setup Guide — https://ftc-resources.firstinspires.org/ftc/event/scoring-setup ; scorekeeper repo — https://github.com/FIRST-Tech-Challenge/scorekeeper
- [S23] The Blue Alliance APIv3 — https://www.thebluealliance.com/apidocs/v3
- [S24] Statbotics — https://www.chiefdelphi.com/t/statbotics-2025-season/485043 ; Scoutradioz — https://scoutradioz.com/
- [S25] Chief Delphi, "Maneuver: an offline-first FRC strategy suite for Rebuilt!" (2026-01-28, 161 posts) — https://www.chiefdelphi.com/t/513011
- [S26] FTC Tracker — https://ftctracker.org/ ; App Store — https://apps.apple.com/us/app/ftc-tracker/id6754353867
- [S27] App Store: FTC Scouting and Scoring — https://apps.apple.com/us/app/ftc-scouting-and-scoring/id1448567515 ; TeamTrack — https://apps.apple.com/us/app/teamtrack-ftc-scouting/id1540507178 ; FTC Scouting — https://apps.apple.com/ca/app/ftc-scouting/id6474563665
- [S28] MyTeam by BNI — https://apps.apple.com/us/app/id6470533478 (404 on fetch)
- [S29] FTCPortfolioLab — https://www.ftcportfoliolab.org/
- [S30] Hudl club pricing — https://www.hudl.com/pricing/club ; soccer — https://www.hudl.com/pricing/club/soccer ; football — https://www.hudl.com/pricing/club/football
- [S31] TeamSnap pricing (TrustRadius) — https://www.trustradius.com/products/teamsnap/pricing ; TeamSnap — https://www.teamsnap.com/pricing ; SportsEngine — https://www.capterra.com/p/134125/SportsEngine/pricing
- [S32] Chief Delphi, "Survey: Primary team communications tool" (2025-09-13, 41 posts) — https://www.chiefdelphi.com/t/506280
- [S33] Chief Delphi, "Seeking Robust Multi-Team Communication Platform" (2025-10-08) — https://www.chiefdelphi.com/t/506998
- [S34] Chief Delphi, "Using Google Drive Spreadsheets Scouting without wifi" (pre-2024) — https://www.chiefdelphi.com/t/142130 ; "Paper Scouting Data Input" — https://www.chiefdelphi.com/t/456174
- [S35] Chief Delphi, "A solution to uploading scouting data with bad Wi-Fi" (2026-06-20, 45 posts) — https://www.chiefdelphi.com/t/521988 ; Viper hardware doc — https://github.com/FRCTeam1073-TheForceTeam/viper
- [S36] Thinkscape guides — https://info.firstinspires.org/hubfs/Education_Resources/thinkscape/Thinkscape_Instructions/FTC-FRCTeamThinkscapeDirections.pdf ; FIRST Illinois team info (privacy caveats) — https://www.firstillinoisrobotics.org/ftc/team/
- [S37] FIRST Team Management Resources — https://www.firstinspires.org/resources/library/ftc/team-management-resources ; FTC Docs coach/admin — https://ftc-docs.firstinspires.org/en/latest/persona_pages/coach_admin/coach_admin.html ; Mentor Manual — https://info.firstinspires.org/hubfs/web/program/ftc/ftc-mentor-manual.pdf
- [S38] Project Robotica, FTC Engineering Portfolio — https://projectrobotica.wiki/wiki/FTC:Engineering_Portfolio
- [S39] gm0 LICENSE (CC BY-NC 2.0) — https://github.com/gamemanual0/gm0/blob/main/LICENSE
- [S40] FTC Docs repo (BSD-3-Clause) — https://github.com/FIRST-Tech-Challenge/ftcdocs
- [S41] FTC Docs Terms of Service — https://ftc-docs.firstinspires.org/en/latest/tos/tos.html
- [S42] CTRL ALT FTC — https://github.com/BenCaunt/CTRL-ALT-FTC ; Learn Java for FTC — https://github.com/alan412/LearnJavaForFTC (no LICENSE via GitHub API)
- [S43] Unofficial FTC Discord listing — https://discord.band/server/1443377051305508896 ; invite — https://discord.com/invite/ftc
- [S44] Chief Delphi, "What to do about accountability within team leadership: Mentors and Parents" (2023-09-09, older) — https://www.chiefdelphi.com/t/440702
- [S45] Chief Delphi, "How to improve team culture and FIRST pipeline?" (2026-01-28) — https://www.chiefdelphi.com/t/512971
- [S46] Chief Delphi, "Rethinking our FTC team(s)" (2023-04-11, older) — https://www.chiefdelphi.com/t/433836
- [S47] Chief Delphi, "An FTC Student's Program Retrospective" (2026-05-07, 123 posts) — https://www.chiefdelphi.com/t/520303
- [S48] SDPC National Data Privacy Agreement — https://privacy.a4l.org/national-dpa/
- [S49] Promise Legal, EdTech School District Vendor Agreements — https://blog.promise.legal/edtech-school-district-vendor-agreement/
