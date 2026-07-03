import { db } from '../db';
import { memory, interests, traits, diary, activityLog } from '../db/schema';
import { desc, sql, eq } from 'drizzle-orm';

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
