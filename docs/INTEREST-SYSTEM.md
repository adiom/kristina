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
│  │  Generate   │    │   Evolve    │    │   Select    │  │
│  │  from       │    │  (decay/    │    │  for        │  │
│  │  Memory     │    │   growth)   │    │  Reflection │  │
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

## Interest Lifecycle

### 1. Generation
Interests are generated from memory analysis:
```typescript
async generateFromMemory(): Promise<void> {
  // Analyze recent memories
  const recentMemories = await this.memory.getRecent(100);
  
  // Extract topics
  const topics = this.extractTopics(recentMemories);
  
  // Create interests for new topics
  for (const topic of topics) {
    const existing = await this.getByTopic(topic);
    if (!existing) {
      await this.create({
        topic,
        score: 5.0, // Initial score
        priority: this.calculatePriority(topic),
        source: 'memory_analysis'
      });
    }
  }
}
```

### 2. Growth
Interests grow when explored:
```typescript
async explore(topic: string): Promise<void> {
  const interest = await this.getByTopic(topic);
  
  // Growth: +1.0 (max 10)
  const newScore = Math.min(interest.score + 1.0, 10);
  
  await this.update(interest.id, {
    score: newScore,
    lastExplored: new Date()
  });
}
```

### 3. Decay
Interests decay over time:
```typescript
async applyDecay(): Promise<void> {
  const interests = await this.getAll();
  
  for (const interest of interests) {
    // Decay: -0.1 per day (7-day half-life)
    const daysSinceLastExplore = this.daysSince(interest.lastExplored);
    const decayFactor = Math.pow(0.5, daysSinceLastExplore / 7);
    const newScore = interest.score * decayFactor;
    
    await this.update(interest.id, { score: newScore });
  }
}
```

### 4. Cross-Pollination
Related interests grow when one is explored:
```typescript
async crossPollinate(targetTopic: string, sourceTopic: string): Promise<void> {
  const target = await this.getByTopic(targetTopic);
  const source = await this.getByTopic(sourceTopic);
  
  // Calculate similarity
  const similarity = await this.calculateSimilarity(targetTopic, sourceTopic);
  
  // Growth based on similarity
  const growth = similarity * 0.5; // Max 0.5
  const newScore = Math.min(target.score + growth, 10);
  
  await this.update(target.id, { score: newScore });
}
```

### 5. Archival
Interests below threshold for 30 days are archived:
```typescript
async archiveOldInterests(): Promise<void> {
  const interests = await this.getAll();
  
  for (const interest of interests) {
    if (interest.score < 2) {
      const daysBelowThreshold = this.daysSince(
        interest.scoreBelowThresholdSince || interest.createdAt
      );
      
      if (daysBelowThreshold >= 30) {
        await this.archive(interest.id);
      }
    } else {
      // Reset threshold tracking
      await this.update(interest.id, {
        scoreBelowThresholdSince: null
      });
    }
  }
}
```

## Interest Selection for Reflection

Topics are selected based on a weighted score:
```typescript
async selectTopic(): Promise<string> {
  const interests = await this.getActive();
  
  const scored = interests.map(i => ({
    ...i,
    selectionScore: 
      (i.priority * 3) + 
      (this.recentRelevance(i) * 2) + 
      (this.growthPotential(i) * 1.5)
  }));
  
  // Sort by score
  scored.sort((a, b) => b.selectionScore - a.selectionScore);
  
  // Weighted random from top 5
  const top5 = scored.slice(0, 5);
  const totalScore = top5.reduce((sum, i) => sum + i.selectionScore, 0);
  const random = Math.random() * totalScore;
  
  let cumulative = 0;
  for (const interest of top5) {
    cumulative += interest.selectionScore;
    if (random <= cumulative) {
      return interest.topic;
    }
  }
  
  return top5[0].topic;
}
```

## Interest Structure

```typescript
interface Interest {
  id: string;
  topic: string;
  score: number; // 0-10
  priority: number; // 1-5
  source: 'memory_analysis' | 'conversation' | 'reflection' | 'manual';
  lastExplored: Date | null;
  scoreBelowThresholdSince: Date | null;
  createdAt: Date;
}
```

## Performance Considerations

1. **Batch processing**: Apply decay/growth in batches
2. **Caching**: Cache top interests for quick selection
3. **Indexing**: Index on score and lastExplored
4. **Throttling**: Max 1 growth per 5 minutes per interest

## Testing

- Unit tests for decay/growth algorithms
- Integration tests for cross-pollination
- Load tests for interest selection
- Edge tests for archival thresholds
