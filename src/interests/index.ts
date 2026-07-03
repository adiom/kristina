import { db } from '../db';
import { interests } from '../db/schema';
import { sql, eq, desc, and, lt } from 'drizzle-orm';

const DECAY_RATE = 0.1;
const GROWTH_RATE = 0.5;
const ARCHIVE_THRESHOLD = 2;
const ARCHIVE_DAYS = 30;

export async function addInterest(
  topic: string,
  score: number,
  source: 'memory_analysis' | 'conversation' | 'reflection' | 'manual'
) {
  const existing = await db
    .select()
    .from(interests)
    .where(eq(interests.topic, topic))
    .limit(1);

  if (existing.length > 0) {
    const newScore = Math.min(10, parseFloat(existing[0].score) + score * 0.3);
    await db
      .update(interests)
      .set({ score: newScore.toString() })
      .where(eq(interests.topic, topic));
  } else {
    await db.insert(interests).values({
      topic,
      score: score.toString(),
      priority: score > 7 ? 1 : score > 4 ? 2 : 3,
      source,
    });
  }
}

export async function getTopInterests(limit = 10) {
  return db
    .select()
    .from(interests)
    .orderBy(desc(interests.score))
    .limit(limit);
}

export async function decayInterests() {
  const allInterests = await db.select().from(interests);

  for (const interest of allInterests) {
    const currentScore = parseFloat(interest.score);
    const daysSinceExplored = interest.lastExplored
      ? Math.floor(
          (Date.now() - interest.lastExplored.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 999;

    if (daysSinceExplored > 7) {
      const decayFactor = DECAY_RATE * Math.floor(daysSinceExplored / 7);
      const newScore = Math.max(0, currentScore - decayFactor);

      if (newScore < ARCHIVE_THRESHOLD) {
        if (
          interest.scoreBelowThresholdSince &&
          Math.floor(
            (Date.now() - interest.scoreBelowThresholdSince.getTime()) /
              (1000 * 60 * 60 * 24)
          ) >= ARCHIVE_DAYS
        ) {
          await db
            .delete(interests)
            .where(eq(interests.id, interest.id));
          continue;
        } else if (!interest.scoreBelowThresholdSince) {
          await db
            .update(interests)
            .set({
              score: newScore.toString(),
              scoreBelowThresholdSince: new Date(),
            })
            .where(eq(interests.id, interest.id));
          continue;
        }
      }

      await db
        .update(interests)
        .set({ score: newScore.toString() })
        .where(eq(interests.id, interest.id));
    }
  }
}

export async function growInterest(topic: string) {
  const existing = await db
    .select()
    .from(interests)
    .where(eq(interests.topic, topic))
    .limit(1);

  if (existing.length > 0) {
    const newScore = Math.min(10, parseFloat(existing[0].score) + GROWTH_RATE);
    await db
      .update(interests)
      .set({
        score: newScore.toString(),
        lastExplored: new Date(),
        scoreBelowThresholdSince: null,
      })
      .where(eq(interests.topic, topic));
  }
}

export async function findRelatedInterests(topic: string) {
  return db
    .select()
    .from(interests)
    .where(
      and(
        sql`${interests.topic} != ${topic}`,
        sql`similarity(${interests.topic}, ${topic}) > 0.3`
      )
    )
    .orderBy(desc(sql`similarity(${interests.topic}, ${topic})`))
    .limit(5);
}

export async function crossPollinate(sourceTopic: string, targetTopic: string) {
  const target = await db
    .select()
    .from(interests)
    .where(eq(interests.topic, targetTopic))
    .limit(1);

  if (target.length > 0) {
    const boost = 0.2;
    const newScore = Math.min(10, parseFloat(target[0].score) + boost);
    await db
      .update(interests)
      .set({ score: newScore.toString() })
      .where(eq(interests.topic, targetTopic));
  }
}
