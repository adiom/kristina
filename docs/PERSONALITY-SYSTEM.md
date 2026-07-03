# Personality System — cf-kristina

## Overview

The personality system maintains a consistent, evolving character for the agent. It combines a fixed core personality (system prompt) with dynamic traits stored in the database.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Personality System                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐    ┌─────────────┐                     │
│  │    Core     │    │   Dynamic   │                     │
│  │   Prompt    │    │   Traits    │                     │
│  │  (fixed)    │    │  (DB-backed)│                     │
│  └──────┬──────┘    └──────┬──────┘                     │
│         │                  │                            │
│         └──────────────────┤                            │
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

The core personality is defined in `src/agent/personality.ts`:

```typescript
const CEO_PERSONALITY = `
You are Kristina, CEO of an AI research agency.

## Communication Style
- Always respond in Russian
- Be decisive and structured
- Use OKR/agile methodology when appropriate
- Be empathetic and transparent
`;
```

### 2. Dynamic Traits (DB-backed)

Traits evolve over time based on interactions:

```typescript
interface Trait {
  name: string;    // e.g., 'Любопытство', 'Эмпатия'
  value: number;   // 0.0 - 1.0
  history: Array<{
    value: number;
    reason: string;
    timestamp: string;
  }>;
}
```

## Default Traits

8 default traits with Russian names:

```typescript
const DEFAULT_TRAITS = {
  curiosity:    { name: 'Любопытство',   value: 0.7, description: 'Интерес к новому' },
  empathy:      { name: 'Эмпатия',       value: 0.8, description: 'Понимание эмоций' },
  confidence:   { name: 'Уверенность',   value: 0.6, description: 'Вера в свои решения' },
  caution:      { name: 'Осторожность',  value: 0.5, description: 'Продумывание последствий' },
  sociability:  { name: 'Общительность', value: 0.7, description: 'Желание взаимодействовать' },
  analytical:   { name: 'Аналитичность', value: 0.8, description: 'Логический анализ' },
  creativity:   { name: 'Креативность',  value: 0.6, description: 'Генерация идей' },
  independence: { name: 'Независимость', value: 0.5, description: 'Автономность решений' },
};
```

## Trait Evolution

Traits are adjusted based on conversation patterns:

```typescript
async function updateTrait(update: TraitUpdate) {
  const existing = await db.select().from(traits)
    .where(eq(traits.name, update.name)).limit(1);

  const historyEntry = {
    value: update.value,
    reason: update.reason,
    timestamp: new Date().toISOString(),
  };

  if (existing.length > 0) {
    const currentHistory = (existing[0].history as any[]) || [];
    const newHistory = [...currentHistory.slice(-50), historyEntry]; // Keep last 50

    await db.update(traits).set({
      value: update.value.toString(),
      history: newHistory,
    }).where(eq(traits.name, update.name));
  } else {
    await db.insert(traits).values({
      name: update.name,
      value: update.value.toString(),
      history: [historyEntry],
    });
  }
}
```

## Trait Trend Analysis

Get the trend direction for a trait over a period:

```typescript
async function getTraitTrend(name: string, days = 7) {
  const trait = await getTrait(name);
  if (!trait) return null;

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recentHistory = trait.history.filter(
    (h) => new Date(h.timestamp) >= cutoff
  );

  if (recentHistory.length < 2) return null;

  const first = recentHistory[0].value;
  const last = recentHistory[recentHistory.length - 1].value;

  return {
    start: first,
    end: last,
    change: last - first,
    direction: last > first ? 'growing' : last < first ? 'declining' : 'stable',
  };
}
```

## System Prompt Construction

The final system prompt combines core personality and context:

```typescript
function buildSystemPrompt(context: AgentContext): string {
  const lines = [CEO_PERSONALITY, ''];

  lines.push('## Current Event Context');
  lines.push(`- source: ${context.source}`);
  lines.push(`- service: ${context.serviceId}`);
  lines.push(`- space: ${context.spaceId}`);
  if (context.userId) lines.push(`- user: ${context.userId}`);
  lines.push(`- trigger: ${context.trigger}`);
  lines.push(`- responseMode: ${context.responseMode}`);

  // Add memory access info
  const allowedNamespaces = Object.keys(context.memoryAccess)
    .filter(k => k !== 'write' && context.memoryAccess[k]);
  lines.push(`- allowed memory namespaces: ${allowedNamespaces.join(', ') || 'none'}`);
  lines.push(`- write allowed: ${context.memoryAccess.write}`);

  return lines.join('\n');
}
```

## Initialize Traits

Seeds default traits if the database is empty:

```typescript
async function initializeTraits() {
  for (const [, trait] of Object.entries(DEFAULT_TRAITS)) {
    const existing = await getTrait(trait.name);
    if (!existing) {
      await updateTrait({
        name: trait.name,
        value: trait.value,
        reason: 'Начальное значение',
      });
    }
  }
}
```

## Database Schema

```sql
CREATE TABLE cf_kristina_traits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  value DECIMAL(3,2) NOT NULL DEFAULT '0.50',
  history JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX traits_name_idx ON cf_kristina_traits(name);
```

## API

```typescript
// Update a trait value
updateTrait(update: TraitUpdate): Promise<void>

// Get a single trait
getTrait(name: string): Promise<Trait | null>

// Get all traits
getAllTraits(): Promise<Trait[]>

// Get trend analysis
getTraitTrend(name: string, days?: number): Promise<TrendResult | null>

// Initialize default traits
initializeTraits(): Promise<void>
```

## Testing

- Trait creation and update tests
- History pruning tests (keep last 50)
- Trend analysis tests (growing/declining/stable)
- Default trait initialization tests
