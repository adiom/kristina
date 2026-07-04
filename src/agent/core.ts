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
import type { AgentContext, AgentIdentityLink, AgentResult } from './types';
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
import {
  completeVaultOnboarding,
  ensureUserVault,
  registerAttachmentsAsVaultItems,
  resolveGlobalUserId,
  upsertIdentityLinks,
  upsertVaultProfile,
  type UserVaultSession,
} from '../vault';

// Provider selection: GROQ (cloud, faster, larger models) or LM Studio (local)
const provider = process.env.LLM_PROVIDER || 'lmstudio';

function getModel() {
  if (provider === 'groq') {
    const groq = createGroq({
      apiKey: process.env.GROQ_API_KEY,
    });
    return groq('openai/gpt-oss-120b');
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

function buildAttachmentContext(context: AgentContext): string[] {
  if (!context.attachments || context.attachments.length === 0) return [];

  return [
    '',
    '## Attachments',
    ...context.attachments.map((attachment, index) => {
      const location = attachment.storageKey ?? attachment.url ?? attachment.source;
      return `- [${index + 1}] ${attachment.type}: ${attachment.title}${attachment.mimeType ? ` (${attachment.mimeType})` : ''}${location ? `, location: ${location}` : ''}`;
    }),
  ];
}

function buildSystemPrompt(
  context: AgentContext,
  vaultSession?: UserVaultSession,
): string {
  const lines: string[] = [CEO_PERSONALITY, ''];

  lines.push('## Current Event Context');
  lines.push(`- source: ${context.source}`);
  lines.push(`- service: ${context.serviceId}${context.serviceName ? ` (${context.serviceName})` : ''}`);
  lines.push(`- space: ${context.spaceId}${context.spaceName ? ` (${context.spaceName})` : ''}`);
  if (context.userId) {
    lines.push(`- user: ${context.userId}${context.userName ? ` (${context.userName})` : ''}`);
  }
  if (vaultSession) {
    lines.push(`- vault: ${vaultSession.vaultId}`);
    lines.push(`- vault onboarding: ${vaultSession.onboardingStatus}`);
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

  lines.push(...buildAttachmentContext(context));

  if (vaultSession?.isNewVault) {
    lines.push(
      '',
      '## First Contact Vault Onboarding',
      'This is a new personal vault for this user.',
      'Ask exactly one short question to learn what should be remembered about this person.',
      'Do not ask for secrets, passwords, API keys, private keys, or sensitive credentials.',
    );
  }

  return lines.join('\n');
}

async function persistVaultOnboardingAnswer(
  prompt: string,
  context: AgentContext,
  vaultSession?: UserVaultSession,
) {
  if (!vaultSession) return;
  if (!context.memoryAccess.write) return;
  if (vaultSession.onboardingStatus !== 'pending') return;
  // Avoid polluting the profile with arbitrary small talk.  Only the
  // first substantial answer to the onboarding question is recorded.
  if (prompt.trim().length < 12) return;

  await upsertVaultProfile({
    vaultId: vaultSession.vaultId,
    title: context.userName || 'Person',
    content: prompt.trim(),
    source: 'user',
    createdByUserId: context.userId,
    tags: ['onboarding'],
    metadata: {
      capturedFromService: context.serviceId,
      capturedFromSpace: context.spaceId,
      capturedAt: new Date().toISOString(),
    },
  });
  await completeVaultOnboarding(vaultSession.vaultId);
}

async function registerRuntimeAttachments(context: AgentContext): Promise<void> {
  if (!context.vaultId || !context.attachments || context.attachments.length === 0) {
    return;
  }

  await registerAttachmentsAsVaultItems(
    context.vaultId,
    context.attachments,
    context.userId,
  );
}

const ONBOARDING_QUESTION = 'Чтобы мне лучше запомнить тебя в личном vault, расскажи в одном-двух предложениях: чем ты занимаешься и что для тебя сейчас важно?';

function appendOnboardingQuestionIfNeeded(
  text: string,
  vaultSession?: UserVaultSession,
): string {
  if (!vaultSession?.isNewVault) return text;
  if (text.trim().endsWith('?')) return text;
  return `${text.trim()}\n\n${ONBOARDING_QUESTION}`.trim();
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
          vaultId: context.vaultId,
          spaceId: context.spaceId,
          service: context.serviceId,
        });
      } else if (canAccessMemory(context, 'space')) {
        await storeSpaceMemory(context.spaceId, {
          content: entry.content,
          category: entry.category as any,
          importance: entry.importance,
          tags: entry.tags,
          vaultId: context.vaultId,
          userId: context.userId ?? null,
          service: context.serviceId,
        });
      } else if (canAccessMemory(context, 'service')) {
        await storeServiceMemory(context.serviceId, {
          content: entry.content,
          category: entry.category as any,
          importance: entry.importance,
          tags: entry.tags,
          vaultId: context.vaultId,
          userId: context.userId ?? null,
          spaceId: context.spaceId,
        });
      } else {
        await storeOwnMemory({
          content: entry.content,
          category: entry.category as any,
          importance: entry.importance,
          tags: entry.tags,
          vaultId: context.vaultId,
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

  // Resolve a cross-service stable identity for the caller.  The
  // dashboard linking flow populates `vault_identity_links`; the runtime
  // uses it to map a (serviceId, userId) pair onto the right vault so a
  // Telegram user and a Sfera user can share one profile.
  const resolvedGlobalUserId = context.globalUserId
    ? context.globalUserId
    : await resolveGlobalUserId(context.serviceId, context.userId);

  const vaultSession = resolvedGlobalUserId
    ? await ensureUserVault(resolvedGlobalUserId, {
        displayName: context.userName,
        serviceId: context.serviceId,
        spaceId: context.spaceId,
      })
    : undefined;

  // Persist the current service identity plus any extra links the adapter
  // sent (e.g. dashboard merging two accounts).  Failures here must never
  // break the request.
  const identityLinksToPersist = [
    ...(context.userId
      ? [
          {
            serviceId: context.serviceId,
            userId: context.userId,
            userName: context.userName,
            primary: true,
          },
        ]
      : []),
    ...(context.identityLinks ?? []),
  ].reduce<AgentIdentityLink[]>((links, link) => {
    if (!link) return links;
    const existingIndex = links.findIndex(
      (existing) =>
        existing.serviceId === link.serviceId &&
        existing.userId === link.userId,
    );
    if (existingIndex >= 0) {
      links[existingIndex] = { ...links[existingIndex], ...link };
    } else {
      links.push(link);
    }
    return links;
  }, []);

  if (vaultSession && identityLinksToPersist.length > 0) {
    try {
      await upsertIdentityLinks(vaultSession.vaultId, identityLinksToPersist);
    } catch (err) {
      console.error('[processAgent] upsertIdentityLinks failed', err);
    }
  }

  const runtimeContext: AgentContext = vaultSession
    ? { ...context, vaultId: vaultSession.vaultId, globalUserId: vaultSession.globalUserId }
    : context;

  await registerRuntimeAttachments(runtimeContext);
  await persistVaultOnboardingAnswer(prompt, runtimeContext, vaultSession);

  await logActivity({
    type: 'message_received',
    channel: context.source,
    details: {
      serviceId: runtimeContext.serviceId,
      spaceId: runtimeContext.spaceId,
      userId: runtimeContext.userId,
      vaultId: runtimeContext.vaultId,
      attachmentsCount: runtimeContext.attachments?.length ?? 0,
      promptLength: prompt.length,
    },
  });

  const memories = await retrieveMemory(prompt, runtimeContext);

  const systemPrompt = buildSystemPrompt(runtimeContext, vaultSession);

  // Build a single prompt that injects the retrieved memory snippets
  // (the LLM does not need to call any tool for the MVP – everything it
  // needs is in front of it).  We still keep the tool definitions in
  // case a future model chooses to call them.
  // Limit to 3 snippets — small models (1.7B) get confused by too much context.
  const memorySnippet = memories
    .slice(0, 3)
    .map((m) => `- ${m.content}`)
    .join('\n');

  const onboardingPrompt = vaultSession?.isNewVault
    ? `

## ОБЯЗАТЕЛЬНО ДЛЯ НОВОГО VAULT
В конце ответа задай ровно один короткий вопрос о человеке: ${ONBOARDING_QUESTION}`
    : '';

  const fullPrompt = `${prompt}

## Retrieved Memory (используй ТОЛЬКО если directly relevant к вопросу)
${memorySnippet || '(no relevant memory)'}

## ВАЖНО
- Отвечай на вопрос пользователя, а не на содержимое памяти
- Память — это контекст, а не ответ
- Если вопрос про "что видишь" — опиши текущую ситуацию/контекст, а не facts из памяти${onboardingPrompt}`;

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
  const text = appendOnboardingQuestionIfNeeded(llm.text || '', vaultSession);

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
      model: provider === 'groq' ? 'openai/gpt-oss-120b' : 'qwen/qwen3-1.7b',
      provider,
      serviceId: runtimeContext.serviceId,
      spaceId: runtimeContext.spaceId,
      vaultId: vaultSession?.vaultId,
      isNewVault: vaultSession?.isNewVault,
      vaultOnboardingStatus: vaultSession?.onboardingStatus,
      attachments: runtimeContext.attachments?.map((attachment) => ({
        type: attachment.type,
        title: attachment.title,
        storageKey: attachment.storageKey,
        url: attachment.url,
      })),
    },
  };

  await logActivity({
    type: 'decision_made',
    channel: context.source,
    details: {
      serviceId: runtimeContext.serviceId,
      spaceId: runtimeContext.spaceId,
      userId: runtimeContext.userId,
      vaultId: runtimeContext.vaultId,
      memoryUsed: memories.length,
    },
  });

  // Persist any new knowledge the agent decided to record.
  await persistResultMemory(result, runtimeContext);

  // Auto-extract significant memories from the conversation
  if (runtimeContext.memoryAccess.write) {
    try {
      // Check if user explicitly asked to remember something
      if (isExplicitMemoryRequest(prompt)) {
        const explicitContent = extractExplicitContent(prompt);
        if (explicitContent.length > 5) {
          const saved = await persistExplicitMemory(explicitContent, runtimeContext);
          if (saved) {
            console.log('[processAgent] Explicit memory saved:', explicitContent);
          }
        }
      }

      // Auto-extract memories from the conversation
      const autoMemories = await extractMemories(prompt, text, runtimeContext);
      if (autoMemories.length > 0) {
        await persistAutoMemories(autoMemories, runtimeContext);
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
      serviceId: runtimeContext.serviceId,
      spaceId: runtimeContext.spaceId,
      userId: runtimeContext.userId,
      vaultId: runtimeContext.vaultId,
      textLength: result.text.length,
    },
  });

  return result;
}
