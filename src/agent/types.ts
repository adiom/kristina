/**
 * Core data models for the cf-kristina agent runtime.
 *
 * These types define the contract between any external service (Sfera, a
 * news-site, a chat bot, a simulation) and the agent itself.  The agent
 * receives an {@link AgentContext} describing where the request came from
 * and returns an {@link AgentResult} that the caller can render or store.
 *
 * Nothing in this file touches I/O – it is pure data so that transports
 * (HTTP, MCP, WebSocket) and adapters can share the same shape.
 */

export type AgentSource = 'sfera' | 'http' | 'ws' | 'sim';

export type AgentResponseMode =
  | 'public'
  | 'private'
  | 'analysis'
  | 'action'
  | 'draft';

export type AgentTrigger = 'mention' | 'command' | 'event' | 'system';

export type AgentNamespace = 'own' | 'user' | 'space' | 'service';

export interface MemoryAccess {
  /** Read the agent's own (userId=NULL) memory. */
  own: boolean;
  /** Read memory scoped to {@link AgentContext.userId}. */
  user: boolean;
  /** Read memory scoped to {@link AgentContext.spaceId}. */
  space: boolean;
  /** Read memory scoped to {@link AgentContext.serviceId}. */
  service: boolean;
  /** Whether the agent may persist new memories for this context. */
  write: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  author?: string;
  content: string;
}

/**
 * The full event payload an external service sends to the agent.
 *
 * It captures *where* the request came from, *who* triggered it, and
 * *how* the agent is allowed to behave.  Adapters are responsible for
 * filling this in correctly – the agent does not assume anything about
 * the calling service beyond what is declared here.
 */
export interface AgentContext {
  source: AgentSource;
  /** Stable identifier of the external service (e.g. "avrora-sfera"). */
  serviceId: string;
  /** Human readable service name – optional, used in the system prompt. */
  serviceName?: string;
  /** Identifier of the conversation space (sfera id, chat id, simulation id). */
  spaceId: string;
  spaceName?: string;
  /** User identifier within the service. */
  userId?: string;
  userName?: string;
  /** Last few messages for situational awareness. */
  conversationHistory?: ConversationMessage[];
  /** Why the agent is being called. */
  trigger: AgentTrigger;
  /** Desired output style. */
  responseMode: AgentResponseMode;
  /** Which memory namespaces the agent may read/write. */
  memoryAccess: MemoryAccess;
}

export type AgentResultType =
  | 'message'
  | 'analysis'
  | 'question'
  | 'warning'
  | 'action'
  | 'observation';

export interface MemoryToStore {
  content: string;
  category: string;
  importance: number;
  tags: string[];
}

export interface AgentSourceRef {
  id: string;
  snippet: string;
  similarity: number;
}

export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * The structured response the agent returns.  The caller (service) is free
 * to render {@link text} directly or to act on {@link actions}.
 */
export interface AgentResult {
  text: string;
  type: AgentResultType;
  /** Optional self‑estimated confidence in 0..1. */
  confidence?: number;
  /** Memories the agent thinks should be persisted. */
  memoryToStore?: MemoryToStore[];
  /** Memory entries the agent used to compose the answer. */
  sources?: AgentSourceRef[];
  /** Optional tool invocations the agent wants the caller to execute. */
  actions?: AgentAction[];
  /** Free‑form metadata (tokens, model, latency, etc.). */
  metadata?: Record<string, unknown>;
}

/** Lightweight event type for internal activity logging. */
export interface AgentEvent {
  type: string;
  details?: Record<string, unknown>;
}
