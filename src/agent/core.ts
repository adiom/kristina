/**
 * Agent core for cf-kristina.
 *
 * This module owns **all** of the agent's intelligence:
 *   – personality (system prompt)
 *   – memory retrieval
 *   – reasoning / LLM call
 *   – activity logging
 *   – optional memory persistence
 *
 * External transports (HTTP, MCP, WebSocket) must go through
 * {@link processAgent} – they should not import or instantiate
 * `ToolLoopAgent` directly.  Keeping a single entry point makes it
 * trivial to add policy checks, tests or alternate model backends later.
 */

import { ToolLoopAgent, tool } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import { CEO_PERSONALITY } from './personality';
import type { AgentContext, AgentResult } from './types';
import {
  searchOwnMemory,
  searchUserMemory,
  searchSpaceMemory,
  searchServiceMemory,
  storeOwnMemory,
  storeUserMemory,
  storeSpaceMemory,
  storeServiceMemory,
} from '../memory/store';
import { logActivity } from '../transparency';
import {
  validateContext,
  canAccessMemory,
  assertWriteAllowed,
  checkRateLimit,
} from '../policy';
import {
  isExplicitMemoryRequest,
  extractExplicitContent,
  extractMemories,
  persistAutoMemories,
  persistExplicitMemory,
} from '../memory/extractor';

// Provider selection: GROQ (cloud, faster, larger models) or LM Studio (local)
const provider = process.env.LLM_PROVIDER || 'lmstudio';

function getModel() {
  if (provider === 'groq') {
    const groq = createGroq({
      apiKey: process.env.GROQ_API_KEY,
    });
    return groq('qwen/qwen3-32b');
  }
  // Default: LM Studio (local)
  const lmstudio = createOpenAICompatible({
    name: 'lmstudio',
    baseURL: process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
  });
  return lmstudio('qwen/qwen3-1.7b');
}

const model = getModel();

/**
 * The agent tool that the LLM can call.  We keep the tools minimal
 * because all real "thinking" happens in {@link processAgent}; the
 * tools below just give the LLM a structured way to declare what it
 * has memorised so the runtime can persist it.
 */
const tools = {
  searchOwnMemory: tool({
    description: 'Search the agent own knowledge base for relevant facts.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      category: z
        .enum(['insight', 'pattern', 'knowledge', 'decision', 'reflection'])
        .optional(),
    }),
    execute: async ({ query, category }) => {
      const results = await searchOwnMemory(query, { category });
      await logActivity({
        type: 'memory_searched',
        channel: 'agent',
        details: { query, category, count: results.length, scope: 'own' },
      });
      return results.map((r) => ({
        content: r.content,
        category: r.category,
        importance: r.importance,
        similarity: r.similarity,
      }));
    },
  }),

  searchUserMemory: tool({
    description: 'Search memory about a specific user.',
    inputSchema: z.object({
      userId: z.string().describe('The user ID'),
      query: z.string().describe('The search query'),
    }),
    execute: async ({ userId, query }) => {
      const results = await searchUserMemory(userId, query);
      await logActivity({
        type: 'memory_searched',
        channel: 'agent',
        details: { userId, query, count: results.length, scope: 'user' },
      });
      return results.map((r) => ({
        content: r.content,
        category: r.category,
        importance: r.importance,
        similarity: r.similarity,
      }));
    },
  }),

  storeMemory: tool({
    description: 'Persist a new memory entry. Use sparingly.',
    inputSchema: z.object({
      content: z.string(),
      category: z.enum([
        'insight',
        'pattern',
        'knowledge',
        'decision',
        'reflection',
      ]),
      importance: z.number().min(1).max(10),
      tags: z.array(z.string()).optional(),
    }),
    execute: async ({ content, category, importance, tags }) => {
      await storeOwnMemory({ content, category, importance, tags });
      await logActivity({
        type: 'memory_stored',
        channel: 'agent',
        details: { category, importance, tags, contentLength: content.length },
      });
      return { stored: true };
    },
  }),
};

export function createAgent(userId?: string) {
  const instructions = userId
    ? `${CEO_PERSONALITY}\n\n## Current Context\nYou are speaking with user: ${userId}`
    : CEO_PERSONALITY;

  return new ToolLoopAgent({
    model,
    instructions,
    tools,
  });
}

/* ------------------------------------------------------------------ */
/* Structured processing                                               */
/* ------------------------------------------------------------------ */

