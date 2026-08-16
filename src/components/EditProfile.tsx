import { useState } from 'react';
import { User, Save, Edit3, X } from 'lucide-react';
import { useAuth } from '../lib/auth';

const EditProfile = () => {
    const { user, updateProfile, isConfigured } = useAuth();
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editDisplayName, setEditDisplayName] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleSaveProfile = async () => {
        if (!editDisplayName.trim()) return;

        setIsSavingProfile(true);
        setProfileMessage(null);

        const { error } = await updateProfile(editDisplayName.trim());

        if (error) {
            setProfileMessage({ type: 'error', text: error.message });
        } else {
            setProfileMessage({ type: 'success', text: 'Profile updated successfully!' });
            setIsEditingProfile(false);
        }
        setIsSavingProfile(false);
    };

    if (!isConfigured || !user) return null;

    return (
        <div className="max-w-wide mx-auto w-full">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-6">Edit Profile</h2>

            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6">
                <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                    <User className="text-forge-600" size={24} />
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Your Profile</h3>
                </div>

                {/* Profile Message */}
                {profileMessage && (
                    <div className={`mb-4 p-3 rounded-lg text-sm ${profileMessage.type === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                        }`}>
                        {profileMessage.text}
                    </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1">
                        <div className="w-12 h-12 rounded-full bg-forge-100 dark:bg-forge-900/50 flex items-center justify-center">
                            <User size={24} className="text-forge-600 dark:text-forge-400" />
                        </div>
                        <div className="flex-1">
                            {isEditingProfile ? (
                                <div className="flex gap-2 items-center">
                                    <input
                                        type="text"
                                        value={editDisplayName}
                                        onChange={(e) => setEditDisplayName(e.target.value)}
                                        placeholder="Enter your name"
                                        className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleSaveProfile}
                                        disabled={isSavingProfile || !editDisplayName.trim()}
                                        className="bg-forge-600 text-white p-2 rounded-lg hover:bg-forge-700 transition disabled:opacity-50"
                                    >
                                        <Save size={18} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsEditingProfile(false);
                                            setProfileMessage(null);
                                        }}
                                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <p className="font-semibold text-slate-800 dark:text-white">
                                        {user.user_metadata?.full_name || 'No name set'}
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                                </>
                            )}
                        </div>
                    </div>
                    {!isEditingProfile && (
                        <button
                            onClick={() => {
                                setEditDisplayName(user.user_metadata?.full_name || '');
                                setIsEditingProfile(true);
                                setProfileMessage(null);
                            }}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition"
                        >
                            <Edit3 size={16} />
                            Edit Name
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EditProfile;
