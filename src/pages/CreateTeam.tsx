import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, Users, Shield, CheckCircle, AlertTriangle, KeyRound } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { recordAttestation, COACH_REQUIRED_ATTESTATIONS } from '../lib/attestations';
import { useAppStore } from '../lib/store';
import { pathFor } from '../lib/navigation';

type Step = 'attestation' | 'details' | 'complete';

const STEPS: { id: Step; title: string; }[] = [
    { id: 'attestation', title: 'Admin Agreement' },
    { id: 'details', title: 'Team Details' },
];

/**
 * A sensible first-season name, which the admin can edit.
 *
 * `create_team_as_admin` REQUIRES a season name; V1 hardcoded `'Demo Season'` inside the
 * function, which is how a number of real teams ended up with a season called that. FTC
 * seasons run across a calendar-year boundary, so the current year and the next is the
 * right default to offer.
 */
function defaultSeasonName(): string {
    const year = new Date().getFullYear();
    return `${year}-${year + 1} Season`;
}

export default function CreateTeam() {
    const navigate = useNavigate();
    const { user, ageClassification, isLoading: authLoading } = useAuth();
    const { teams, setTeams, setCurrentTeam } = useAppStore();
    const [currentStep, setCurrentStep] = useState<Step>('attestation');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [coachTermsAccepted, setCoachTermsAccepted] = useState(false);
    const [teamName, setTeamName] = useState('');
    const [teamNumber, setTeamNumber] = useState('');
    const [seasonName, setSeasonName] = useState(defaultSeasonName);

    // Created team info
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    /*
     * SEC-09. The expiry comes back from `create_team_as_admin`, read off the row the RPC just
     * inserted -- not computed here from a client constant. The code used to last 24 hours with
     * nothing on this screen saying so, so a coach who registered at home and read the code out
     * at the next meeting handed every student "Invalid or expired invite code".
     */
    const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
    /*
     * The team already holding the number this coach typed (D3).
     *
     * Its own state rather than an `error` string, because this is not an error the coach can
     * fix by retyping — it is a different destination. `docs/failure-modes.md` §14: a screen
     * that discards the user's intent at the one moment they only ever pass through once.
     */
    const [takenBy, setTakenBy] = useState<{ name: string; number: string } | null>(null);

    // Check if user is 18+ - redirect if not
    useEffect(() => {
        if (!authLoading && !user) {
            navigate('/login');
        }
    }, [authLoading, user, navigate]);

    const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

    // If user isn't 18+, show a block message
    if (!authLoading && ageClassification !== '18_plus') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500/20 rounded-full mb-4">
                            <AlertTriangle className="w-8 h-8 text-amber-400" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Age Requirement</h2>
                        <p className="text-slate-400 mb-6">
                            You must be 18 or older to create and manage a team on FalconForge.
                            {!ageClassification && ' Please complete your profile setup first.'}
                        </p>
                        <div className="space-y-3">
                            <button
                                onClick={() => navigate('/onboarding')}
                                className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                            >
                                <ArrowLeft size={18} />
                                Back to Teams
                            </button>
                            <Link
                                to="/join"
                                className="block w-full text-center text-forge-400 hover:text-forge-300 font-medium py-2"
                            >
                                Join an existing team instead
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const canProceed = () => {
        switch (currentStep) {
            case 'attestation': return coachTermsAccepted;
            case 'details': return teamName.trim().length >= 3 && seasonName.trim().length > 0;
            default: return false;
        }
    };

    const handleNext = async () => {
        if (currentStep === 'attestation') {
            setCurrentStep('details');
        } else if (currentStep === 'details') {
            await createTeam();
        }
    };

    const handleBack = () => {
        if (currentStep === 'complete') {
            return;
        }
        if (currentStep === 'details') {
            setCurrentStep('attestation');
        } else {
            navigate('/onboarding');
        }
    };

    const createTeam = async () => {
        if (!supabase || !user) {
            setError('Not authenticated');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            /*
             * Record every attestation creating a team requires, from the named constant.
             *
             * `COACH_REQUIRED_ATTESTATIONS` sat unused for three sprints while this line
             * hardcoded the single type it contains. Using it means adding a required document is
             * a one-line change in `attestations.ts` rather than a hunt for call sites — and it
             * is the same mechanism `AcceptAdminNomination` uses for the transfer path, so the two
             * ways of becoming an admin cannot end up requiring different things.
             */
            for (const type of COACH_REQUIRED_ATTESTATIONS) {
                const attestResult = await recordAttestation(type);
                if (!attestResult.success) {
                    setError(attestResult.error || 'Failed to record attestation');
                    setIsLoading(false);
                    return;
                }
            }

            // Call the create team function
            const { data, error: rpcError } = await supabase.rpc('create_team_as_admin', {
                team_name: teamName.trim(),
                season_name: seasonName.trim(),
                // undefined omits the argument so the function's `DEFAULT NULL` applies.
                // Passing null explicitly is equivalent at runtime but does not match the
                // generated signature (`team_number?: string`).
                team_number: teamNumber.trim() || undefined,
            });

            if (rpcError) {
                console.error('RPC error:', rpcError);
                setError(rpcError.message);
                setIsLoading(false);
                return;
            }

            const result = data as {
                success: boolean;
                team_id?: string;
                team_name?: string;
                team_number?: string;
                season_id?: string;
                invite_code?: string;
                invite_expires_at?: string;
                error?: string;
                /*
                 * D3. The client has to BRANCH on "that number is taken" rather than only
                 * display it, and branching on prose is how a reworded error message becomes
                 * a broken funnel. Three codes, each with a different next screen.
                 */
                error_code?: string;
            };

            if (!result.success) {
                /*
                 * SOMEBODY ELSE HAS THIS NUMBER — the case D3 says is CERTAIN rather than
                 * defensive, because two coaches from one team both registering, and typo'd
                 * numbers, both land here.
                 *
                 * Routed to the JOIN screen, not to a new "request to join" path. D3 says to
                 * reuse the existing pending status and join RPC and not to write a second
                 * join path, and there is a security reason as well as an instruction: a
                 * request-to-join that needed only a team NUMBER would let anyone attach a
                 * pending row to any team by guessing five digits. An invite code gets you
                 * into the queue; that rule does not get an exception because the coach
                 * arrived from a different screen.
                 */
                if (result.error_code === 'team_number_taken') {
                    setTakenBy({
                        name: result.team_name ?? 'that team',
                        number: result.team_number ?? teamNumber.trim(),
                    });
                    setIsLoading(false);
                    return;
                }

                /*
                 * THEIR OWN TEAM. Sending a team's own admin into a request-to-join queue for
                 * their own team would be absurd, so this is the one branch that gets the
                 * team id back and can act on it directly.
                 */
                if (result.error_code === 'already_on_team' && result.team_id) {
                    setCurrentTeam(result.team_id);
                    navigate(pathFor('dashboard'));
                    return;
                }

                setError(result.error || 'Failed to create team');
                setIsLoading(false);
                return;
            }

            /*
             * Adopt the team that was just created, rather than making the coach go and find it.
             *
             * Without this, "Go to Dashboard" navigated to `/`, the app found no current team,
             * and sent the coach straight back to the team picker to select the team they had
             * finished creating ten seconds earlier -- from a list with exactly one entry on it.
             * Every team runs this flow exactly once, on their first evening, with nobody to ask.
             *
             * Both halves are needed, and the second is the non-obvious one: setting only the
             * current id left the sidebar resolving a name it did not have and rendering
             * "Select Team" while sitting inside that very team.
             *
             * This used to say that `setTeams` had exactly one caller and that `teams` was not a
             * registry entity. Both stopped being true when `teams` was registered: the pull now
             * populates the collection too. The seeding below is still needed and still not a
             * read path — it closes the window between the RPC returning and the next pull, which
             * is the window the coach is actually looking at.
             *
             * Seeded from the write we just performed rather than read back, which is what an
             * offline-first app does everywhere else -- not a second read path.
             */
            if (result.team_id) {
                setTeams([
                    ...teams.filter((t) => t.id !== result.team_id),
                    {
                        id: result.team_id,
                        name: teamName.trim(),
                        teamNumber: teamNumber.trim() || null,
                        ownerId: user.id,
                        createdAt: Date.now(),
                    },
                ]);
                setCurrentTeam(result.team_id);
            }

            setInviteCode(result.invite_code || null);
            setInviteExpiresAt(result.invite_expires_at || null);
            setCurrentStep('complete');
        } catch (err: any) {
            console.error('Exception creating team:', err);
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    /*
     * SOMEBODY ALREADY HAS THIS NUMBER.
     *
     * A whole screen rather than an inline error under the field, because the coach's next
     * action is not "retype the number" — it is either "join that team" or "I mistyped". An
     * inline red sentence offers neither and leaves them on a form whose Create button will
     * refuse them again.
     *
     * The team's name is the load-bearing detail. "#12345 is taken" reads like a bug in
     * FalconForge; "#12345 Iron Falcons is already registered" is a coach recognising their
     * own team, which per D3 is the commonest reason anybody sees this at all.
     */
    if (takenBy) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    <div
                        data-testid="team-number-taken"
                        className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl text-center"
                    >
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-forge-500/20 rounded-full mb-4">
                            <Users className="w-8 h-8 text-forge-400" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">
                            #{takenBy.number} {takenBy.name} is already here
                        </h2>
                        <p className="text-slate-400 mb-6 text-sm">
                            Somebody from your team registered it already — often the other coach.
                            Ask them for an invite code and you will land on the same roster,
                            rather than starting a second copy of the team.
                        </p>
                        <div className="space-y-3">
                            <button
                                onClick={() => navigate('/join')}
                                data-testid="taken-go-join"
                                className="w-full flex items-center justify-center gap-2 bg-forge-600 hover:bg-forge-500 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                            >
                                <KeyRound size={18} />
                                Join with an invite code
                            </button>
                            {/*
                              * The way back, because the other real cause is a typo — and a
                              * screen with one exit is a trap for the coach who typed 1234
                              * instead of 12345.
                              */}
                            <button
                                onClick={() => setTakenBy(null)}
                                data-testid="taken-back"
                                className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                            >
                                <ArrowLeft size={18} />
                                I typed the wrong number
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const renderStepContent = () => {
        switch (currentStep) {
            case 'attestation':
                return (
                    <div className="space-y-6">
                        <div className="bg-slate-700/50 rounded-xl p-4 space-y-4 text-sm text-slate-300">
                            <p className="font-medium text-white">By creating a team, you agree to:</p>
                            <ul className="list-disc list-inside space-y-2">
                                <li><strong>Terms & Conditions:</strong> Coaches control team membership and approval</li>
                                <li><strong>Billing:</strong> You will be billed monthly based on approved team members (free during beta)</li>
                                <li><strong>COPPA Compliance:</strong> You accept responsibility for obtaining parental consent for minors and will act as the parent's agent for COPPA purposes</li>
                            </ul>
                            <p className="text-slate-400 text-xs">
                                <Link to="/legal/terms" className="text-forge-400 hover:text-forge-300 underline" target="_blank">
                                    Read full Terms and Conditions
                                </Link>
                            </p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer group p-4 rounded-xl border border-slate-600 hover:border-forge-500/50 transition">
                            <input
                                type="checkbox"
                                checked={coachTermsAccepted}
                                onChange={(e) => setCoachTermsAccepted(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-forge-500 focus:ring-forge-500 mt-0.5"
                            />
                            <span className="text-slate-300 group-hover:text-white transition-colors">
                                I am 18+ and I agree to the Terms & Conditions, Billing Policy, and COPPA responsibilities as a team coach.
                            </span>
                        </label>
                    </div>
                );

            case 'details':
                return (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Team Name *
                            </label>
                            <input
                                type="text"
                                value={teamName}
                                onChange={(e) => setTeamName(e.target.value)}
                                placeholder="e.g., Falcon Force"
                                className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-forge-500"
                                minLength={3}
                            />
                            <p className="text-slate-400 text-xs mt-1">Minimum 3 characters</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                First Season *
                            </label>
                            <input
                                type="text"
                                value={seasonName}
                                onChange={(e) => setSeasonName(e.target.value)}
                                placeholder="e.g., 2026-2027 Season"
                                className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-forge-500"
                            />
                            <p className="text-slate-400 text-xs mt-1">
                                Your sprint board, scouting data and checklist all start fresh each season.
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                FTC Team Number (Optional)
                            </label>
                            <input
                                type="text"
                                value={teamNumber}
                                onChange={(e) => setTeamNumber(e.target.value)}
                                placeholder="e.g., 12345"
                                className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-forge-500"
                            />
                        </div>
                    </div>
                );

            case 'complete':
                return (
                    <div className="text-center space-y-6">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/20 rounded-full">
                            <CheckCircle className="w-10 h-10 text-green-500" />
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-white mb-2">Team Created Successfully!</h3>
                            <p className="text-slate-400">Your team "{teamName}" has been created.</p>
                        </div>
                        {inviteCode && (
                            <div className="bg-slate-700/50 rounded-xl p-4">
                                <p className="text-sm text-slate-400 mb-2">Your team invite code:</p>
                                <p className="text-2xl font-mono font-bold text-forge-400">{inviteCode}</p>
                                <p className="text-xs text-slate-500 mt-2">Share this code with team members to invite them</p>
                                {/*
                                  * Three states, not two (failure-modes §4): a date when the
                                  * server gave one, "does not expire" when it explicitly gave
                                  * null, and nothing at all when an older server did not answer
                                  * -- silence being better than inventing a deadline.
                                  */}
                                {inviteExpiresAt !== null && (
                                    <p className="text-xs text-amber-400/80 mt-1">
                                        {/*
                                          * The TIME is part of the sentence, not decoration.
                                          * `expires_at` is an instant seven days after
                                          * registration, so a code made on Sunday evening dies
                                          * on Saturday EVENING — and "Works until Saturday"
                                          * reads as "all of Saturday" to the coach holding it.
                                          * Rendered in the reader's own zone, which for a
                                          * timestamptz is the correct reading (failure-modes
                                          * §10 is about date-only values, which this is not).
                                          */}
                                        Works until {new Date(inviteExpiresAt).toLocaleString(undefined, {
                                            weekday: 'long', month: 'short', day: 'numeric',
                                            hour: 'numeric', minute: '2-digit',
                                        })}. You can make a new code any time from Admin &rarr; Invites.
                                    </p>
                                )}
                            </div>
                        )}
                        <button
                            onClick={() => navigate('/')}
                            className="w-full bg-gradient-to-r from-forge-500 to-forge-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-forge-600 hover:to-forge-700 transition-all"
                        >
                            Go to Dashboard
                        </button>
                    </div>
                );
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-lg">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-xl border border-slate-700/50 mb-4 p-2">
                        <img
                            src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                            className="w-full h-full object-contain"
                            alt="FalconForge Logo"
                        />
                    </div>
                    <h1 className="text-3xl font-black italic tracking-tighter mb-2"><span className="bg-gradient-to-r from-forge-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-300">FORGE</span></h1>
                    <p className="text-slate-400">Create your FTC team</p>
                </div>

                {/* Progress Steps - simple dashes */}
                {currentStep !== 'complete' && (
                    <div className="flex items-center justify-center gap-2 mb-8">
                        <div className={`h-1 w-12 rounded-full ${currentStepIndex >= 0 ? 'bg-forge-500' : 'bg-slate-700'}`} />
                        <div className={`h-1 w-12 rounded-full ${currentStepIndex >= 1 ? 'bg-forge-500' : 'bg-slate-700'}`} />
                    </div>
                )}

                {/* Card */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl">
                    {/* Step Title */}
                    {currentStep !== 'complete' && (
                        <div className="flex items-center gap-3 mb-6">
                            {currentStep === 'attestation' ? (
                                <Shield className="text-forge-500" size={24} />
                            ) : (
                                <Users className="text-forge-500" size={24} />
                            )}
                            <h2 className="text-lg font-semibold text-white">
                                {STEPS[currentStepIndex].title}
                            </h2>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
                            <p className="text-red-400 text-sm">{error}</p>
                        </div>
                    )}

                    {/* Step Content */}
                    {renderStepContent()}

                    {/* Navigation Buttons */}
                    {currentStep !== 'complete' && (
                        <div className="flex gap-3 mt-8">
                            <button
                                onClick={handleBack}
                                className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                            >
                                <ArrowLeft size={18} />
                                Back
                            </button>
                            <button
                                onClick={handleNext}
                                disabled={!canProceed() || isLoading}
                                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-forge-500 to-forge-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-forge-600 hover:to-forge-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <Loader2 size={18} className="animate-spin" />
                                ) : currentStep === 'details' ? (
                                    <>
                                        <Check size={18} />
                                        Create Team
                                    </>
                                ) : (
                                    <>
                                        Next
                                        <ArrowRight size={18} />
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
