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
│  │   Trigger    │                                        │
│  │  (scheduled │                                        │
│  │   or interest│                                        │
│  │   driven)   │                                        │
│  └──────┬──────┘                                        │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐    ┌─────────────┐                     │
│  │   Select    │◄───│  Interests  │                     │
│  │   Topic     │    │   System    │                     │
│  └──────┬──────┘    └─────────────┘                     │
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

## Triggers

### 1. Scheduled Trigger
- **Frequency**: Every 30 minutes
- **Condition**: Always runs (if agent is active)
- **Priority**: Low

### 2. Interest-Driven Trigger
- **Frequency**: Checked every 5 minutes
- **Condition**: Any interest score > 7.0
- **Priority**: Medium

### 3. Manual Trigger
- **Frequency**: On-demand
- **Condition**: User/operator requests reflection
- **Priority**: High

## Topic Selection

Topics are selected based on interest scores:
```typescript
async selectTopic(): Promise<string> {
  const interests = await this.interests.getTopInterests(5);
  
  // Weighted random selection
  const totalScore = interests.reduce((sum, i) => sum + i.score, 0);
  const random = Math.random() * totalScore;
  
  let cumulative = 0;
  for (const interest of interests) {
    cumulative += interest.score;
    if (random <= cumulative) {
      return interest.topic;
    }
  }
  
  return interests[0].topic;
}
```

## Reflection Cycle Steps

### Step 1: Select Topic
- Get top interests by score
- Weighted random selection
- Log selection

### Step 2: Search Memory
- Search for memories related to topic
- Get top 5-10 most relevant memories
- Include recent memories (last 7 days)

### Step 3: LLM Reasoning
```typescript
const reflection = await this.brain.reason({
  systemPrompt: REFLECTION_SYSTEM_PROMPT,
  message: `Исследуй тему: ${topic}. 
    Используй следующие воспоминания:
    ${memories.map(m => `- ${m.content}`).join('\n')}
    
    Извлеки инсайты и паттерны.`,
  tools: ['searchOwnMemory', 'storeOwnMemory']
});
```

### Step 4: Extract Insights
- Parse LLM response
- Identify key insights
- Score importance (6-8 for reflection insights)
- Generate tags

### Step 5: Store Insights
```typescript
for (const insight of insights) {
  await this.memory.storeOwnMemory({
    content: insight,
    category: 'reflection',
    importance: insight.importance,
    tags: ['reflection', topic],
    context: { channel: 'reflection', topic }
  });
}
```

### Step 6: Write Diary
```typescript
await this.diary.write({
  topic,
  reflection,
  insights: insights.length,
  timestamp: new Date()
});
```

### Step 7: Update Interests
```typescript
// Interest that was explored grows
await this.interests.explore(topic);

// Related interests get cross-pollination
const related = await this.interests.findRelated(topic);
for (const r of related) {
  await this.interests.crossPollinate(r.topic, topic);
}
```

## Reflection Diary

Stores reflection session outputs:
```typescript
interface DiaryEntry {
  id: string;
  topic: string;
  reflection: string;
  insightsCount: number;
  createdAt: Date;
}
```

## Performance Considerations

1. **Throttling**: Max 1 reflection per 10 minutes
2. **Queue**: Use Redis queue for reflection jobs
3. **Batch processing**: Process multiple interests in one cycle
4. **Caching**: Cache reflection results for frequently explored topics

## Testing

- Unit tests for topic selection
- Integration tests for full reflection cycle
- Load tests for concurrent reflections
- Edge tests for interest thresholds
