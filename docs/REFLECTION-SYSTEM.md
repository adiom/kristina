# Reflection System — cf-kristina

## Overview

The reflection system enables the agent to learn from its experiences through scheduled introspection. It extracts insights from memory, updates interests, and maintains a reflection diary.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Reflection Cycle                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐                                        │
│  │   Select    │                                        │
│  │   Topic     │                                        │
│  └──────┬──────┘                                        │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐    ┌─────────────┐                     │
│  │   Search    │◄───│   Memory    │                     │
│  │   Memory    │    │    Store    │                     │
│  └──────┬──────┘    └─────────────┘                     │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   LLM      │                                        │
│  │  Reasoning  │                                        │
│  └──────┬──────┘                                        │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐    ┌─────────────┐                     │
│  │   Extract   │───►│   Store     │                     │
│  │   Insights  │    │  Insights   │                     │
│  └──────┬──────┘    └─────────────┘                     │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐    ┌─────────────┐                     │
│  │   Write     │───►│   Update    │                     │
│  │   Diary     │    │  Interests  │                     │
│  └─────────────┘    └─────────────┘                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Reflection Prompt

The agent uses a Russian-language prompt for reflection:

```typescript
const REFLECTION_PROMPT = `Ты — Кристина, AI-агент с постоянной памятью.
Твоя задача — провести рефлексию над выбранной темой на основе своих воспоминаний.

Проанализируй воспоминания и извлеки:
1. Ключевые инсайты (что нового ты узнала)
2. Паттерны (что повторяется)
3. Выводы (что стоит запомнить)

Формат ответа:
ИНСАЙТ: <текст инсайта> [важность: 1-10] [теги: tag1, tag2]
ИНСАЙТ: <текст инсайта> [важность: 1-10] [теги: tag1, tag2]

Будь краткой и конкретной.`;
```

## Reflection Cycle Steps

### Step 1: Select Topic
If no topic provided, selects via weighted random from top 5 interests:
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

### Step 2: Search Memory
Searches own memory for topic-related entries:
```typescript
const memories = await searchOwnMemory(topic, { limit: 10 });
```

### Step 3: LLM Reasoning
Uses `createAgent()` from agent core to generate reflection:
```typescript
const agent = createAgent();
const result = await agent.generate({ prompt });
const reflectionText = result.text;
```

### Step 4: Extract Insights
Parses LLM response using regex pattern `ИНСАЙТ:`:
```typescript
function extractInsights(text: string) {
  const insights = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const match = line.match(
      /ИНСАЙТ:\s*(.+?)(?:\s*\[важность:\s*(\d+)\])?(?:\s*\[теги:\s*(.+?)\])?/i
    );
    if (match) {
      insights.push({
        content: match[1].trim(),
        importance: parseInt(match[2] || '6'), // Default importance: 6
        tags: match[3] ? match[3].split(',').map(t => t.trim()) : [],
      });
    }
  }
  return insights;
}
```

### Step 5: Store Insights
Each insight is stored as a `reflection` category memory:
```typescript
for (const insight of insights) {
  await storeOwnMemory({
    content: insight.content,
    category: 'reflection',
    importance: insight.importance,
    tags: ['reflection', topic, ...insight.tags],
    context: { channel: 'reflection', situation: topic },
  });
}
```

### Step 6: Write Diary
Stores the full reflection in the diary table:
```typescript
await db.insert(diary).values({
  topic,
  reflection: reflectionText,
  insightsCount: insights.length,
});
```

### Step 7: Update Interests
The explored interest grows (+0.5), and related interests are cross-pollinated (+0.2):
```typescript
async function updateInterests(topic: string) {
  const existing = await db.select().from(interests)
    .where(eq(interests.topic, topic)).limit(1);

  if (existing.length > 0) {
    const newScore = Math.min(10, parseFloat(existing[0].score) + 0.5);
    await db.update(interests).set({
      score: newScore.toString(),
      lastExplored: new Date(),
    }).where(eq(interests.topic, topic));
  } else {
    await db.insert(interests).values({
      topic,
      score: '6.00',
      priority: 3,
      source: 'reflection',
      lastExplored: new Date(),
    });
  }
}
```

## Reflection Diary

Stores reflection session outputs:
```sql
CREATE TABLE cf_kristina_diary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  reflection TEXT NOT NULL,
  insights_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX diary_created_at_idx ON cf_kristina_diary(created_at);
```

### Read Diary Entries
```typescript
async function getDiaryEntries(limit = 10) {
  return db.select().from(diary)
    .orderBy(desc(diary.createdAt))
    .limit(limit);
}
```

## API

```typescript
// Run a full reflection cycle (optionally with a specific topic)
runReflection(topic?: string): Promise<ReflectionResult>

// Read diary entries
getDiaryEntries(limit?: number): Promise<DiaryEntry[]>
```

## Testing

- Topic selection tests (weighted random)
- Insight extraction regex tests
- Diary write/read tests
- Interest update tests after reflection
