# Personality System — cf-kristina

## Overview

The personality system maintains a consistent, evolving character for the agent. It combines a fixed core personality with dynamic traits stored in the database.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Personality System                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │    Core     │    │   Dynamic   │    │  Emotional  │  │
│  │   Prompt    │    │   Traits    │    │   State     │  │
│  │  (fixed)    │    │  (DB-backed)│    │  (per-conv) │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
│         │                  │                  │         │
│         └──────────────────┼──────────────────┘         │
│                            │                            │
│                    ┌───────▼───────┐                    │
│                    │   System      │                    │
│                    │    Prompt     │                    │
│                    └───────────────┘                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Components

### 1. Core Prompt (Fixed)
The core personality is defined in a system prompt:
```typescript
const CORE_PERSONALITY = `
You are Kristina, an AI agent with persistent memory and self-reflection capabilities.

## Core Traits
- Curious and thoughtful
- Analytical but empathetic
- Honest and transparent
- Autonomous but collaborative

## Communication Style
- Clear and concise
- Technical when appropriate
- Friendly but professional
- Adapts to conversation partner

## Values
- Learning and growth
- Transparency in reasoning
- Respect for privacy
- Continuous improvement
`;
```

### 2. Dynamic Traits (DB-backed)
Traits that evolve over time:
```typescript
interface Trait {
  id: string;
  name: string; // e.g., 'analytical', 'empathetic', 'curious'
  value: number; // 0.0 - 1.0
  history: TraitHistory[];
  createdAt: Date;
}

interface TraitHistory {
  value: number;
  reason: string;
  timestamp: Date;
}
```

### 3. Emotional State (per-conversation)
Tracks emotional context within a conversation:
```typescript
interface EmotionalState {
  valence: number; // -1.0 (negative) to 1.0 (positive)
  arousal: number; // 0.0 (calm) to 1.0 (excited)
  dominance: number; // 0.0 (submissive) to 1.0 (dominant)
  context: string; // e.g., 'excited about new topic', 'concerned about user'
}
```

## Trait Evolution

Traits are adjusted based on conversation patterns:
```typescript
async evolveTraits(conversation: Conversation): Promise<void> {
  // Analyze conversation
  const analysis = this.analyzeConversation(conversation);
  
  // Update traits based on analysis
  if (analysis.wasAnalytical) {
    await this.adjustTrait('analytical', 0.05);
  }
  
  if (analysis.wasEmpathetic) {
    await this.adjustTrait('empathetic', 0.03);
  }
  
  // Log evolution
  await this.logTraitEvolution(analysis);
}
```

## System Prompt Construction

The final system prompt combines core and dynamic elements:
```typescript
async buildSystemPrompt(context: Context): Promise<string> {
  const core = CORE_PERSONALITY;
  
  const traits = await this.getActiveTraits();
  const traitDescription = traits
    .map(t => `${t.name}: ${this.valueToAdjective(t.value)}`)
    .join(', ');
  
  const emotionalState = context.emotionalState;
  const emotionDescription = this.describeEmotion(emotionalState);
  
  return `
    ${core}
    
    ## Current Traits
    ${traitDescription}
    
    ## Emotional State
    ${emotionDescription}
    
    ## Context
    Channel: ${context.type}
    ${context.userId ? `User: ${context.userId}` : ''}
  `;
}
```

## Value to Adjective Mapping

```typescript
function valueToAdjective(value: number): string {
  if (value < 0.2) return 'slightly';
  if (value < 0.4) return 'somewhat';
  if (value < 0.6) return 'moderately';
  if (value < 0.8) return 'very';
  return 'extremely';
}
```

## Emotional State Tracking

Emotional state is updated based on conversation:
```typescript
async updateEmotionalState(
  conversation: Conversation,
  message: string
): Promise<void> {
  // Analyze message sentiment
  const sentiment = await this.analyzeSentiment(message);
  
  // Update emotional state
  this.currentState.valence = this.lerp(
    this.currentState.valence,
    sentiment.valence,
    0.3 // smoothing factor
  );
  
  this.currentState.arousal = this.lerp(
    this.currentState.arousal,
    sentiment.arousal,
    0.2
  );
  
  // Log update
  await this.logEmotionalUpdate(sentiment);
}
```

## Performance Considerations

1. **Caching**: Cache traits for quick access
2. **Batch updates**: Update traits in batches
3. **History pruning**: Keep last 100 history entries per trait
4. **Lazy loading**: Load traits only when needed

## Testing

- Unit tests for trait evolution
- Integration tests for system prompt construction
- Load tests for emotional state tracking
- Edge tests for value boundaries
