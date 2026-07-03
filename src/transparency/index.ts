import { db } from '../db';
import { activityLog } from '../db/schema';
import { eq, gte, and, desc } from 'drizzle-orm';

export interface ActivityEvent {
  type: string;
  channel?: string;
  details?: Record<string, any>;
  context?: { channel?: string; userId?: string };
}

let activityBuffer: ActivityEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;

const FLUSH_INTERVAL = 5000;
const MAX_BUFFER_SIZE = 50;

export async function logActivity(event: ActivityEvent) {
  activityBuffer.push(event);

  if (activityBuffer.length >= MAX_BUFFER_SIZE) {
    await flushActivities();
  } else if (!flushTimer) {
    flushTimer = setTimeout(async () => {
      await flushActivities();
      flushTimer = null;
    }, FLUSH_INTERVAL);
  }
}

async function flushActivities() {
  if (activityBuffer.length === 0) return;

  const events = [...activityBuffer];
  activityBuffer = [];

  try {
    await db.insert(activityLog).values(
      events.map((e) => ({
        type: e.type as any,
        details: e.details as any,
        context: { channel: e.channel, ...e.context } as any,
      }))
    );
  } catch (err) {
    console.error('[Activity] Failed to flush:', err);
    activityBuffer = [...events, ...activityBuffer];
  }
}

export async function getActivityLog(
  filters?: {
    type?: string;
    since?: Date;
    limit?: number;
  }
) {
  const conditions = [];

  if (filters?.type) {
    conditions.push(eq(activityLog.type, filters.type as any));
  }
  if (filters?.since) {
    conditions.push(gte(activityLog.timestamp, filters.since));
  }

  const query = db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.timestamp));

  if (conditions.length > 0) {
    query.where(and(...conditions));
  }

  return query.limit(filters?.limit || 100);
}

export async function getStats(period: 'hour' | 'day' | 'week' = 'day') {
  const since = new Date();
  switch (period) {
    case 'hour':
      since.setHours(since.getHours() - 1);
      break;
    case 'day':
      since.setDate(since.getDate() - 1);
      break;
    case 'week':
      since.setDate(since.getDate() - 7);
      break;
  }

  const logs = await db
    .select()
    .from(activityLog)
    .where(gte(activityLog.timestamp, since));

  const stats = {
    total: logs.length,
    byType: {} as Record<string, number>,
    byChannel: {} as Record<string, number>,
  };

  for (const log of logs) {
    stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
    const channel = (log.context as any)?.channel;
    if (channel) {
      stats.byChannel[channel] = (stats.byChannel[channel] || 0) + 1;
    }
  }

  return stats;
}
