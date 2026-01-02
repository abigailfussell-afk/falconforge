export const TaskStatus = {
  Backlog: 'Backlog',
  ToDo: 'To Do',
  InProgress: 'In Progress',
  Validation: 'Validation',
  Done: 'Done'
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export const TaskType = {
  Feature: 'Feature',
  Bug: 'Bug'
} as const;

export type TaskType = typeof TaskType[keyof typeof TaskType];

export interface Member {
  id: string;
  firstName: string;
  lastNameInitial: string;
}

export interface Team {
  id: string;
  name: string;
  memberIds: string[];
}

export interface TimelineEvent {
  id: string;
  type: 'comment' | 'history';
  authorId: string; // Member ID or 'System'
  content: string;
  timestamp: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  type: TaskType;
  assignedTo: string; // Member ID
  department: string; // Team ID
  tags: string[];
  checklist: { id: string; text: string; completed: boolean }[];
  timeline: TimelineEvent[];
  createdAt: number;
  dueDate?: number;
}

export interface ScoutingReport {
  id: string;
  teamNumber: string;
  matchNumber: number;
  hasAutonomous: boolean;
  autoScore: number;
  intakeType: 'No Intake' | 'Human Player' | 'Automatic';
  autoAim: boolean;
  farShooting: boolean;
  shotsTaken: number;
  shotsMissed: number;
  parking: 'No Park' | 'Full Park' | 'Partial Park';
  rating: number; // 1-5
  endGameNotes: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  assignedTo?: string; // Member ID or Team ID
}

export interface Flashcard {
  question: string;
  answer: string;
}
