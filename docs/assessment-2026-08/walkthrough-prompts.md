# Walkthrough agent prompts (to re-run if the scratchpad reports are missing)

Both agents read `agent-brief.md` first (ground rules, finding format, local-stack facts, seeded accounts).

## WALK-A — core roles (Iron Falcons: reviewer@ admin, iron-student0@, mentor@, successor@)
Headless Playwright at 1280×800 and 375×812 against http://localhost:5189. Cover: every sidebar route
deep-linked + reload + back; sprint planner end to end (create/edit/assign/status/comment/archive, list,
calendar, filters); scouting CRUD + filters; match planner draw/save/reopen persistence + field image at 375px;
checklist tick/save template/reset/season scope; meetings one-off + recurring + QR check-in + override + reports;
roster approve/role change/remove/sub-teams/invite rotate; seasons create/switch/archived read-only/rollover;
admin settings, nominate admin, licence panel, attestation prompts, "I've turned 18", sign out/in; offline
(`context.setOffline`) create task+report+checklist tick then reconnect and confirm via psql; two-context
same-task edit; 375px geometry checks (scrollWidth, tap targets <40px, clipped text, modals > viewport);
axe-core if present; brand-new team empty states via Inbucket confirmation; adversarial inputs.
Also confirm FEAT-01/02/05 from features-and-game-coupling.md.

## WALK-B — funnel, licensing, guardian, operator (full@, lapsed@, expiring@, stranded@, guardian@ + new accounts)
First-run funnel as a brand-new coach (landing → signup → Inbucket confirm → onboarding → create team → invite),
timed, screenshot each step at 375px; student join with code → pending view; guardian signup → add child → join.
Licensing states: what each banner says, what is blocked, loud vs silent failure, approve on full team.
Guardian view incl. promotion end to end; can guardian reach team pages. Auth edges: reset via Inbucket, wrong
password copy, existing-email signup, session persistence, sign-out clears IndexedDB, re-attestation, deep-link
return after login, reuse of confirmation link. Legal pages render + versions. Getting Started accuracy.
Operator console (insert full@'s user id into platform_operators locally): directory/detail/gift/revoke/rescue.
Multi-team membership and switching. Adversarial inputs.
