export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate: Date | null;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo?: 'parent1' | 'parent2' | 'both';
  category?: TaskCategory;
  createdBy: string;
  createdAt: Date;
  completedAt?: Date;
  completedBy?: string;
  reminders?: TaskReminder[];
  attachments?: string[];
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

export enum TaskCategory {
  MEDICAL = 'medical',           // רפואי
  EDUCATION = 'education',       // חינוכי
  ACTIVITY = 'activity',         // פעילות
  SHOPPING = 'shopping',         // קניות
  HOUSEHOLD = 'household',       // משק בית
  PAPERWORK = 'paperwork',       // ניירת
  OTHER = 'other'
}

export interface TaskReminder {
  minutes: number;
  sent: boolean;
}
