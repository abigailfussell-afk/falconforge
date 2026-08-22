# TRAIN — Off-season training & new-member onboarding: research and design proposal

Area: TRAIN · Date: 2026-08-22 · Read-only research; no repo files touched. Repo facts cited by
path. Web facts cited by URL; where a fetch failed or a claim rests on a search snippet I say
so. Everything marked **[unverified]** is something I could not confirm from a primary source.

The plan already lists this as pillar 5, "future" (`FALCONFORGE_V2_PLAN.md:15-17`) and as a
"Later" bullet (`:351-353`). Nothing in the codebase starts it. This document is intended to
let Kevin decide scope and a later agent build a first version.

---

## Part 1 — Research

### 1.1 The FTC technical landscape, 2025–26 season (and what changes in three weeks)

**SDK.** `FIRST-Tech-Challenge/FtcRobotController` is the public SDK. Release history pulled
from the GitHub API (`/repos/.../releases`), not from a search snippet:

| Tag | Published | What it is |
|---|---|---|
| v11.0 | 2025-09-06 | Official DECODE (2025–26) release. OnBot Java gains "projects"; AprilTag library updated for DECODE; OctoQuad firmware 3.x driver. |
| v11.1 | 2026-01-20 | Gamepad triggers as booleans + edge detection; goBILDA Pinpoint v2 support. |
| v11.2 | 2026-07-15 | **Off-season release.** Gradle 9.1 / AGP 8.13.2 → requires **Android Studio Narwhal 3 Feature Drop or later**. New `@Utility` OpMode type; TestHardware utility. |
| v11.2.1 | 2026-07-31 | Tooling-only (Gradle/AGP bump), fixes issue 2099. |

Sources: https://github.com/FIRST-Tech-Challenge/FtcRobotController/releases and the README
changelog (raw.githubusercontent.com/FIRST-Tech-Challenge/FtcRobotController/master/README.md).
Licence: BSD-3-style (FIRST copyright 2014–2022) — sample OpModes are reusable with the notice.

