import Dexie, { Table } from 'dexie';

/**
 * Local database for offline-first functionality
 * Uses IndexedDB via Dexie for fast local storage
 * 
 * Entity Model (v2):
 * - Team: Top-level team entity (formerly "Organization")
 * - TeamMember: Users associated with a Team
 * - SubTeam: Working groups within a Team (e.g., Build, Programming)
 * - Tasks, Checklists, etc. are scoped to a Team
 */

// Top-level Team entity
export interface LocalTeam {
    id: string;
    name: string;
    teamNumber: string | null;
    inviteCode: string;
    ownerId: string;
    createdAt: number;
    syncStatus: 'synced' | 'pending' | 'conflict';
}

// Team Members - users associated with a Team
export interface LocalTeamMember {
    id: string;
    teamId: string;
    userId: string;
    role: 'coach' | 'mentor' | 'student';
    fullName: string | null;
    email: string;
    avatarUrl: string | null;
    joinedAt: number;
    syncStatus: 'synced' | 'pending' | 'conflict';
}

// Sub-Teams - working groups within a Team
export interface LocalSubTeam {
    id: string;
    teamId: string;
    seasonId?: string;
    name: string;
    memberIds: string[];
    syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface LocalTask {
    id: string;
    teamId: string;
    subTeamId?: string;
    seasonId?: string;
    title: string;
    description?: string;
    status: 'Backlog' | 'To Do' | 'In Progress' | 'Testing' | 'Done';
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
    teamId: string;
    seasonId?: string;
    name: string;
    items: { id: string; text: string; checked: boolean; assignedTo?: string }[];
    isTemplate: boolean;
    updatedAt: number;
    syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface LocalScoutingReport {
    id: string;
    teamId: string;
    seasonId?: string;
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
    teamId: string;
    seasonId?: string;
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

class FalconForgeDatabase extends Dexie {
    teams!: Table<LocalTeam, string>;
    teamMembers!: Table<LocalTeamMember, string>;
    subTeams!: Table<LocalSubTeam, string>;
    tasks!: Table<LocalTask, string>;
    checklists!: Table<LocalChecklist, string>;
    scoutingReports!: Table<LocalScoutingReport, string>;
    matchPlans!: Table<LocalMatchPlan, string>;
    syncQueue!: Table<SyncQueueItem, string>;

    constructor() {
        super('FalconForgeDB');

        // Version 1: Initial schema with new entity model
        this.version(1).stores({
            teams: 'id, ownerId, syncStatus',
            teamMembers: 'id, teamId, userId, syncStatus',
            subTeams: 'id, teamId, seasonId, syncStatus',
            tasks: 'id, teamId, subTeamId, seasonId, status, syncStatus, updatedAt',
            checklists: 'id, teamId, seasonId, syncStatus',
            scoutingReports: 'id, teamId, seasonId, opponentTeamNumber, matchNumber, syncStatus',
            matchPlans: 'id, teamId, seasonId, syncStatus',
            syncQueue: 'id, tableName, timestamp, retryCount',
        });
    }
}

export const db = new FalconForgeDatabase();

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
    await db.teams.clear();
    await db.teamMembers.clear();
    await db.subTeams.clear();
    await db.tasks.clear();
    await db.checklists.clear();
    await db.scoutingReports.clear();
    await db.matchPlans.clear();
    await db.syncQueue.clear();
}
