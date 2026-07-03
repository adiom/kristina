import { db } from '../db';
import { memory, interests, traits, diary, activityLog } from '../db/schema';
import { desc, sql, eq, and, gte, isNotNull } from 'drizzle-orm';

export async function getAgentDashboard() {
  const [recentMemories, topInterests, allTraits, recentDiary, recentActivity] =
    await Promise.all([
      db
        .select()
        .from(memory)
        .orderBy(desc(memory.createdAt))
        .limit(10),

      db
        .select()
        .from(interests)
        .orderBy(desc(interests.score))
        .limit(10),

      db
        .select()
        .from(traits)
        .orderBy(desc(traits.value)),

      db
        .select()
        .from(diary)
        .orderBy(desc(diary.createdAt))
        .limit(5),

      db
        .select()
        .from(activityLog)
        .orderBy(desc(activityLog.timestamp))
        .limit(20),
    ]);

  const memoryCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(memory);

  return {
    stats: {
      totalMemories: Number(memoryCount[0]?.count || 0),
      totalInterests: topInterests.length,
      totalTraits: allTraits.length,
      totalReflections: recentDiary.length,
    },
    recentMemories,
    topInterests: topInterests.map((i) => ({
      topic: i.topic,
      score: parseFloat(i.score),
      priority: i.priority,
      source: i.source,
    })),
    traits: allTraits.map((t) => ({
      name: t.name,
      value: parseFloat(t.value),
    })),
    recentReflections: recentDiary.map((d) => ({
      topic: d.topic,
      insightsCount: d.insightsCount,
      createdAt: d.createdAt,
    })),
    recentActivity: recentActivity.map((a) => ({
      type: a.type,
      context: a.context,
      timestamp: a.timestamp,
    })),
  };
}

export interface ExtendedDashboard {
  serviceUsage: Array<{ serviceId: string; count: number }>;
  activeSpaces: Array<{ spaceId: string; lastSeen: Date }>;
  recentResults: Array<{
    type: string;
    timestamp: Date;
    context: any;
  }>;
}

export async function getExtendedDashboard(): Promise<ExtendedDashboard> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Per‑service call counts in the last 24h, based on the activity log.
  const serviceRows = await db
    .select({
      serviceId: sql<string>`(context->>'serviceId')`,
      count: sql<number>`count(*)`,
    })
    .from(activityLog)
    .where(
      and(
        gte(activityLog.timestamp, since),
        isNotNull(sql`context->>'serviceId'`),
      ),
    )
    .groupBy(sql`context->>'serviceId'`)
    .orderBy(desc(sql`count(*)`));

  // Distinct active spaces (last seen) in the last 24h.
  const spaceRows = await db
    .select({
      spaceId: sql<string>`(context->>'spaceId')`,
      lastSeen: sql<Date>`max(${activityLog.timestamp})`,
    })
    .from(activityLog)
    .where(
      and(
        gte(activityLog.timestamp, since),
        isNotNull(sql`context->>'spaceId'`),
      ),
    )
    .groupBy(sql`context->>'spaceId'`)
    .orderBy(desc(sql`max(${activityLog.timestamp})`))
    .limit(20);

  const recentResults = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.type, 'message_sent'))
    .orderBy(desc(activityLog.timestamp))
    .limit(5);

  return {
    serviceUsage: serviceRows.map((r) => ({
      serviceId: r.serviceId || 'unknown',
      count: Number(r.count),
    })),
    activeSpaces: spaceRows.map((r) => ({
      spaceId: r.spaceId || 'unknown',
      lastSeen: r.lastSeen as Date,
    })),
    recentResults: recentResults.map((r) => ({
      type: r.type,
      timestamp: r.timestamp,
      context: r.context,
    })),
  };
}