Landscape facts that matter for curriculum design, all from the SDK README changelog:
- Three programming tools: **Blocks**, **OnBot Java** (browser, no Android Studio), **Android
  Studio**. OnBot Java is limited to **Java 1.8** (v10.1.1 notes); Android Studio projects can
  use newer language features, and **Kotlin** is officially documented
  (https://ftc-docs.firstinspires.org/en/latest/programming_resources/shared/installing_kotlin/Installing-Kotlin.html).
- Built into the SDK now: VisionPortal + AprilTag (with `getCurrentGameTagLibrary()`),
  ColorBlobLocator/PredominantColor processors, **Limelight3A driver** (pipelines uploadable
  since v10.2), **goBILDA Pinpoint odometry driver** (since v10.3, v2 since 11.1), OctoQuad,
  SparkFun OTOS, universal IMU interface, full-range servo type, gamepad edge detection.
- The **2026–27 game is BIOBUZZ (FIRST CANOPY theme), kickoff 12 Sept 2026**
  (https://microchipsandqueso.com/2026/05/2026-2027-ftc-game-name/ and regional kickoff pages;
  FIRST's own announcement page not fetched — **[unverified beyond secondary sources]**). A new
  season SDK (presumably v12.0) will land at or just before kickoff; its content is unknown.
  **Curriculum implication:** everything tied to "the current game" has a 12-month shelf life;
  everything tied to the SDK has a ~1-year shelf life for details (annotations, samples) and a
  multi-year shelf life for concepts (OpMode lifecycle, hardware map, run modes).

**Hardware.** REV Control Hub + Driver Hub is the control system (REV DUO docs:
https://docs.revrobotics.com/duo-control — no licence statement on the pages I fetched, treat
as all-rights-reserved). Kits and 2026 prices found: REV DUO FTC Starter Bot ~US$700
[search snippet]; goBILDA FTC Starter Kit 2025–26 US$637.49 for teams, **2026–27 kit
US$899.99** with a drop-centre 6WD chassis + "GripForce Gecko wheel" intake, and a preseason
**StarterBot resource guide** (assembly PDF, example code, STEP files) explicitly marketed
"for programmers to test drive code and for rookie teams to master the fundamentals"
(https://www.gobilda.com/ftc-starter-bot-resource-guide-2026-2027-season/ — example-code
licence not stated). AndyMark Robits Core ~US$950 [snippet]. Chief Delphi thread on Canadian
kit choice gives a 2025 comparison: AndyMark 900 / goBILDA 637 / REV 680 / Studica 640 USD
(https://www.chiefdelphi.com/t/ftc-kit-choices-for-canadian-teams/506554, not fetched —
[snippet only]).

**Libraries** (licence from GitHub API; stars/last push as of 2026-08-22):

| Library | Licence | Stars | Last push | Notes |
|---|---|---|---|---|
| Road Runner (acmerobotics/road-runner) | MIT | 266 | 2025-11 | Motion-profiled trajectories, MeepMeep visualiser; mecanum + tank. |
| Pedro Pathing (Pedro-Pathing/PedroPathing) | BSD-3 | 180 | 2026-06 | Reactive follower, web path visualiser, mecanum + swerve. Dairy Cookbook has a neutral comparison: https://cookbook.dairy.foundation/misc/pedro_vs_roadrunner.html |
| SolversLib (FTC-23511/SolversLib) | BSD-3 | 24 | 2026-08 | "Updated and maintained fork of FTCLib"; command-based (WPILib-style); FTCLib's vision module removed. FTCLib itself is effectively superseded (https://github.com/FTC-23511/SolversLib). |
| FTC Dashboard (acmerobotics/ftc-dashboard) | composite — LICENSE file reproduces the FtcRobotController BSD notice | 212 | 2026-05 | Live telemetry graphs, config tuning, field overlay. |
| EasyOpenCV (OpenFTC) | none reported by API (repo has no LICENSE file the API recognises — **[unverified]**) | 246 | 2024-06 | Superseded for most teams by VisionPortal/Limelight. |

I could not find any quantitative popularity data for Pedro vs Road Runner; the 2025-26
anecdotes (team 24 Karat switching to Pedro; SDK shipping Pinpoint + Limelight drivers)
suggest the modern "default stack" for a competitive team is **Pinpoint odometry + Pedro
Pathing or Road Runner + Limelight3A/AprilTag + FTC Dashboard**, with SolversLib for
command-based structure. Treat that as informed inference, not measurement.

### 1.2 Open educational resources — coverage, licence, gaps

| Resource | Covers | Licence (verified how) | Reuse in a commercial product | Gaps |
|---|---|---|---|---|
| **FTC Docs** ftc-docs.firstinspires.org | Control-system setup, Blocks/OBJ/AS tutorials, hardware config, AprilTag/VisionPortal, colour processing, PIDF tuning, Kotlin, IMU, HuskyLens. Section map: https://ftc-docs.firstinspires.org/en/latest/programming_resources/index.html | **BSD-3-Clause** — `LICENSE` in github.com/FIRST-Tech-Challenge/ftcdocs (fetched raw). | Yes: text and images may be reproduced/adapted with the copyright notice and disclaimer. Trademark "FIRST" still must not imply endorsement. | Reference, not a course: no sequencing, no exercises, no assessment. Mechanical/CAD not covered. |
| **Game Manual 0** gm0.org | The broadest: design (drivetrains, intakes, linear motion, power transmission), build (fasteners, materials), software (SDK, control, odometry), team ops (awards, outreach, engineering notebook). | **CC BY-NC 2.0** — https://gm0.org/en/latest/docs/appendix/license.html and repo `LICENSE`. | **No.** NonCommercial: FalconForge is a paid SaaS, so reproducing or adapting gm0 text/images inside it is outside the licence. **Linking is fine** (a link is not a reproduction). | Deep, written for the self-motivated reader; no hands-on tasks, no checkpoints. |
| **CTRL ALT FTC** ctrlaltftc.com (BenCaunt/CTRL-ALT-FTC) | Control theory: P/PID/feedforward, motion profiles, Kalman, full-state feedback, FTC motor control examples. | **No licence file** (GitHub API `license: null`; README has none). Default = all rights reserved by the author/team 22377. | Link only. Ask the author if text reuse is ever wanted. | Pseudocode only (by design); assumes SDK fluency. Last push 2025-09. |
| **Learn Java for FTC** (Alan G. Smith) | Java from zero through gamepad, motors, servos, sensors, EasyOpenCV; solutions tested against SDK 11.2 (README). | © 2020 Alan G. Smith, free PDF at github.com/alan412/LearnJavaForFTC; **no open licence**. | Link only (to the free PDF and the Amazon paperback). | Android-Studio-first; no assessment; one author's pace. |
| **FIRST Class Pack Curriculum Framework** (2021-22 PDF, fetched and text-extracted) | A classroom scope-and-sequence: Workforce Skills (10h), Building & Programming a Basic Robot (15h), Designing for the Game (5–15h), Machines to Mechanisms (10h), Iteration I/II, Project Sprints & Competition, Sensors/ML/Java, Careers. | © FIRST; no open licence visible. | Use as a structural reference only. | Classroom-oriented (semester, teacher-led); vision unit still mentions Vuforia/TensorFlow (removed from the SDK). |
| **Thinkscape** (FIRST's LMS) | Team-management, building, programming courses; season-specific guidebooks in August. Access requires a FIRST Dashboard login and the coach importing users (https://info.firstinspires.org/hubfs/Education_Resources/thinkscape/Thinkscape_Instructions/FTC-FRCTeamThinkscapeDirections.pdf). | Proprietary; not fetchable without login. **[content not verified]** | Link to it as "FIRST's official courses". | Behind a login; coach must manually provision; nothing ties it to the team's roster or season. Coach-side adoption evidence is absent from every thread I read. |
| **FTC SIM** ftcsim.org | Free browser simulator (FIRST Canada + pixelpad.io): Blocks and OnBot Java, DECODE field challenges, translate Blocks↔Java. | EULA; free. | Link; ideal "no-robot" homework for Programming modules 1–4. | Blocks-centric; not the real SDK build chain. |
| **Code-A-Robot** codearobot.org | Six levels: Java fundamentals → FTC prep → robot control → sensors → auto → TeleOp, browser editor, progress tracking. Independent (J. Kaiserman), "not affiliated with FIRST". | Free tier; licence unstated. | Link. Also the closest thing to a competitor for the programming track. | Programming only; no mentor loop. |
| **REV docs / goBILDA guides** | Hub setup, wiring, sensors; StarterBot assembly + example code. | No licence statements found. | Link. | Vendor-specific. |
| **"Standardized FTC Programming Training Course"** (Blockheads-2/FTCProgrammingTraining, CC BY-NC-SA 4.0) | Advertised as FTC with certificates, but the `content/` tree is a **fork of the USACO Guide** (Bronze/Silver/Gold/Platinum competitive-programming topics: DP, segment trees, FFT). 0 stars, last push 2023-09. | CC BY-NC-SA | Not useful. Worth recording because a search will keep surfacing it. | — |
| YouTube | Many team-made series (e.g. "FTC Programming Tutorial Series" playlist for Android Studio, Limelight/AprilTag tutorials). | Standard YouTube licence unless stated. | Embed = network-only; link out. | Uneven, season-stale. I did not audit individual channels — **[unverified quality]**. |

**Licence bottom line:** the only substantial body of FTC prose that a commercial product may
*reproduce* is **FTC Docs (BSD-3)** and the **SDK samples (BSD)**. gm0 — the best single source
— is **NC**, so it can only be linked. CC BY-SA was in the brief; none of the major FTC
resources actually uses it (see §3.3 for what share-alike would have implied).

### 1.3 How experienced teams actually onboard rookies (evidence)

Chief Delphi is FRC-dominated; I pulled threads via the Discourse JSON API so the quotes are
verbatim. r/FTC blocked automated access (HTML wall) and Discord is not fetchable, so the
FTC-specific evidence is thinner than the FRC evidence — flagged.

| Practice | Evidence |
|---|---|
| **Put a real robot in front of them in the first hour.** "Include a robot… as much as you can"; "people love instant rewards… start with running a motor rather than subsystem and command junk" (gerthworm, crueter, https://www.chiefdelphi.com/t/412299). Paradox 2102's minibot/nerfbot tutorials; bovlb: "the moment a student succeeds in making a robot move… their eyes light up." | 
| **Training bots / rookie robot builds.** 3D-printed FTC training bot with REV sensor clips, printed on an Ender 3 (https://www.chiefdelphi.com/t/466635); goBILDA's preseason StarterBot is sold for exactly this; FRC teams run a "mock build season, ~9 h/week for six weeks" (risho900, https://www.chiefdelphi.com/t/166911). |
| **Lesson + project cadence.** FRC 3538: weekly 4-hour meetings, 2 h lesson + 2 h project, numbered lessons (goal "everybody through lesson 33" before fall) (Allison_K, https://www.chiefdelphi.com/t/150999). |
| **Veterans teach; mentors curate.** "No matter how much you don't want to make your own curriculum, you're going to make your own curriculum… make your veterans make it" (s-neff, /t/166911). The **Lazy Mentor Training System** (FRC 2823, 2014 white paper, https://www.chiefdelphi.com/t/160014) is the canonical "curriculum so mentors can step back"; its author says it was never updated after 2014 and the team moved to more hands-on mentoring when they got more mentors. |
| **Sub-team certification gate.** VAHS FTC handbook: members must "be certified by your team lead in your subteam" to attend competition; team leads own "training of their subteam members" (https://vahs-ftc.github.io/handbook/). |
| **Sub-team tracks.** FRC 1710 lists Build, Programming, Design, Finance, Informatics, Graphics, Outreach, Media (https://www.chiefdelphi.com/t/subteam-recruitment/503104, snippet). FTC handbooks: design/build/software/fundraising. |
| **Scaling.** Virtual (Discord) sessions for concept intros + small in-person hands-on groups; keep ≤10 students per mentor (AllenGregoryIV, cad321, https://www.chiefdelphi.com/t/396300). |
| **Engagement is the failure mode.** "If you don't keep the new recruits engaged, they will drift away before Kickoff" (philso, /t/166911). |
| **Disassemble/reassemble last year's robot** as a first task (UnofficialForth, /t/166911). |
| **FTC-specific training-time reality.** Rookie FTC teams "spend three months learning about programming, electrical wiring and the mechanics" before competing (patch.com local-news snippet, weak). |

What I did **not** find: any FTC team publicly describing badges, quizzes, or an LMS. The
strongest recurring pattern is *checklist + sign-off by a lead + a physical robot*, not
courseware. That should shape the MVP.

### 1.4 Learning-platform patterns and why a team might want it inside FalconForge

Evidence-backed patterns (Dunlosky et al. 2013, *Psychological Science in the Public
Interest*, https://journals.sagepub.com/doi/abs/10.1177/1529100612453266): **practice testing
and distributed practice are the two "high utility" techniques** across ages and materials;
re-reading and highlighting are low utility. So: short low-stakes quizzes after each module
and a later "review" prompt are worth building; long reading pages are not. I found no
effect-size study for badges in extracurricular teen clubs — **[unverified]**; treat badges
as motivation UX, not pedagogy.

Tools teams use today and the gap:

| Tool | Fits | Why a team might prefer FalconForge |
|---|---|---|
| Thinkscape | FIRST-official, free | Separate login, coach provisions users by hand, no link to roster/sub-teams/season; no offline. |
| Google Classroom / Canvas | Schools already have them | School-owned, mentors (non-staff) often cannot be added; community teams have none. |
| Notion / Google Docs checklists | What most teams actually use | Nothing rolls up to a skills matrix; sign-off is a comment; dies with the senior who made it. |
| Code-A-Robot, FTC SIM | Good programming practice | Programming only; progress invisible to the coach. |

The defensible proposition is **not** "better lessons than gm0" (impossible under NC, and
unnecessary). It is: *the roster already lives here; the sub-teams already live here; the
coach wants one view of who can do what before staffing sub-teams at kickoff; and it has to
work in a school basement with no WiFi.* That is a team-operations feature, which is what
FalconForge is.

---

## Part 2 — Design proposal

### 2.1 Curriculum outline

Conventions: **Prereq** refers to module ids. **Link** = existing open resource to point at
(never embedded unless BSD). **Author** = must be written originally (objective, hands-on task,
checkpoint, quiz). Minutes are learner time excluding the hands-on build. **GA** = game-agnostic,
**GS** = game-specific (must be revised yearly), **SDK** = SDK-version-sensitive (review yearly).

#### Track A — Onboarding to FTC and the team (GA unless marked)

| Id | Module | Objective | Prereq | Hands-on task | Checkpoint | Min | Link vs author |
|---|---|---|---|---|---|---|---|
| A1 | What FTC is | Explain the season arc (kickoff → qualifiers → championships), match structure (auto/TeleOp/endgame), alliances. | — | Watch one match video of last year's game; write 3 sentences on what scored. | Quiz (5 q). | 30 | Link: FIRST "get started" page; author quiz. |
| A2 | This team | Name roles, sub-teams, meeting cadence, how decisions are made. | A1 | Read the team handbook; find your sub-team on the roster. | Coach sign-off (conversation). | 20 | **Team-authored** (template provided). |
| A3 | Gracious Professionalism and Youth Protection | State GP/Coopertition; know who the adults are and the YPP basics. | — | — | Quiz. | 15 | Link: FIRST Mentor Manual; author quiz. |
| A4 | How a match is scored (GS) | Read this year's scoring summary. | A1 | Score a recorded match by hand. | Mentor checks your sheet vs the official score. | 40 | Link: game manual; author task each season. |
| A5 | The engineering notebook/portfolio | Explain what judges look for; make a first entry. | A2 | Write one dated entry on a task you did. | Mentor sign-off. | 30 | Link: FTC Docs awards/portfolio pages; author. |
| A6 | Tools of the team | Use the team's repo/Drive/FalconForge board; raise a task. | A2 | Create a task on the sprint board. | Auto: task exists. | 15 | Author (FalconForge-specific). |
| A7 | Agile in one page | Explain sprint, backlog, stand-up, retro as the team uses them. | A6 | Join one stand-up; move your task. | Coach sign-off. | 20 | Author (ties to pillar 2 "teaches agile"). |

#### Track B — Safety (GA)

| Id | Module | Objective | Prereq | Hands-on task | Checkpoint | Min | Link vs author |
|---|---|---|---|---|---|---|---|
| B1 | Shop safety basics | Eye protection, long hair/jewellery, who may use which tools. | — | Walk the shop with a mentor; locate first-aid and cut-off switch. | **Mentor sign-off required before any build module.** | 20 | Author; team may add rules. |
| B2 | Battery and electrical safety | Handle LiPo/NiMH/SLA packs, fusing, never short a battery, charger rules. | B1 | Inspect a battery and charger; log condition. | Mentor sign-off. | 20 | Link: REV battery docs; author. |
| B3 | Power tools | Drill, band saw/chop saw, Dremel as the team has. | B1 | Supervised cut and drill on scrap. | Mentor sign-off **per tool**. | 45 | Author (checklist per tool). |
| B4 | Robot handling at events | Pit etiquette, lifting, disabling the robot. | B1 | — | Quiz. | 10 | Author. |

#### Track C — Mechanical (GA)

| Id | Module | Objective | Prereq | Hands-on task | Checkpoint | Min | Link vs author |
|---|---|---|---|---|---|---|---|
| C1 | Kit anatomy | Identify channel, extrusion, hubs, bearings, shafts, motors, servos in your kit (REV/goBILDA/AndyMark variants). | B1 | Sort a parts bin and label it. | Mentor sign-off. | 45 | Link: vendor docs; author task per kit. |
| C2 | Fasteners and joints | M3/M4 vs #6-32/#8-32, nyloc vs thread-locker, torque, why things loosen. | C1 | Assemble a rigid 4-bar frame square to ±1 mm. | Mentor measures squareness. | 60 | Link: gm0 fasteners (link only, NC); author. |
| C3 | Drivetrains | Tank, mecanum, X-drive, swerve: trade-offs; wheel/gear ratio maths. | C2 | Calculate speed and push force for two ratios. | Quiz with numeric answers. | 45 | Link: gm0 drivetrains; author calculation sheet. |
| C4 | Build the rookie drivetrain | Assemble a kit chassis with a mentor. | C3 | Complete drivetrain, drives straight under TeleOp. | Mentor sign-off: drives 3 m straight within 10 cm. | 180+ | Link: goBILDA/REV StarterBot assembly PDFs; author acceptance test. |
| C5 | Power transmission | Gears, chain, belts, gearboxes; backlash; ratios. | C3 | Build a 3:1 gear reduction driving a wheel. | Mentor sign-off. | 60 | Link: gm0; author. |
| C6 | Intakes and manipulators | Compliant wheels, claws, rollers; grip vs speed. | C5 | Prototype an intake for last year's game piece from cardboard/kit parts. | Mentor sign-off + notebook entry. | 120 | Link: gm0 intakes; author. |
| C7 | Linear motion | Slides (MGN, Misumi, kit), cascading vs continuous rigging, string tension. | C5 | Rig a 2-stage slide that extends and returns 20 cycles. | Mentor sign-off. | 120 | Link: gm0 linear motion; author. |
| C8 | Arms, linkages and pivots | 4-bar, virtual 4-bar, torque at the joint, counterbalance. | C5 | Compute motor torque for a 300 mm arm holding 200 g. | Quiz (numeric). | 45 | Author. |
| C9 | CAD in Onshape | Create a part, an assembly, mate a motor to a plate; use vendor part libraries. | C1 | Model the C4 drivetrain; export a drawing. | Mentor review of the assembly. | 180 | Link: Onshape learning centre, goBILDA/REV Onshape libraries; author checklist. |
| C10 | Prototyping and iteration | Cardboard → wood → kit; the design-review loop; notebook evidence. | C6 | Two iterations of the same mechanism with measured improvement. | Mentor sign-off. | 90 | Author. |

#### Track D — Electrical / control system (GA, SDK-sensitive where marked)

| Id | Module | Objective | Prereq | Hands-on task | Checkpoint | Min | Link vs author |
|---|---|---|---|---|---|---|---|
| D1 | Control Hub, Expansion Hub, Driver Hub | Ports, what talks to what, Wi-Fi, the REV Hardware Client. | B2 | Connect DS to RC; rename the hub; update firmware. | Mentor sign-off. | 45 | Link: REV DUO docs, FTC Docs control-system pages (BSD, may embed). |
| D2 | Wiring and connectors | XT30/JST-PH/VH, polarity, strain relief, wire gauge, fusing. | D1 | Wire two motors and one servo to spec; cable-tie; pass a tug test. | Mentor inspection checklist. | 60 | Author. |
| D3 | Motors and encoders | DC motor families, gearbox ratios, encoder counts/rev, stall. | D2 | Read encoder ticks while turning a shaft by hand. | Quiz + screenshot of telemetry. | 45 | Link: FTC Docs; author. |
| D4 | Servos | Standard vs continuous, range, programmer tool, full-range servo type (SDK 10.3+). | D2 | Set a servo to 3 positions with a test OpMode. | Mentor sign-off. | 30 | Link: FTC Docs; author. |
| D5 | Sensors | Touch, distance (2 m), colour/RGB, IMU, magnetic limit. | D3 | Wire and read each sensor in telemetry. | Quiz identifies the right sensor for 5 tasks. | 60 | Link: FTC Docs sensor pages; author. |
| D6 | Hardware configuration (SDK) | Build a config file; naming conventions; why names must match code. | D1 | Configure the rookie robot; export the config. | Auto-check impossible; mentor sign-off. | 30 | Link: FTC Docs hardware config. |
| D7 | Odometry hardware | Dead wheels, Pinpoint, OTOS; where to mount and why. | D5 | Mount a Pinpoint and read pose. | Mentor sign-off. | 60 | Link: goBILDA Pinpoint docs; author. |
| D8 | Troubleshooting | The DS log, "can't find hardware", brownouts, ESD. | D6 | Diagnose three mentor-planted faults on the rookie robot. | Mentor sign-off (all three found). | 60 | Author (fault list). |

#### Track E — Programming (SDK-sensitive throughout)

| Id | Module | Objective | Prereq | Hands-on task | Checkpoint | Min | Link vs author |
|---|---|---|---|---|---|---|---|
| E1 | Choose a tool | Blocks vs OnBot Java vs Android Studio; when each is right. | A1 | Install/open the one your team uses. | Self-check. | 20 | Link: FTC Docs "Choosing a programming tool" (BSD). |
| E2 | Java basics I | Variables, types, `if`, loops, methods. | — | 10 exercises in FTC SIM or Code-A-Robot; or Learn Java for FTC ch. 1–4. | Quiz (10 q). | 120 | Link: Learn Java for FTC PDF, Code-A-Robot, FTC SIM; author quiz. |
| E3 | Java basics II | Classes, objects, fields, `this`, enums, basic collections. | E2 | Write a `Scoreboard` class in a plain Java file. | Mentor code review. | 120 | Link as E2; author. |
| E4 | OpMode lifecycle | `LinearOpMode` vs iterative `OpMode`; `init`/`start`/`loop`/`stop`; `@TeleOp`/`@Autonomous`/`@Utility` (11.2). | E3, D6 | Write an OpMode that prints telemetry every loop and stops cleanly. | Auto-style: mentor sees it on the DS. | 60 | Link: FTC Docs OnBot Java tutorial; SDK samples (BSD, may embed snippets). |
| E5 | Hardware map and motors | `hardwareMap.get`, `DcMotor`, directions, run modes, zero-power behaviour. | E4, D3 | Drive one motor from a gamepad stick; reverse one side. | Mentor sign-off. | 60 | SDK samples; author. |
| E6 | TeleOp drive | Tank and mecanum mixing; deadband; slow mode; edge detection (11.1). | E5 | Drive the rookie robot through a cone course. | Mentor sign-off: course in <60 s. | 90 | SDK sample `BasicOmniOpMode`; author. |
| E7 | Servos and mechanisms in code | Servo positions, state machines for a mechanism. | E5, D4 | Claw open/close on buttons with a state enum. | Mentor code review. | 60 | Author. |
| E8 | Sensors in code | Distance, colour, touch, IMU heading. | E5, D5 | Stop 10 cm from a wall; turn to heading with IMU. | Mentor sign-off. | 90 | SDK samples; author. |
| E9 | Encoders and `RUN_TO_POSITION` | Ticks → distance; why time-based auto is bad. | E8 | Drive exactly 1 m three times; measure error. | Measured: ±3 cm. | 60 | Author. |
| E10 | Autonomous I | Sequence of moves with encoders + IMU; timeouts; `opModeIsActive()`. | E9 | Auto that leaves the start tile and parks. | Mentor sign-off on field. | 120 | Author. |
| E11 | PID and feedforward | P, then PI/PD, then FF; tuning by eye and by graph. | E9 | Hold an arm at a setpoint under load with P then PID. | Graph on FTC Dashboard + mentor review. | 120 | Link: CTRL ALT FTC (link only), FTC Docs PIDF page (BSD). Author task. |
| E12 | Odometry and path following | Pose, localisation drift, Pinpoint; Road Runner vs Pedro Pathing; tuning. | E11, D7 | Tune a follower; drive a 3-segment path with <5 cm error. | Mentor sign-off with measurement. | 240 | Link: library docs, Dairy Cookbook comparison; author. |
| E13 | Vision: AprilTags and colour | VisionPortal, AprilTag pose, Limelight3A pipelines, colour blob. | E8 | Read tag pose; align to a tag. | Mentor sign-off. | 120 | Link: FTC Docs AprilTag (BSD, may embed); author. |
| E14 | Telemetry, Dashboard and logging | Telemetry API, FTC Dashboard graphs/config, reading logs. | E5 | Graph a motor velocity live. | Screenshot. | 45 | Link: ftc-dashboard docs; author. |
| E15 | Code structure and git | Subsystem classes, command-based (SolversLib) optional; branches, PRs, code review. | E7 | Open a PR that adds a subsystem; get it reviewed. | Mentor review merged. | 90 | Author. |
| E16 | Kotlin (optional) | Why/when; the Gradle change. | E15 | Port one OpMode. | Mentor review. | 60 | Link: FTC Docs Kotlin page (BSD). |

#### Track F — Strategy and scouting (GS-heavy)

| Id | Module | Objective | Prereq | Hands-on task | Checkpoint | Min | Link vs author |
|---|---|---|---|---|---|---|---|
| F1 | Reading the game manual (GS) | Find rules, scoring, penalties; the Q&A system. | A4 | Answer 10 rule questions from the manual. | Quiz (regenerated yearly). | 60 | Author yearly. |
| F2 | Scoring maths (GS) | Max theoretical scores by phase; what a 2-robot alliance can do. | F1 | Build a scoring spreadsheet. | Mentor review. | 60 | Author yearly. |
| F3 | Scouting in FalconForge | Record a match in Scouting; what fields matter. | F2 | Scout 3 matches from video. | Auto: 3 reports exist. | 45 | Author (app-specific). |
| F4 | Alliance selection and match planning | Use OPR-ish reasoning; pick lists; the Match Planner. | F3 | Draft a pick list from last year's event data. | Coach review. | 60 | Author; link ftcscout.org. |
| F5 | Drive team roles | Driver, operator, coach, human player; comms; pre-match checklist. | F3 | Run a mock pre-match checklist. | Coach sign-off. | 30 | Author (ties to checklists). |

#### Track G — Outreach, media, portfolio, judging (GA)

| Id | Module | Objective | Prereq | Hands-on task | Checkpoint | Min | Link vs author |
|---|---|---|---|---|---|---|---|
| G1 | Awards landscape | Inspire, Think, Connect, Innovate, Control, Motivate, Design; what evidence each needs. | A5 | Map last season's activities to awards. | Quiz. | 40 | Link: FTC Docs awards; author. |
| G2 | The engineering portfolio | Structure, page budget, what judges skim. | G1 | Draft one portfolio page. | Mentor review. | 90 | Author. |
| G3 | Judging interview | The 5-minute presentation; answering questions; everyone speaks. | G2 | Mock interview recorded. | Coach sign-off. | 60 | Author. |
| G4 | Outreach planning | Events, partners, logging hours and impact. | A2 | Plan one outreach event with a budget. | Coach review. | 60 | Author. |
| G5 | Media basics | Photos/video at events, consent, social posts, brand kit. | A3 | Produce a 30-second recap video. | Coach review. | 90 | Author. |
| G6 | Sponsorship | The ask, the packet, follow-up. | G4 | Draft a sponsor letter. | Coach review. | 60 | Author. |

#### Track H — Team operations and agile (GA)

| Id | Module | Objective | Prereq | Hands-on task | Checkpoint | Min | Link vs author |
|---|---|---|---|---|---|---|---|
| H1 | Running a sprint | Planning, daily stand-up, review, retro, with the FalconForge board. | A7 | Facilitate one stand-up. | Coach sign-off. | 45 | Author. |
| H2 | Estimating and cutting scope | Story points vs hours; why teams over-commit before a qualifier. | H1 | Re-estimate a past sprint. | Coach review. | 45 | Author. |
| H3 | Meetings and attendance | Attendance norms; the Meetings feature. | A2 | Attest attendance for a week. | Auto. | 15 | Author. |
| H4 | Leading a sub-team | Onboarding the next rookie; the sign-off duty. | H1 + one full track | Sign off a rookie on a module you hold. | Coach sign-off. | 60 | Author. |
| H5 | Season rollover and handover | What "fresh start" means; archiving; who keeps what. | H4 | Write a handover note. | Coach review. | 30 | Author. |

Totals: **65 modules**, ~46 requiring original authoring of at least the task/checkpoint, 5
explicitly team-authored, ~8 that are "just a link plus a quiz". GS modules: A4, F1, F2 (+ the
task in C6). Learner time ≈ 60 h across all tracks; a rookie takes one or two tracks (~15–20 h),
which matches the "three months before competing" and the 2h+2h weekly cadence found in §1.3.

### 2.2 Product model — how it fits the existing app

#### Entities

| Entity | Scope | Where it lives | Notes |
|---|---|---|---|
| `curriculum` | platform (operator) **or** team | Core: **in the repo** (see §2.3). Team-specific: DB row `curricula(id, team_id, name, …)` | FTC core ships with the app; an FRC core later is a second repo folder, not a schema change. |
| `module` | as curriculum | Core: repo markdown/JSON. Team: `modules(id, team_id, curriculum_id, track, title, objective, body_md, prereq_ids[], minutes, kind)` | `kind ∈ {lesson, task, quiz, checkpoint}`. Team modules extend, never edit, core modules. |
| `checkpoint` | part of module | Core: in the module file. Team: `module.checkpoints jsonb` | `{id, label, verifier: 'self'|'mentor'|'coach'|'auto', measure?}`. |
| `skill` | platform | Repo | A named competency a checkpoint grants (`drive-wiring`, `teleop-mecanum`). The skills matrix is keyed on skills, not modules, so curricula can be revised without resetting people. |
| `member_progress` | **person-in-team** | DB, synced entity | `(id, team_id, team_member_id, module_id, status, self_marked_at, quiz_score, updated_at)`. **Not season-scoped** (see below). |
| `skill_signoff` | person-in-team | DB, synced entity | `(id, team_id, team_member_id, skill_id, checkpoint_id, signed_by_member_id, signed_at, note, revoked_at)`. Append-only with revocation, so a sign-off is auditable. |
| `badge` | derived | computed client-side from sign-offs | Phase 2. No table until a badge needs to be awarded manually. |

**Why person-in-team rather than person.** Principle 5 says season data is a fresh start; skills
are not season data — they are properties of a person. The existing schema already has the
right anchor: `team_members` is team-scoped but **not** season-scoped
(`supabase/migrations/20260816000000_v2_tables.sql:122-165`) and survives rollover, while
`sub_teams` *is* season-scoped (`:265-278`). So progress and sign-offs hang off
`team_members.id` (with the existing `UNIQUE (id, team_id)` composite for the FK, matching the
`tasks` assignee pattern) and persist across seasons with no special casing. A managed
(under-13) profile is a `team_members` row too, so guardian-owned children get progress the
same way. Cross-team portability ("I moved teams and my badges came with me") is **deferred**:
it would need a person-scoped entity outside the tenant, and RLS scope `'guardian'` shows how
much work the first non-team scope cost (plan §8, Sprint 9 entry). Record it, don't build it.

**Tenancy/RLS.** Both new tables are plain `team`-scoped entities: `team_id NOT NULL`, composite
FK `(team_member_id, team_id) → team_members(id, team_id)`, SELECT for members, INSERT/UPDATE
of `member_progress` by the member themselves (or the guardian login for a managed row),
`skill_signoff` INSERT restricted to `role IN ('admin','coach','mentor')` via the existing
capability-function pattern (plan §Sprint 3). Cross-tenant test in the same migration, as
principle 4 requires. No `season_is_open()` in these policies — and that is the first table
family since Sprint 4 to be writable while the team has no open season, so the "terminal
refusal" classification in the sync drain (B24, plan Sprint 6 entry) must not treat a 42501 on
these tables as "archived season". Flagged as TRAIN-02 below.

#### Roles

| Role | Can |
|---|---|
| Operator (Kevin) | Ship/revise core curriculum by releasing the app. |
| Admin / coach | Create team modules and team checkpoints; sign off anything; see the skills matrix; assign a track to a member. |
| Mentor | Sign off checkpoints (per skill; a team may restrict "who can sign B3 power tools" — Phase 2). |
| Student | Read, self-mark, take quizzes, request a sign-off. |
| Guardian (managed profile) | Same as student on behalf of the child; cannot sign off. |

The sub-team "certification gate" from §1.3 becomes optional configuration: a sub-team can
declare required skills (Phase 2), and the roster shows who is cleared.

#### Roster, sub-teams and the skills matrix

A **Skills matrix** view (coach+): rows = approved members, columns = skills grouped by track,
cells = none / self-marked / signed-off (by whom, when). Filters by sub-team and by track.
That is the staffing tool: at kickoff the coach sorts by "Programming skills held" and drags
into sub-teams in `SubTeamManager`. Each member's profile card gets a compact "skills held"
strip (reuses the roster card, one implementation, principle 9).

#### Off-season mode

Today "no current season" disables creation everywhere (`src/lib/season-scope.ts` `canEdit`
is false with no season; `SprintPlanning.tsx:70` notes a task cannot exist without one).
Training must be the exception: the Training route reads entitlement, not season scope, and
`navViewsFor` (`src/lib/navigation.ts`) lists it without a season precondition. Concretely:
DashboardHome shows a "Summer training" tile when the latest season is archived or none
exists. Nothing about seasons needs to change.

#### Offline

- **Core content is part of the bundle.** Markdown compiled at build time into lazy-loaded
  lazy-loaded chunks per track. The existing precache glob (`vite.config.ts:79`) is
  `**/*.{js,css,html,ico,png,svg,woff,woff2}` — no `json` — so import the compiled content as
  ES modules (they become `.js` chunks and are precached with no config change) rather than
  emitting `.json` assets. Current precache is ~4.7 MiB (plan Sprint 1 entry) and
  `dist/` is 5.2 MB. **Budget: +2 MB for 65 modules** — text at ~3 KB/module is 200 KB; the
  rest is images. Rule: WebP, ≤80 KB each, ≤3 per module, no hosted video. Anything heavier is
  a link that opens online (YouTube, vendor PDFs), shown with an "online" chip when
  `navigator.onLine` is false.
- **Team-authored modules** are DB rows through the registry (`toRemote`/`fromRemote`,
  round-trip test), so they pull with `fetchTeamData` and are editable offline like tasks.
- Progress/sign-offs are ordinary queued writes; the sign-off made in a basement syncs later.
  Conflict rule: sign-off rows are append-only so there is nothing to merge; `member_progress`
  is last-write-wins per (member, module), which is acceptable because only the member (or
  their guardian) writes it.

### 2.3 Content strategy

**Authoring format: markdown in the repo, not DB rows, for core content.** Reasons: it ships
with the build (offline for free), it is reviewed in a PR like code, it is versioned by git
and by app release, and an FRC folder is a copy with a different `program:` front-matter.
Front-matter per module: `id, track, title, program: ftc, objective, prereqs, minutes,
skills, shelf_life: ga|gs|sdk, reviewed_for: sdk-11.2 / game-decode, links: [{url, licence}]`.
A build-time test asserts every module has those fields, every prereq exists, every link has
a licence tag, and no module body exceeds the image budget — the same shape as
`harness-invariants.test.ts` (principle 7) and cheap to keep honest. Team modules are DB rows
with a `body_md` column rendered by the same renderer (one implementation). Translations:
later, as sibling files (`E5.es.md`); not designed further.

**Versioning a skill when the module changes.** Module files carry a `version`; a sign-off
records `module_version`. The matrix shows a stale sign-off as held-but-dated, never revoked
automatically. Curriculum changes must never delete progress (it is the person's record).

**Licensing, precisely.**
- **BSD-3 (FTC Docs, SDK samples):** may copy and adapt text, images and code into the app,
  provided the copyright notice, conditions and disclaimer are reproduced (an "Attributions"
  page in-app satisfies this) and FIRST's name is not used to endorse the product.
- **CC BY-NC 2.0 (gm0):** may **not** be reproduced or adapted in a paid product at all, not
  even with attribution. Link out. Short quotations for commentary are fair use in the US but
  it is not worth the argument — paraphrase from primary sources instead.
- **CC BY-SA (none of the major sources, but the brief asked):** reproducing or adapting
  BY-SA text would require the *adapted module* to be BY-SA too — i.e. Kevin's own words in
  that module become freely reusable by anyone, including competitors. It does **not**
  touch the app's code or other modules (SA attaches to the derivative work, not the
  container), and linking incurs nothing. Quoting ≤ a paragraph with attribution is
  generally treated as permitted use, not adaptation, but mixing BY-SA prose into a module
  makes the whole module's licence status arguable. Policy: *no BY-SA or NC prose inside
  module bodies; links only; BSD is the only text that may be copied.*
- **All-rights-reserved (CTRL ALT FTC, Learn Java for FTC, REV/goBILDA docs, YouTube):** link
  only. A future "ask the author" for CTRL ALT FTC is worth one email.
- Trademarks: "FIRST", "FTC", "DECODE", "BIOBUZZ" are FIRST marks; descriptive use is fine,
  a "not affiliated with FIRST" line (as Code-A-Robot does) belongs in the footer.

**Authoring effort (honest).** Per module, including writing, building the hands-on task on
real hardware once, the checkpoint rubric, a 5–10 question quiz, images, and a review pass:

| Module kind | Hours |
|---|---|
| Link-out + objective + checkpoint + quiz (no original lesson body) | 1.5–2.5 |
| Original lesson (1,500–2,500 words) + task + quiz + 2–3 images | 6–10 |
| Above plus a hardware-validated task (C4, D8, E6–E13) | +3–5 |
| Game-specific module, per season refresh (A4, F1, F2) | 2–3 each, yearly |
| SDK refresh pass across Track E each September | 8–15, yearly |

So: **Phase 1 (all 65 as link-out + checkpoints): ~110–150 h.** Full original lessons for
Tracks D and E (24 modules, the ones where the open resources are thinnest as *courses*):
~200–300 h. Everything original: 500 h+. These are solo-author hours; a veteran-student
contributor model (what §1.3 says every team ends up doing) could halve Kevin's share at the
cost of review time.

**Seeding fastest:** ship the skills/checkpoint skeleton with links first. That is what the
evidence says teams actually use (checklist + lead sign-off), it is licence-safe, and it
creates the matrix data immediately. Write original lessons only for modules where the
matrix shows rookies stalling.

### 2.4 Marketability

Is training a differentiator that gets a team to pay? Evidence, both directions:

- **Against content as the value:** gm0, FTC Docs, Thinkscape, FTC SIM and Code-A-Robot are
  free and good. Nobody in the threads I read described paying for courseware; the one paid
  FTC offering I found is Innov8rz's US$50 video classes (page 403'd — **[snippet only]**), and
  CMU's US$599 fee is for teacher PD, not teams. Trying to out-write gm0 is a content business
  Kevin does not want to be in, and NC forbids repackaging it.
- **For the team-side tooling as the value:** teams demonstrably (a) make their own checklists
  every year and lose them when seniors graduate, (b) gate competition attendance on
  sub-team certification, (c) have a coach deciding sub-team staffing at kickoff with no data,
  and (d) already pay FalconForge per seat for roster/sub-teams. A skills matrix on the roster
  they already maintain is a retention feature and a "why the whole team needs seats" feature
  (students want their own progress; sign-offs need the mentor seat). It is also the only
  feature that gives the product something to do **June–August**, when a season-centric app
  is otherwise idle and churn-prone.
- **What I could not verify:** willingness-to-pay numbers, or any FTC-specific LMS adoption
  data. Recommend validating with the beta teams' coaches with one question: "Show me how you
  decided who went on the programming sub-team last year."

Verdict: training is a **retention and seat-count** lever, not an acquisition hook, and the
sellable part is the matrix/sign-off/off-season tooling, not lessons. Price it into the seat,
do not sell it separately.

### 2.5 Phasing

| Phase | Scope | Effort |
|---|---|---|
| **1 — Skills skeleton (one sprint, MVP)** | Repo-shipped FTC curriculum as link-outs + objectives + checkpoints + 5-q quizzes for all tracks (content can land incrementally — the *schema and UI* are the sprint); `member_progress` + `skill_signoff` tables with RLS and isolation tests, registry entries, offline writes; Training route usable with no open season; member view (tracks → modules → "mark done / request sign-off"); mentor sign-off flow (from the member's card and from a "pending requests" list); coach **skills matrix** filtered by sub-team; attributions page. No badges, no team authoring, no images beyond a few. | **L** (a sprint) for the app; content ~40 h in parallel for the first two tracks (A, E), the rest trickling. |
| **2 — Authored content + team modules** | Original lessons for D and E; team-authored modules/checkpoints (DB entity, simple markdown editor); per-skill sign-off permissions (who may sign power tools); sub-team required-skills and "cleared" indicator on the roster; badges derived from skill sets; quiz retry + spaced "review this" prompt (Dunlosky); game-specific module refresh workflow each September. | **L** app + ~250 h content. |
| **3 — Platform** | Cross-team portable skills (person-scoped entity); certificates (PDF, client-generated like the Sprint 11 export); FRC curriculum folder and `program:` switch; translations; analytics for the operator ("which modules stall"); optional AI tutor later, only per `docs/ai-features-reference.md`. | **M–L** each, independent. |

---

## Findings

### TRAIN-01 — No place in the app for team-scoped, season-free data
- **Severity:** Medium
- **Type:** unfinished
- **Status vs plan:** NEW (plan §1 item 5 names the feature; nothing names this constraint)
- **Evidence:** `src/lib/season-scope.ts:55-60` (`canEdit` false with no season);
  `supabase/migrations/20260817000000_v2_season_lifecycle.sql:58,91` (`season_is_open()` in
  every season-scoped write policy); `supabase/migrations/20260816000000_v2_tables.sql:122-165`
  (`team_members` is the only team-scoped, non-season, non-pull-only table — and it is
  pull-only, `src/lib/entity-registry.ts:334-346`). Every client-writable entity is season-scoped.
- **Repro / how observed:** Read the schema and registry; there is no existing pattern for a
  client-writable table that is team-scoped but survives seasons.
- **Impact:** Training progress must persist across seasons (principle 5 is about season data,
  not people). The first implementer will either wrongly add `season_id` to progress (resets
  skills at rollover) or copy a season policy with `season_is_open()` in it (blocks off-season
  training entirely).
- **Fix direction:** Add the two tables as `team`-scoped entities keyed on `team_members.id`
  with the composite FK, write policies that consult role capability functions only, and add a
  schema assertion that no training table references `seasons`. Make the Training nav entry
  independent of `currentSeasonId`.
- **Effort:** S (as part of Phase 1)

### TRAIN-02 — Sync drain's "terminal refusal" classification assumes every 42501 is a season or licence problem
- **Severity:** Medium
- **Type:** debt
- **Status vs plan:** KNOWN-but-worse (plan Sprint 6 entry: "a policy refusal is terminal only when local state already explains it")
- **Evidence:** `src/lib/sync-failure-classification.ts` (classification exists); plan §8
  Sprint 6 row describes the rule as read-only team or archived season.
- **Repro / how observed:** Reading; not executed.
- **Impact:** A student's self-mark refused for a reason the classifier cannot explain (e.g.
  membership removed mid-summer) will retry rather than dead-letter — acceptable — but a
  mentor sign-off refused because the signer lost the mentor role must become user-visible,
  and today nothing models "role changed" as a terminal cause.
- **Fix direction:** Extend the classification with a "capability refused" cause keyed on the
  local `role` for `skill_signoff` inserts; regression test that a sign-off queued as mentor
  and drained after demotion surfaces in the retry UI rather than looping.
- **Effort:** S

### TRAIN-03 — Licence exposure if an implementer "embeds gm0"
- **Severity:** High (if it happens; it is the obvious shortcut)
- **Type:** security (legal)
- **Status vs plan:** NEW
- **Evidence:** gm0 licence page: CC BY-NC 2.0 (https://gm0.org/en/latest/docs/appendix/license.html).
  FalconForge is a paid product (`FALCONFORGE_V2_PLAN.md` §2).
- **Repro / how observed:** Research.
- **Impact:** Copying any gm0 prose or diagram into module bodies is a licence breach the
  moment billing starts.
- **Fix direction:** The curriculum build-time test requires a `licence` tag on every link and
  forbids `gm0.org` or `ctrlaltftc.com` URLs inside module *bodies* except in a `links:`
  front-matter list; CONTRIBUTING note in the curriculum folder states the BSD-only rule.
- **Effort:** S

---

## Summary

- The FTC stack for 2025–26 is SDK **v11.x** (v11.2.1 current, Android Studio Narwhal 3
  required; OnBot Java = Java 1.8; Kotlin official). A new SDK and a new game (**BIOBUZZ**,
  kickoff **12 Sept 2026**) land in three weeks, so ~5 modules are game-specific and Track E
  needs a yearly SDK pass.
- The only substantial open text a paid product may *copy* is **FTC Docs and the SDK samples
  (BSD-3)**. **gm0 is CC BY-NC — link only.** CTRL ALT FTC and *Learn Java for FTC* have no
  open licence — link only. None of the major sources is BY-SA.
- Experienced teams onboard with **a real robot in the first hour, a weekly lesson + project
  cadence, a written checklist, and a team-lead sign-off that gates competition attendance**.
  Nobody I found uses badges, quizzes or an LMS; Thinkscape exists and is unmentioned.
- Pedagogy worth building: practice testing (short quizzes) and distributed practice (a later
  review prompt) — Dunlosky 2013 "high utility". Badges: motivation UX, unproven.
- The sellable thing is **not lessons** but the **skills matrix + mentor sign-off + off-season
  mode**, sitting on the roster and sub-teams teams already pay for. It fills the June–August
  hole in a season-centric product. I could not find willingness-to-pay data; ask beta coaches.
- Curriculum: **8 tracks, 65 modules, ~60 learner-hours** in §2.1 with prerequisites,
  tasks, checkpoints, minutes and link-vs-author per module.
- Skills are **per person-in-team, not per season**: hang `member_progress` and
  `skill_signoff` off `team_members.id`, which already survives rollover. Core content is
  **markdown in the repo**, shipped in the bundle (offline, +~2 MB budget, no hosted video);
  team modules are DB rows through the registry.
- Real cost: **Phase 1 ≈ one sprint of app work + 110–150 h of link-out/checkpoint authoring**;
  original lessons for the electrical and programming tracks another 200–300 h.
- Three findings: no existing pattern for team-scoped season-free writable data (TRAIN-01),
  drain classification needs a "capability refused" cause (TRAIN-02), and a build-time guard
  against embedding NC content (TRAIN-03).

## Confidence / not checked

- **Not verified from primary sources:** the BIOBUZZ name/kickoff date (secondary pages only);
  kit prices (search snippets); Innov8rz pricing (403); Thinkscape's current course list (login
  wall); EasyOpenCV's licence (API returned none); YouTube series quality (not audited).
- **r/FTC and the FTC Discord were not reachable** (Reddit served an HTML wall; Discord is
  not fetchable). The onboarding evidence is therefore mostly Chief Delphi and FRC-flavoured;
  the FTC-specific items are the VAHS handbook, the FTC training-bot thread, goBILDA's
  preseason StarterBot marketing, and the "Java training for rookies" thread.
- **No quantitative library-popularity data** for Pedro vs Road Runner vs SolversLib; the
  "default stack" in §1.1 is inference.
- **No willingness-to-pay evidence** for training inside a team-ops SaaS; §2.4 is reasoning
  from behaviour, and says so.
- **Effort estimates** are judgement; the per-module hours are ranges, not measurements.
- I did not run the app or the local stack (not needed for this area) and touched no repo
  files. Scratch files (Chief Delphi JSON dumps, extracted PDF text) are under `$S`.
