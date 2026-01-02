import Dexie, { Table } from 'dexie';

/**
 * Local database for offline-first functionality
 * Uses IndexedDB via Dexie for fast local storage
 */

export interface LocalTask {
    id: string;
    organizationId: string;
    teamId?: string;
    title: string;
    description?: string;
    status: 'Backlog' | 'To Do' | 'In Progress' | 'Validation' | 'Done';
    type: 'Feature' | 'Bug';
    assignedTo?: string;
    tags: string[];
    checklist: { id: string; text: string; completed: boolean }[];
    timeline: { id: string; type: string; authorId: string; content: string; timestamp: number }[];
    dueDate?: number;
    createdAt: number;
    updatedAt: number;
    // Sync metadata
    syncStatus: 'synced' | 'pending' | 'conflict';
    lastSyncedAt?: number;
    localVersion: number;
    serverVersion?: number;
}

export interface LocalChecklist {
    id: string;
    organizationId: string;
    name: string;
    items: { id: string; text: string; checked: boolean; assignedTo?: string }[];
    isTemplate: boolean;
    updatedAt: number;
    syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface LocalScoutingReport {
    id: string;
    organizationId: string;
    opponentTeamNumber: string;
    matchNumber: number;
    eventName?: string;
    data: {
        hasAutonomous: boolean;
        autoScore: number;
        intakeType: string;
        autoAim: boolean;
        farShooting: boolean;
        shotsTaken: number;
        shotsMissed: number;
        parking: string;
        rating: number;
        endGameNotes: string;
    };
    createdBy: string;
    createdAt: number;
    syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface LocalMatchPlan {
    id: string;
    organizationId: string;
    matchNumber?: number;
    allianceTeam?: string;
    drawingData: any; // SVG path data
    notes?: string;
    updatedAt: number;
    syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface SyncQueueItem {
    id: string;
    tableName: string;
    recordId: string;
    operation: 'create' | 'update' | 'delete';
    data: any;
    timestamp: number;
    retryCount: number;
    lastError?: string;
}

export interface LocalMember {
    id: string;
    organizationId: string;
    firstName: string;
    lastNameInitial: string;
    userId?: string; // Linked Supabase user ID
    syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface LocalTeam {
    id: string;
    organizationId: string;
    name: string;
    memberIds: string[];
    syncStatus: 'synced' | 'pending' | 'conflict';
}

class FTCManagerDatabase extends Dexie {
    tasks!: Table<LocalTask, string>;
    checklists!: Table<LocalChecklist, string>;
    scoutingReports!: Table<LocalScoutingReport, string>;
    matchPlans!: Table<LocalMatchPlan, string>;
    syncQueue!: Table<SyncQueueItem, string>;
    members!: Table<LocalMember, string>;
    teams!: Table<LocalTeam, string>;

    constructor() {
        super('FTCManagerDB');

        this.version(1).stores({
            tasks: 'id, organizationId, teamId, status, syncStatus, updatedAt',
            checklists: 'id, organizationId, syncStatus',
            scoutingReports: 'id, organizationId, opponentTeamNumber, matchNumber, syncStatus',
            matchPlans: 'id, organizationId, syncStatus',
            syncQueue: 'id, tableName, timestamp, retryCount',
            members: 'id, organizationId, syncStatus',
            teams: 'id, organizationId, syncStatus',
        });
    }
}

export const db = new FTCManagerDatabase();

// Helper to generate UUIDs
export function generateId(): string {
    return crypto.randomUUID();
}

// Helper to add item to sync queue
export async function queueForSync(
    tableName: string,
    recordId: string,
    operation: 'create' | 'update' | 'delete',
    data: any
) {
    await db.syncQueue.add({
        id: generateId(),
        tableName,
        recordId,
        operation,
        data,
        timestamp: Date.now(),
        retryCount: 0,
    });
}

// Get pending sync count
export async function getPendingSyncCount(): Promise<number> {
    return await db.syncQueue.count();
}

// Clear all local data (for logout)
export async function clearLocalDatabase() {
    await db.tasks.clear();
    await db.checklists.clear();
    await db.scoutingReports.clear();
    await db.matchPlans.clear();
    await db.syncQueue.clear();
    await db.members.clear();
    await db.teams.clear();
}
