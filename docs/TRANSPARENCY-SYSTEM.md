# Transparency System — cf-kristina

## Overview

The transparency system logs all agent actions and provides a dashboard for operators to inspect reasoning, memory, and decision-making processes.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 Transparency System                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  Activity   │    │  Dashboard  │    │   Stats     │  │
│  │    Log      │    │     UI      │    │   API       │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
│         │                  │                  │         │
│         └──────────────────┼──────────────────┘         │
│                            │                            │
│                    ┌───────▼───────┐                    │
│                    │  PostgreSQL   │                    │
│                    │   (buffered)  │                    │
│                    └───────────────┘                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Activity Logging

All agent actions are logged to the `activity_log` table with buffered writes:

```typescript
interface ActivityEvent {
  type: string;
  channel?: string;
  details?: Record<string, any>;
  context?: { channel?: string; userId?: string };
}
```

## Buffered Writes

To optimize database performance, activity events are buffered:

```typescript
let activityBuffer: ActivityEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;

const FLUSH_INTERVAL = 5000;  // 5 seconds
const MAX_BUFFER_SIZE = 50;    // Max events before flush

async function logActivity(event: ActivityEvent) {
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
      events.map(e => ({
        type: e.type,
        details: e.details,
        context: { channel: e.channel, ...e.context },
      }))
    );
  } catch (err) {
    console.error('[Activity] Failed to flush:', err);
    activityBuffer = [...events, ...activityBuffer]; // Re-queue on failure
  }
}
```

## Logged Events

```typescript
type ActivityType =
  | 'message_received'    // Incoming message
  | 'message_sent'        // Agent response
  | 'memory_stored'       // Memory entry saved
  | 'memory_searched'     // Vector search executed
  | 'reflection_started'  // Reflection cycle started
  | 'reflection_completed'// Reflection cycle completed
  | 'interest_generated'  // New interest created
  | 'interest_evolved'    // Interest score changed
  | 'decision_made';      // Action decision with reasoning
```

## Query Activity Log

```typescript
async function getActivityLog(filters?: {
  type?: string;
  since?: Date;
  limit?: number;
}) {
  const conditions = [];

  if (filters?.type) {
    conditions.push(eq(activityLog.type, filters.type));
  }
  if (filters?.since) {
    conditions.push(gte(activityLog.timestamp, filters.since));
  }

  const query = db.select().from(activityLog)
    .orderBy(desc(activityLog.timestamp));

  if (conditions.length > 0) {
    query.where(and(...conditions));
  }

  return query.limit(filters?.limit || 100);
}
```

## Activity Statistics

Get aggregated counts by type and channel:

```typescript
async function getStats(period: 'hour' | 'day' | 'week' = 'day') {
  const since = new Date();
  switch (period) {
    case 'hour': since.setHours(since.getHours() - 1); break;
    case 'day':  since.setDate(since.getDate() - 1); break;
    case 'week': since.setDate(since.getDate() - 7); break;
  }

  const logs = await db.select().from(activityLog)
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
```

## Dashboard Components

### 1. Memory Browser
Search and inspect memory entries:
- Filter by category, user, date
- View similarity scores
- Inspect context and tags

### 2. Reflection Timeline
View reflection sessions over time:
- Topic and insights count
- Duration and triggers
- Linked memories

### 3. Interest Graph
Visualize interest evolution:
- Score over time
- Cross-pollination links
- Archival history

### 4. Activity Feed
Recent agent actions:
- Message received/sent
- Memory operations
- Reflection cycles
- Interest changes

## Database Schema

```sql
CREATE TABLE cf_kristina_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL CHECK (type IN (
    'message_received', 'message_sent', 'memory_stored', 'memory_searched',
    'reflection_started', 'reflection_completed', 'interest_generated',
    'interest_evolved', 'decision_made'
  )),
  context JSONB,
  details JSONB
);

CREATE INDEX activity_log_timestamp_idx ON cf_kristina_activity_log(timestamp);
CREATE INDEX activity_log_type_idx ON cf_kristina_activity_log(type);
```

## API Endpoints

### Dashboard Data
```typescript
GET /api/dashboard
GET /api/dashboard?extended=1  // Includes per-service stats
```

### Activity Log
```typescript
// Get activity log with filters
getActivityLog(filters?: { type?: string; since?: Date; limit?: number })

// Get aggregated stats
getStats(period?: 'hour' | 'day' | 'week')
```

## Planned: WebSocket Real-Time Updates

WebSocket integration for real-time dashboard updates is planned but not yet implemented. Current options being considered:
- Vercel KV (Redis) for pub/sub
- Server-Sent Events (SSE)
- Polling for MVP

## Performance Considerations

1. **Buffered writes**: Max 50 events or 5-second flush interval
2. **Indexing**: Indexes on timestamp and type
3. **Pagination**: Default limit 100 for log queries
4. **Failure handling**: Events re-queued on database failure

## Privacy Considerations

1. **User data**: User IDs stored in context
2. **Secrets**: Never logged (memory scanning before storage)
3. **Access control**: Dashboard accessible to operators

## Testing

- Unit tests for buffered writes
- Flush interval tests
- Activity log query tests
- Stats aggregation tests
