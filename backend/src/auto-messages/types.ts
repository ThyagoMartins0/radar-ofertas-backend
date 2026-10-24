export const AUTO_MESSAGE_SCHEDULE_TYPES = ['manual', 'once', 'daily'] as const;

export type AutoMessageScheduleType = (typeof AUTO_MESSAGE_SCHEDULE_TYPES)[number];

export interface AutoMessageRecord {
  id: string;
  title: string;
  content: string;
  scheduleType: AutoMessageScheduleType;
  scheduledAt: Date | null;
  dailyHour: number | null;
  dailyMinute: number | null;
  enabled: boolean;
  lastSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
