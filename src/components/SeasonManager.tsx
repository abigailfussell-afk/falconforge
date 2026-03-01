import React, { useState } from 'react';
import { Calendar, Plus, Trash2, X, Upload, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../lib/store';

const SeasonManager: React.FC = () => {
    const seasons = useAppStore((state) => state.seasons);
    const currentSeasonId = useAppStore((state) => state.currentSeasonId);
    const addSeason = useAppStore((state) => state.addSeason);
    const updateSeason = useAppStore((state) => state.updateSeason);
    const deleteSeason = useAppStore((state) => state.deleteSeason);

    const [newSeasonName, setNewSeasonName] = useState('');
    const [editingSeasonId, setEditingSeasonId] = useState<string | null>(null);
    const [editSeasonName, setEditSeasonName] = useState('');
    const [editFieldImageData, setEditFieldImageData] = useState('');
    const [deleteConfirmSeasonId, setDeleteConfirmSeasonId] = useState<string | null>(null);
    const [imageUploadError, setImageUploadError] = useState<string | null>(null);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, seasonId: string) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImageUploadError(null);

        if (!file.type.startsWith('image/')) {
            setImageUploadError('Please select an image file');
            return;
        }

        if (file.size > 500 * 1024) {
            setImageUploadError('Image must be less than 500KB');
            return;
        }

        const img = document.createElement('img');
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            if (img.width > 1200 || img.height > 800) {
                setImageUploadError('Image must be max 1200×800 pixels');
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                setEditFieldImageData(base64);
                updateSeason(seasonId, { fieldImageData: base64 });
            };
            reader.readAsDataURL(file);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            setImageUploadError('Failed to load image');
        };

        img.src = objectUrl;
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 mt-6">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                <Calendar className="text-orange-600" size={24} />
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Season Manager</h3>
            </div>

            <div className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={newSeasonName}
                    onChange={(e) => setNewSeasonName(e.target.value)}
                    placeholder="New Season Name (e.g. 2025-2026 Decode)"
                    className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                    onKeyDown={(e) => e.key === 'Enter' && newSeasonName.trim() && (addSeason(newSeasonName.trim()), setNewSeasonName(''))}
                />
                <button
                    onClick={() => { if (newSeasonName.trim()) { addSeason(newSeasonName.trim()); setNewSeasonName(''); } }}
                    className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 transition flex items-center justify-center w-10 h-10"
                >
                    <Plus size={20} />
                </button>
            </div>

            <div className="space-y-3">
                {seasons.map((season) => (
                    <div key={season.id} className={`border rounded-lg overflow-hidden ${currentSeasonId === season.id ? 'border-orange-400 ring-2 ring-orange-200 dark:ring-orange-900/50' : 'border-slate-200 dark:border-slate-600'}`}>
                        <div className="flex flex-wrap justify-between items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50">
                            <div className="flex items-center gap-2">
                                {currentSeasonId === season.id && (
                                    <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full font-bold">Active</span>
                                )}
                                <h4 className="font-bold text-slate-700 dark:text-slate-200">{season.name}</h4>
                            </div>
                            <div className="flex gap-2 items-center">
                                <button
                                    onClick={() => {
                                        if (editingSeasonId === season.id) {
                                            setEditingSeasonId(null);
                                        } else {
                                            setEditingSeasonId(season.id);
                                            setEditSeasonName(season.name);
                                            setEditFieldImageData(season.fieldImageData || '');
                                            setImageUploadError(null);
                                        }
                                    }}
                                    className={`text-xs px-3 py-1.5 rounded-full transition ${editingSeasonId === season.id ? 'bg-orange-100 text-orange-700' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                                >
                                    {editingSeasonId === season.id ? 'Done' : 'Edit'}
                                </button>
                                {seasons.length > 1 && (
                                    <button
                                        onClick={() => setDeleteConfirmSeasonId(season.id)}
                                        className="text-slate-400 hover:text-red-500 p-1"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {editingSeasonId === season.id && (
                            <div className="p-3 bg-white dark:bg-slate-800 space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Season Name</label>
                                    <input
                                        type="text"
                                        value={editSeasonName}
                                        onChange={(e) => setEditSeasonName(e.target.value)}
                                        onBlur={() => editSeasonName.trim() && updateSeason(season.id, { name: editSeasonName.trim() })}
                                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Field Image (for Match Planner)</label>
                                    {editFieldImageData && (
                                        <div className="mb-2 relative">
                                            <img
                                                src={editFieldImageData}
                                                alt="Field preview"
                                                className="w-full max-h-40 object-contain rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-900"
                                            />
                                            <button
                                                onClick={() => {
                                                    setEditFieldImageData('');
                                                    updateSeason(season.id, { fieldImageData: '' });
                                                }}
                                                className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                                                title="Remove image"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    )}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => handleImageUpload(e, season.id)}
                                        className="hidden"
                                        id={`field-image-${season.id}`}
                                    />
                                    <label
                                        htmlFor={`field-image-${season.id}`}
                                        className="flex items-center justify-center gap-2 w-full p-3 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition"
                                    >
                                        <Upload size={18} />
                                        <span className="text-sm font-medium">{editFieldImageData ? 'Replace Image' : 'Upload Field Image'}</span>
                                    </label>
                                    {imageUploadError && (
                                        <p className="text-xs text-red-500 mt-1">{imageUploadError}</p>
                                    )}
                                    <p className="text-[10px] text-slate-400 mt-1">Max: 1200×800 pixels, 500KB. Recommended: 3:2 ratio.</p>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {deleteConfirmSeasonId && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                                <AlertTriangle className="text-red-600" size={24} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Delete Season?</h3>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mb-2">
                            <strong>Warning:</strong> This will permanently delete the season <strong>"{seasons.find(s => s.id === deleteConfirmSeasonId)?.name}"</strong> and ALL associated data:
                        </p>
                        <ul className="text-sm text-slate-500 dark:text-slate-400 list-disc list-inside mb-4">
                            <li>All tasks</li>
                            <li>All sub-team assignments</li>
                            <li>All scouting reports</li>
                            <li>All match plans</li>
                            <li>All portfolio entries</li>
                        </ul>
                        <p className="text-red-600 dark:text-red-400 text-sm font-medium mb-6">This action cannot be undone.</p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirmSeasonId(null)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { deleteSeason(deleteConfirmSeasonId); setDeleteConfirmSeasonId(null); }}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
                            >
                                Delete Season
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SeasonManager;
