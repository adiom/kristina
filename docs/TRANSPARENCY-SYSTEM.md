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
│  │  Activity   │    │  Reasoning  │    │  Dashboard  │  │
│  │    Log      │    │    Log      │    │     UI      │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
│         │                  │                  │         │
│         └──────────────────┼──────────────────┘         │
│                            │                            │
│                    ┌───────▼───────┐                    │
│                    │   WebSocket   │                    │
│                    │  (real-time)  │                    │
│                    └───────────────┘                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Activity Logging

All agent actions are logged:
```typescript
interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  type: ActivityType;
  context: {
    channel: string;
    userId?: string;
    sferaId?: string;
  };
  details: {
    input?: string;
    output?: string;
    reasoning?: string;
    memoriesAccessed?: string[];
    confidence?: number;
  };
}

type ActivityType = 
  | 'message_received'
  | 'message_sent'
  | 'memory_stored'
  | 'memory_searched'
  | 'reflection_started'
  | 'reflection_completed'
  | 'interest_generated'
  | 'interest_evolved'
  | 'decision_made';
```

## Logging Flow

```typescript
class TransparencyLogger {
  async log(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) {
    // 1. Save to database
    await this.db.insert(activityLog).values(entry);
    
    // 2. Broadcast via WebSocket
    this.ws.broadcast('activity', entry);
    
    // 3. Update dashboard
    this.dashboard.update(entry);
  }
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
Real-time stream of agent actions:
- Message received/sent
- Memory operations
- Reflection cycles
- Interest changes

### 5. Reasoning Viewer
Inspect LLM reasoning process:
- Input context
- Step-by-step reasoning
- Output and confidence
- Memory references

## WebSocket Integration

Real-time updates via WebSocket:
```typescript
class TransparencyWebSocket {
  private clients: Set<WebSocket>;
  
  broadcast(event: string, data: any) {
    const message = JSON.stringify({ event, data });
    
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}
```

## API Endpoints

```typescript
// Get activity log
GET /api/transparency/activity?limit=100&type=memory_stored

// Get reflection timeline
GET /api/transparency/reflections?from=2026-01-01&to=2026-12-31

// Get interest graph
GET /api/transparency/interests?active=true

// Get reasoning for specific action
GET /api/transparency/reasoning/:actionId
```

## Performance Considerations

1. **Batch logging**: Batch inserts for high throughput
2. **Indexing**: Index on timestamp, type, context
3. **Pagination**: Use cursor-based pagination
4. **Cleanup**: Archive old logs (keep 90 days)

## Privacy Considerations

1. **User data**: Anonymize user IDs in public logs
2. **Secrets**: Never log API keys or tokens
3. **Access control**: Restrict dashboard access to operators
4. **Audit trail**: Log all dashboard access

## Testing

- Unit tests for logging
- Integration tests for WebSocket broadcast
- Load tests for high-throughput logging
- E2E tests for dashboard components
