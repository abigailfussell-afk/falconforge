import { Cloud, CloudOff, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { useSync } from '../lib/sync';
import { isSupabaseConfigured } from '../lib/supabase';

interface SyncStatusIndicatorProps {
    variant?: 'full' | 'icon';
}

export default function SyncStatusIndicator({ variant = 'full' }: SyncStatusIndicatorProps) {
    const { isOnline, syncStatus, pendingChanges, lastSyncTime, sync, error } = useSync();
    const isConfigured = isSupabaseConfigured();

    // Don't show anything in demo mode - just a subtle indicator
    if (!isConfigured) {
        return null;
    }

    const getStatusIcon = () => {
        if (!isOnline) {
            return <CloudOff className="w-4 h-4 text-slate-400" />;
        }
        switch (syncStatus) {
            case 'syncing':
                return <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />;
            case 'error':
                return <AlertCircle className="w-4 h-4 text-red-400" />;
            case 'idle':
                return pendingChanges > 0
                    ? <Cloud className="w-4 h-4 text-amber-400" />
                    : <Check className="w-4 h-4 text-green-400" />;
            default:
                return <CloudOff className="w-4 h-4 text-slate-400" />;
        }
    };

    const getStatusText = () => {
        if (!isOnline) return 'Offline';
        switch (syncStatus) {
            case 'syncing':
                return 'Syncing...';
            case 'error':
                return 'Sync Error';
            case 'idle':
                if (pendingChanges > 0) {
                    return `${pendingChanges} pending`;
                }
                return 'Synced';
            default:
                return 'Offline';
        }
    };

    const getStatusColor = () => {
        if (!isOnline) return 'bg-slate-500/10 border-slate-500/20';
        switch (syncStatus) {
            case 'syncing':
                return 'bg-blue-500/10 border-blue-500/20';
            case 'error':
                return 'bg-red-500/10 border-red-500/20';
            case 'idle':
                return pendingChanges > 0
                    ? 'bg-amber-500/10 border-amber-500/20'
                    : 'bg-green-500/10 border-green-500/20';
            default:
                return 'bg-slate-500/10 border-slate-500/20';
        }
    };

    return (
        <button
            onClick={() => sync()}
            disabled={syncStatus === 'syncing' || !isOnline}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${getStatusColor()} ${variant === 'icon' ? 'aspect-square justify-center' : ''}`}
            title={error || (lastSyncTime ? `Last synced: ${lastSyncTime.toLocaleTimeString()}` : 'Click to sync')}
        >
            <span className={syncStatus === 'syncing' ? 'animate-spin' : ''}>
                {getStatusIcon()}
            </span>
            {variant === 'full' && (
                <span>{getStatusText()}</span>
            )}
        </button>
    );
}
