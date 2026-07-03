# Interest System — cf-kristina

## Overview

The interest system drives autonomous exploration by tracking topics the agent finds interesting. Interests evolve through decay, growth, and cross-pollination.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Interest System                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │    Add      │    │   Evolve    │    │   Select    │  │
│  │  Interest   │    │  (decay/    │    │  for        │  │
│  │             │    │   growth)   │    │  Reflection │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
│         │                  │                  │         │
│         └──────────────────┼──────────────────┘         │
│                            │                            │
│                    ┌───────▼───────┐                    │
│                    │   Interests   │                    │
│                    │     Store     │                    │
│                    └───────────────┘                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Constants

```typescript
const DECAY_RATE = 0.1;       // Subtracted per week
const GROWTH_RATE = 0.5;      // Added when explored
const ARCHIVE_THRESHOLD = 2;  // Score below this triggers archival tracking
const ARCHIVE_DAYS = 30;      // Days below threshold before deletion
```

## Interest Lifecycle

### 1. Add Interest
Creates or increments an existing interest:
```typescript
async function addInterest(
  topic: string,
  score: number,
  source: 'memory_analysis' | 'conversation' | 'reflection' | 'manual'
) {
  const existing = await db.select().from(interests)
    .where(eq(interests.topic, topic)).limit(1);

  if (existing.length > 0) {
    // Increment existing: newScore = min(10, current + score * 0.3)
    const newScore = Math.min(10, parseFloat(existing[0].score) + score * 0.3);
    await db.update(interests).set({ score: newScore.toString() })
      .where(eq(interests.topic, topic));
  } else {
    // Create new with initial score
    await db.insert(interests).values({
      topic,
      score: score.toString(),
      priority: score > 7 ? 1 : score > 4 ? 2 : 3,
      source,
    });
  }
}
```

### 2. Growth
Interests grow when explored:
```typescript
async function growInterest(topic: string) {
  const existing = await db.select().from(interests)
    .where(eq(interests.topic, topic)).limit(1);

  if (existing.length > 0) {
    const newScore = Math.min(10, parseFloat(existing[0].score) + GROWTH_RATE); // +0.5
    await db.update(interests).set({
      score: newScore.toString(),
      lastExplored: new Date(),
      scoreBelowThresholdSince: null, // Reset archival tracking
    }).where(eq(interests.topic, topic));
  }
}
```

### 3. Decay
Interests decay linearly over time:
```typescript
async function decayInterests() {
  const allInterests = await db.select().from(interests);

  for (const interest of allInterests) {
    const currentScore = parseFloat(interest.score);
    const daysSinceExplored = interest.lastExplored
      ? Math.floor((Date.now() - interest.lastExplored.getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    if (daysSinceExplored > 7) {
      // Linear decay: DECAY_RATE * floor(weeks)
      const decayFactor = DECAY_RATE * Math.floor(daysSinceExplored / 7);
      const newScore = Math.max(0, currentScore - decayFactor);

      // Archival tracking
      if (newScore < ARCHIVE_THRESHOLD) {
        if (interest.scoreBelowThresholdSince &&
            daysSinceInterestBelowThreshold(interest) >= ARCHIVE_DAYS) {
          await db.delete(interests).where(eq(interests.id, interest.id));
          continue;
        } else if (!interest.scoreBelowThresholdSince) {
          await db.update(interests).set({
            score: newScore.toString(),
            scoreBelowThresholdSince: new Date(),
          }).where(eq(interests.id, interest.id));
          continue;
        }
      }

      await db.update(interests).set({ score: newScore.toString() })
        .where(eq(interests.id, interest.id));
    }
  }
}
```

### 4. Cross-Pollination
Related interests grow when one is explored:
```typescript
async function crossPollinate(sourceTopic: string, targetTopic: string) {
  const target = await db.select().from(interests)
    .where(eq(interests.topic, targetTopic)).limit(1);

  if (target.length > 0) {
    const boost = 0.2; // Fixed boost, not similarity-based
    const newScore = Math.min(10, parseFloat(target[0].score) + boost);
    await db.update(interests).set({ score: newScore.toString() })
      .where(eq(interests.topic, targetTopic));
  }
}
```

### 5. Archival
Interests below threshold 2 for 30 days are deleted:
```typescript
// Handled within decayInterests()
if (newScore < ARCHIVE_THRESHOLD) {
  if (interest.scoreBelowThresholdSince &&
      daysSinceInterestBelowThreshold(interest) >= ARCHIVE_DAYS) {
    await db.delete(interests).where(eq(interests.id, interest.id));
  }
}
```

## Interest Selection for Reflection

Topics are selected using weighted random from top 5 interests:
```typescript
async function selectTopic(): Promise<string> {
  const topInterests = await db.select().from(interests)
    .orderBy(desc(interests.score)).limit(5);

  if (topInterests.length === 0) return 'общие наблюдения';

  const totalScore = topInterests.reduce(
    (sum, i) => sum + parseFloat(i.score), 0
  );
  const random = Math.random() * totalScore;

  let cumulative = 0;
  for (const interest of topInterests) {
    cumulative += parseFloat(interest.score);
    if (random <= cumulative) return interest.topic;
  }
  return topInterests[0].topic;
}
```

## Finding Related Interests

Uses PostgreSQL `similarity()` function for trigram matching:
```typescript
async function findRelatedInterests(topic: string) {
  return db.select().from(interests)
    .where(
      and(
        sql`${interests.topic} != ${topic}`,
        sql`similarity(${interests.topic}, ${topic}) > 0.3`
      )
    )
    .orderBy(desc(sql`similarity(${interests.topic}, ${topic})`))
    .limit(5);
}
```

## Interest Structure

```typescript
interface Interest {
  id: string;                  // UUID
  topic: string;               // Topic name
  score: number;               // 0-10, decimal(4,2)
  priority: number;            // 1-3 (1=high, 3=low)
  source: 'memory_analysis' | 'conversation' | 'reflection' | 'manual';
  lastExplored: Date | null;
  scoreBelowThresholdSince: Date | null;
  createdAt: Date;
}
```

## Database Schema

```sql
CREATE TABLE cf_kristina_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  score DECIMAL(4,2) NOT NULL DEFAULT '5.00',
  priority INTEGER NOT NULL DEFAULT 3,
  source TEXT NOT NULL CHECK (source IN ('memory_analysis', 'conversation', 'reflection', 'manual')),
  last_explored TIMESTAMPTZ,
  score_below_threshold_since TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX interests_score_idx ON cf_kristina_interests(score);
CREATE INDEX interests_topic_idx ON cf_kristina_interests(topic);
```

## Testing

- Unit tests for decay algorithm (linear, not exponential)
- Unit tests for growth (+0.5 per exploration)
- Cross-pollination tests (+0.2 boost)
- Archival threshold tests (below 2 for 30 days)