interface RetrievedMemory {
  id: string;
  content: string;
  category: string;
  importance: number;
  similarity: number;
  source: 'own' | 'user' | 'space' | 'service';
}

async function retrieveMemory(
  prompt: string,
  context: AgentContext,
): Promise<RetrievedMemory[]> {
  const results: RetrievedMemory[] = [];

  if (canAccessMemory(context, 'own')) {
    const own = await searchOwnMemory(prompt, { limit: 5 });
    own.forEach((m) =>
      results.push({ ...m, source: 'own' as const }),
    );
  }

  if (canAccessMemory(context, 'user') && context.userId) {
    const user = await searchUserMemory(context.userId, prompt, { limit: 5 });
    user.forEach((m) =>
      results.push({ ...m, source: 'user' as const }),
    );
  }

  if (canAccessMemory(context, 'space')) {
    const space = await searchSpaceMemory(context.spaceId, prompt, { limit: 5 });
    space.forEach((m) =>
      results.push({ ...m, source: 'space' as const }),
    );
  }

  if (canAccessMemory(context, 'service')) {
    const svc = await searchServiceMemory(
      context.serviceId,
      prompt,
      { limit: 5 },
    );
    svc.forEach((m) =>
      results.push({ ...m, source: 'service' as const }),
    );
  }

  // Deduplicate by content — same memory may exist in multiple namespaces
  const seen = new Set<string>();
  const unique = results.filter((m) => {
    const key = m.content.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await logActivity({
    type: 'memory_searched',
    channel: context.source,
    details: {
      serviceId: context.serviceId,
      spaceId: context.spaceId,
      userId: context.userId,
      count: unique.length,
      duplicatesRemoved: results.length - unique.length,
    },
  });

  return unique;
}

function buildSystemPrompt(context: AgentContext): string {
  const lines: string[] = [CEO_PERSONALITY, ''];

  lines.push('## Current Event Context');
  lines.push(`- source: ${context.source}`);
  lines.push(`- service: ${context.serviceId}${context.serviceName ? ` (${context.serviceName})` : ''}`);
  lines.push(`- space: ${context.spaceId}${context.spaceName ? ` (${context.spaceName})` : ''}`);
  if (context.userId) {
    lines.push(`- user: ${context.userId}${context.userName ? ` (${context.userName})` : ''}`);
  }
  lines.push(`- trigger: ${context.trigger}`);
  lines.push(`- responseMode: ${context.responseMode}`);

  const allowedNamespaces = (
    Object.keys(context.memoryAccess) as Array<keyof typeof context.memoryAccess>
  ).filter((k) => k !== 'write' && (context.memoryAccess as any)[k]);
  lines.push(`- allowed memory namespaces: ${allowedNamespaces.join(', ') || 'none'}`);
  lines.push(`- write allowed: ${context.memoryAccess.write}`);

  if (context.conversationHistory && context.conversationHistory.length > 0) {
    lines.push('', '## Recent Conversation');
    for (const m of context.conversationHistory.slice(-5)) {
      const who = m.author || m.role;
      lines.push(`- [${m.role}] ${who}: ${m.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * Persist any memories the agent decided to store.  The runtime respects
 * {@link AgentContext.memoryAccess.write}: writes are silently skipped
 * (not an error) if the service asked for a read‑only context.
 */
async function persistResultMemory(
  result: AgentResult,
  context: AgentContext,
) {
  if (!result.memoryToStore || result.memoryToStore.length === 0) return;
  if (!context.memoryAccess.write) return;

  for (const entry of result.memoryToStore) {
    try {
      if (canAccessMemory(context, 'user') && context.userId) {
        await storeUserMemory(context.userId, {
          content: entry.content,
          category: entry.category as any,
          importance: entry.importance,
          tags: entry.tags,
          spaceId: context.spaceId,
          service: context.serviceId,
        });
      } else if (canAccessMemory(context, 'space')) {
        await storeSpaceMemory(context.spaceId, {
          content: entry.content,
          category: entry.category as any,
          importance: entry.importance,
          tags: entry.tags,
          userId: context.userId ?? null,
          service: context.serviceId,
        });
      } else if (canAccessMemory(context, 'service')) {
        await storeServiceMemory(context.serviceId, {
          content: entry.content,
          category: entry.category as any,
          importance: entry.importance,
          tags: entry.tags,
          userId: context.userId ?? null,
          spaceId: context.spaceId,
        });
      } else {
        await storeOwnMemory({
          content: entry.content,
          category: entry.category as any,
          importance: entry.importance,
          tags: entry.tags,
          spaceId: context.spaceId,
          service: context.serviceId,
        });
      }
    } catch (err) {
      // Persistence failures must never break the user‑visible response.
      console.error('[processAgent] memory persist failed', err);
    }
  }
}

/**
 * The single entry point every transport (HTTP / MCP / WebSocket) should
 * use.  It performs validation, rate limiting, memory retrieval, the
 * LLM call, logging, and optional memory persistence, and returns a
 * structured {@link AgentResult}.
 */
export async function processAgent(
  prompt: string,
  context: AgentContext,
): Promise<AgentResult> {
  validateContext(context);
  checkRateLimit(context.serviceId);

  await logActivity({
    type: 'message_received',
    channel: context.source,
    details: {
      serviceId: context.serviceId,
      spaceId: context.spaceId,
      userId: context.userId,
      promptLength: prompt.length,
    },
  });

  const memories = await retrieveMemory(prompt, context);

  const systemPrompt = buildSystemPrompt(context);

  // Build a single prompt that injects the retrieved memory snippets
  // (the LLM does not need to call any tool for the MVP – everything it
  // needs is in front of it).  We still keep the tool definitions in
  // case a future model chooses to call them.
  // Limit to 3 snippets — small models (1.7B) get confused by too much context.
  const memorySnippet = memories
    .slice(0, 3)
    .map((m) => `- ${m.content}`)
    .join('\n');

  const fullPrompt = `${prompt}

## Retrieved Memory (используй ТОЛЬКО если directly relevant к вопросу)
${memorySnippet || '(no relevant memory)'}

## ВАЖНО
- Отвечай на вопрос пользователя, а не на содержимое памяти
- Память — это контекст, а не ответ
- Если вопрос про "что видишь" — опиши текущую ситуацию/контекст, а не facts из памяти`;

  console.log('=== LLM DEBUG ===');
  console.log('System Prompt:\n', systemPrompt);
  console.log('Full Prompt:\n', fullPrompt);
  console.log('================');

  const agent = new ToolLoopAgent({
    model,
    instructions: systemPrompt,
    tools,
  });

  const llm = await agent.generate({ prompt: fullPrompt });
  const text = llm.text || '';

  // Best‑effort structured parsing.  If the model returns pure prose we
  // still produce a valid `AgentResult`.
  const result: AgentResult = {
    text,
    type: 'message',
    confidence: undefined,
    sources: memories.map((m) => ({
      id: m.id,
      snippet: m.content,
      similarity: m.similarity,
    })),
    metadata: {
      model: provider === 'groq' ? 'qwen/qwen3-32b' : 'qwen/qwen3-1.7b',
      provider,
      serviceId: context.serviceId,
      spaceId: context.spaceId,
    },
  };

  await logActivity({
    type: 'decision_made',
    channel: context.source,
    details: {
      serviceId: context.serviceId,
      spaceId: context.spaceId,
      userId: context.userId,
      memoryUsed: memories.length,
    },
  });

  // Persist any new knowledge the agent decided to record.
  await persistResultMemory(result, context);

  // Auto-extract significant memories from the conversation
  if (context.memoryAccess.write) {
    try {
      // Check if user explicitly asked to remember something
      if (isExplicitMemoryRequest(prompt)) {
        const explicitContent = extractExplicitContent(prompt);
        if (explicitContent.length > 5) {
          const saved = await persistExplicitMemory(explicitContent, context);
          if (saved) {
            console.log('[processAgent] Explicit memory saved:', explicitContent);
          }
        }
      }

      // Auto-extract memories from the conversation
      const autoMemories = await extractMemories(prompt, text, context);
      if (autoMemories.length > 0) {
        await persistAutoMemories(autoMemories, context);
        console.log(`[processAgent] Auto-extracted ${autoMemories.length} memories`);
      }
    } catch (err) {
      // Memory extraction must never break the response
      console.error('[processAgent] Memory extraction failed:', err);
    }
  }

  await logActivity({
    type: 'message_sent',
    channel: context.source,
    details: {
      serviceId: context.serviceId,
      spaceId: context.spaceId,
      userId: context.userId,
      textLength: result.text.length,
    },
  });

  return result;
}
