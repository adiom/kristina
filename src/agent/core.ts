import { createHash } from 'crypto';

import { ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';
import { CEO_PERSONALITY } from './personality';
import { getModel, provider } from './model';
import type {
  AgentContext,
  AgentIdentityLink,
  AgentResult,
  AgentUserProfile,
} from './types';
import {
  forgetVaultMemory,
  searchOwnMemory,
  searchServiceMemory,
  searchSpaceMemory,
  searchVaultMemory,
  storeOwnMemory,
  storeServiceMemory,
  storeSpaceMemory,
  upsertVaultMemory,
  type MemorySearchResult,
} from '../memory/store';
import {
  extractMemories,
  extractMemoryCommandContent,
  extractOnboardingMemory,
  isExplicitMemoryRequest,
  isForgetRequest,
  isMemoryStatusRequest,
  isOutdatedFactRequest,
  persistAutoMemories,
  persistExplicitMemory,
  extractExplicitContent,
} from '../memory/extractor';
import { logActivity } from '../transparency';
import { canAccessMemory, checkRateLimit, validateContext } from '../policy';
import {
  completeVaultOnboarding,
  getVaultProfile,
  registerAttachmentsAsVaultItems,
  resolveUserVault,
  upsertIdentityLinks,
  upsertVaultProfile,
  type UserVaultSession,
} from '../vault';

const model = getModel();

const tools = {
  searchOwnMemory: tool({
    description: 'Search Kristina’s own knowledge base.',
    inputSchema: z.object({
      query: z.string().min(1),
      category: z
        .enum(['insight', 'pattern', 'knowledge', 'decision', 'reflection'])
        .optional(),
    }),
    execute: async ({ query, category }) => {
      const results = await searchOwnMemory(query, { category, limit: 5 });
      return results.map((result) => ({
        content: result.content,
        category: result.category,
        importance: result.importance,
        similarity: result.similarity,
      }));
    },
  }),
};

export function createAgent(userId?: string) {
  const instructions = userId
    ? `${CEO_PERSONALITY}\n\n## Current Context\nYou are speaking with user: ${userId}`
    : CEO_PERSONALITY;

  return new ToolLoopAgent({ model, instructions, tools });
}

interface RetrievedMemory {
  id: string;
  content: string;
  category: string;
  importance: number;
  similarity: number;
  source: 'own' | 'user' | 'space' | 'service';
  sourceType: string;
}

function toRetrieved(
  result: MemorySearchResult,
  source: RetrievedMemory['source'],
): RetrievedMemory {
  return {
    id: result.id,
    content: result.content,
    category: result.category,
    importance: result.importance,
    similarity: result.similarity,
    source,
    sourceType: result.sourceType,
  };
}

function buildProfileSummary(profile: AgentUserProfile): string {
  const fields = [
    ['Имя', profile.name],
    ['Роль', profile.role],
    ['Интересы', profile.interests],
    ['Цели', profile.goals],
    ['Контекст', profile.context],
  ].filter(([, value]) => typeof value === 'string' && value.trim().length > 0);

  if (fields.length === 0) return 'Профиль пользователя из Orbital.';
  return `Профиль пользователя из Orbital:\n${fields
    .map(([label, value]) => `- ${label}: ${String(value).trim()}`)
    .join('\n')}`;
}

async function bootstrapUserProfile(
  context: AgentContext,
  vaultSession: UserVaultSession | undefined,
): Promise<'skipped' | 'stored' | 'updated' | 'unchanged'> {
  const profile = context.userProfile;
  if (
    !profile ||
    !vaultSession ||
    !context.memoryAccess.user ||
    !context.memoryAccess.write
  ) {
    return 'skipped';
  }

  const profileHash = createHash('sha256')
    .update(JSON.stringify(profile))
    .digest('hex');
  const existing = await getVaultProfile(vaultSession.vaultId);
  if (existing?.metadata?.profileHash === profileHash) return 'unchanged';

  await upsertVaultProfile({
    vaultId: vaultSession.vaultId,
    title: 'Orbital onboarding',
    content: buildProfileSummary(profile),
    source: 'system',
    createdByUserId: context.userId,
    tags: ['orbital', 'onboarding'],
    metadata: {
      source: 'orbital',
      profileHash,
      completedAt: profile.completedAt,
    },
  });

  return existing ? 'updated' : 'stored';
}

async function retrieveMemory(
  prompt: string,
  context: AgentContext,
): Promise<RetrievedMemory[]> {
  const results: RetrievedMemory[] = [];

  if (canAccessMemory(context, 'own')) {
    const own = await searchOwnMemory(prompt, { limit: 5 });
    results.push(...own.map((memory) => toRetrieved(memory, 'own')));
  }

  if (canAccessMemory(context, 'user') && context.vaultId) {
    const profile = await getVaultProfile(context.vaultId);
    if (profile?.summary) {
      results.push({
        id: profile.id,
        content: profile.summary,
        category: 'profile',
        importance: 10,
        similarity: 1,
        source: 'user',
        sourceType:
          profile.metadata?.source === 'orbital' ? 'onboarding' : 'profile',
      });
    }

    const facts = await searchVaultMemory(context.vaultId, prompt, {
      limit: 5,
      memoryTypes: ['fact', 'summary'],
    });
    const episodes = await searchVaultMemory(context.vaultId, prompt, {
      limit: 3,
      memoryTypes: ['episode'],
    });
    results.push(
      ...facts.map((memory) => toRetrieved(memory, 'user')),
      ...episodes.map((memory) => toRetrieved(memory, 'user')),
    );
  }

  if (canAccessMemory(context, 'space')) {
    const space = await searchSpaceMemory(context.spaceId, prompt, { limit: 5 });
    results.push(...space.map((memory) => toRetrieved(memory, 'space')));
  }

  if (canAccessMemory(context, 'service')) {
    const service = await searchServiceMemory(context.serviceId, prompt, {
      limit: 5,
    });
    results.push(...service.map((memory) => toRetrieved(memory, 'service')));
  }

  const seen = new Set<string>();
  const unique = results.filter((memory) => {
    const key = memory.content.trim().toLowerCase();
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
      vaultId: context.vaultId,
      count: unique.length,
      duplicatesRemoved: results.length - unique.length,
    },
  });

  return unique;
}

function buildAttachmentContext(context: AgentContext): string[] {
  if (!context.attachments?.length) return [];

  return [
    '',
    '## Attachments',
    ...context.attachments.map((attachment, index) => {
      const location =
        attachment.storageKey ?? attachment.url ?? attachment.source;
      return `- [${index + 1}] ${attachment.type}: ${attachment.title}${attachment.mimeType ? ` (${attachment.mimeType})` : ''}${location ? `, location: ${location}` : ''}`;
    }),
  ];
}

function buildSystemPrompt(
  context: AgentContext,
  vaultSession?: UserVaultSession,
): string {
  const lines = [CEO_PERSONALITY, '', '## Current Event Context'];
  lines.push(`- source: ${context.source}`);
  lines.push(
    `- service: ${context.serviceId}${context.serviceName ? ` (${context.serviceName})` : ''}`,
  );
  lines.push(
    `- space: ${context.spaceId}${context.spaceName ? ` (${context.spaceName})` : ''}`,
  );
  if (context.userId) {
    lines.push(
      `- user: ${context.userId}${context.userName ? ` (${context.userName})` : ''}`,
    );
  }
  if (vaultSession) {
    lines.push(`- vault: ${vaultSession.vaultId}`);
    lines.push(`- vault onboarding: ${vaultSession.onboardingStatus}`);
  }
  lines.push(`- trigger: ${context.trigger}`);
  lines.push(`- responseMode: ${context.responseMode}`);

  const allowedNamespaces = (
    Object.keys(context.memoryAccess) as Array<keyof typeof context.memoryAccess>
  )
    .filter((key) => key !== 'write' && context.memoryAccess[key])
    .join(', ');
  lines.push(`- allowed memory namespaces: ${allowedNamespaces || 'none'}`);
  lines.push(`- write allowed: ${context.memoryAccess.write}`);

  if (context.conversationHistory?.length) {
    lines.push('', '## Recent Conversation');
    for (const message of context.conversationHistory.slice(-5)) {
      lines.push(`- [${message.role}] ${message.author || message.role}: ${message.content}`);
    }
  }

  lines.push(...buildAttachmentContext(context));

  if (vaultSession?.isNewVault) {
    lines.push(
      '',
      '## First Contact Vault Onboarding',
      'If natural, ask one light question that helps you remember the person.',
      'Do not ask for secrets, passwords, API keys, private keys, or credentials.',
    );
  }

  return lines.join('\n');
}

const ONBOARDING_QUESTION =
  'Чтобы я лучше тебя запомнила, скажи коротко: чем ты сейчас занимаешься и что для тебя правда важно?';

function appendOnboardingQuestionIfNeeded(
  text: string,
  vaultSession?: UserVaultSession,
): string {
  if (!vaultSession?.isNewVault) return text;
  if (text.trim().endsWith('?')) return text;
  return `${text.trim()}\n\n${ONBOARDING_QUESTION}`.trim();
}

async function persistVaultOnboardingAnswer(
  prompt: string,
  context: AgentContext,
  vaultSession?: UserVaultSession,
) {
  if (!vaultSession || !context.memoryAccess.write || !context.userId || !context.vaultId) {
    return;
  }
  if (vaultSession.onboardingStatus !== 'pending') return;

  const memory = await extractOnboardingMemory(prompt);
  if (!memory) return;

  await upsertVaultMemory(
    context.vaultId,
    {
      content: memory.content,
      category: memory.category,
      importance: memory.importance,
      tags: memory.tags,
      memoryType: memory.memoryType,
      confidence: memory.confidence,
      sourceType: memory.sourceType,
      spaceId: context.spaceId,
      service: context.serviceId,
    },
    context.userId,
  );
  await completeVaultOnboarding(vaultSession.vaultId);
}

async function registerRuntimeAttachments(context: AgentContext) {
  if (!context.vaultId || !context.attachments?.length) return;
  await registerAttachmentsAsVaultItems(
    context.vaultId,
    context.attachments,
    context.userId,
  );
}

async function persistResultMemory(
  result: AgentResult,
  context: AgentContext,
) {
  if (!result.memoryToStore?.length || !context.memoryAccess.write) return;

  for (const entry of result.memoryToStore) {
    try {
      if (canAccessMemory(context, 'user') && context.userId && context.vaultId) {
        await upsertVaultMemory(
          context.vaultId,
          {
            content: entry.content,
            category: entry.category as 'knowledge',
            importance: entry.importance,
            tags: entry.tags,
            memoryType: 'fact',
            confidence: 80,
            sourceType: 'agent',
            spaceId: context.spaceId,
            service: context.serviceId,
          },
          context.userId,
        );
      } else if (canAccessMemory(context, 'space')) {
        await storeSpaceMemory(context.spaceId, {
          content: entry.content,
          category: entry.category as 'knowledge',
          importance: entry.importance,
          tags: entry.tags,
          memoryType: 'episode',
          confidence: 70,
          sourceType: 'agent',
          userId: context.userId ?? null,
          service: context.serviceId,
        });
      } else if (canAccessMemory(context, 'service')) {
        await storeServiceMemory(context.serviceId, {
          content: entry.content,
          category: entry.category as 'knowledge',
          importance: entry.importance,
          tags: entry.tags,
          memoryType: 'episode',
          confidence: 70,
          sourceType: 'agent',
          userId: context.userId ?? null,
          spaceId: context.spaceId,
        });
      } else {
        await storeOwnMemory({
          content: entry.content,
          category: entry.category as 'knowledge',
          importance: entry.importance,
          tags: entry.tags,
          memoryType: 'episode',
          confidence: 70,
          sourceType: 'agent',
          spaceId: context.spaceId,
          service: context.serviceId,
        });
      }
    } catch (err) {
      console.error('[processAgent] memory persist failed', err);
    }
  }
}

function memoryOperationResult(
  text: string,
  memories: RetrievedMemory[],
  context: AgentContext,
  vaultSession: UserVaultSession | undefined,
  operation: Record<string, unknown>,
): AgentResult {
  return {
    text,
    type: 'message',
    sources: memories.map((memory) => ({
      id: memory.id,
      snippet: memory.content,
      similarity: memory.similarity,
      source: memory.source,
      sourceType: memory.sourceType,
    })),
    metadata: {
      model: provider === 'groq' ? 'openai/gpt-oss-120b' : 'qwen/qwen3-1.7b',
      provider,
      serviceId: context.serviceId,
      spaceId: context.spaceId,
      userId: context.userId,
      vaultId: context.vaultId,
      isNewVault: vaultSession?.isNewVault,
      vaultOnboardingStatus: vaultSession?.onboardingStatus,
      memoryOperation: operation,
    },
  };
}

export async function processAgent(
  prompt: string,
  context: AgentContext,
): Promise<AgentResult> {
  validateContext(context);

  const vaultSession = context.userId
    ? await resolveUserVault(context.serviceId, context.userId, {
        displayName: context.userName,
        serviceId: context.serviceId,
        spaceId: context.spaceId,
      })
    : undefined;

  const runtimeContext: AgentContext = vaultSession
    ? {
        ...context,
        vaultId: vaultSession.vaultId,
        globalUserId: vaultSession.globalUserId,
      }
    : context;

  checkRateLimit(
    `${runtimeContext.serviceId}:${runtimeContext.userId ?? 'anonymous'}`,
  );

  const identityLinksToPersist = [
    ...(runtimeContext.userId
      ? [
          {
            serviceId: runtimeContext.serviceId,
            userId: runtimeContext.userId,
            userName: runtimeContext.userName,
            primary: true,
          },
        ]
      : []),
    ...(runtimeContext.runtimeTrust?.allowIdentityLinks
      ? (runtimeContext.identityLinks ?? [])
      : []),
  ].reduce<AgentIdentityLink[]>((links, link) => {
    if (!link) return links;
    const index = links.findIndex(
      (existing) =>
        existing.serviceId === link.serviceId && existing.userId === link.userId,
    );
    if (index >= 0) links[index] = { ...links[index], ...link };
    else links.push(link);
    return links;
  }, []);

  if (vaultSession && identityLinksToPersist.length > 0) {
    try {
      await upsertIdentityLinks(vaultSession.vaultId, identityLinksToPersist);
    } catch (err) {
      console.error('[processAgent] upsertIdentityLinks failed', err);
    }
  }

  const profileBootstrap = await bootstrapUserProfile(runtimeContext, vaultSession);

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

  if (
    (isForgetRequest(prompt) || isOutdatedFactRequest(prompt)) &&
    runtimeContext.memoryAccess.write &&
    runtimeContext.userId &&
    runtimeContext.vaultId
  ) {
    const content = extractMemoryCommandContent(prompt);
    const operation = content.length > 3
      ? await forgetVaultMemory(runtimeContext.vaultId, content, { exact: false })
      : { forgotten: 0, memoryIds: [] };

    const result = memoryOperationResult(
      operation.forgotten > 0
        ? 'Готово, я больше не буду учитывать эту информацию.'
        : 'Я не нашла достаточно точную память для удаления. Уточни формулировку.',
      [],
      runtimeContext,
      vaultSession,
      { type: 'forget', ...operation },
    );
    await logActivity({
      type: 'message_sent',
      channel: context.source,
      details: {
        serviceId: runtimeContext.serviceId,
        vaultId: runtimeContext.vaultId,
        textLength: result.text.length,
      },
    });
    return result;
  }

  const memories = await retrieveMemory(prompt, runtimeContext);

  if (isMemoryStatusRequest(prompt)) {
    const sourceLabels: Record<RetrievedMemory['source'], string> = {
      own: 'своя',
      user: 'пользовательская',
      space: 'пространства',
      service: 'сервиса',
    };
    const text = memories.length
      ? `Вот что мне сейчас доступно в памяти:\n${memories
          .slice(0, 12)
          .map(
            (memory) =>
              `- [${sourceLabels[memory.source]}] ${memory.content}`,
          )
          .join('\n')}`
      : 'Сейчас у меня нет доступных воспоминаний по этому запросу.';

    const result = memoryOperationResult(
      text,
      memories,
      runtimeContext,
      vaultSession,
      { type: 'status', count: memories.length },
    );
    await logActivity({
      type: 'message_sent',
      channel: context.source,
      details: {
        serviceId: runtimeContext.serviceId,
        vaultId: runtimeContext.vaultId,
        textLength: result.text.length,
      },
    });
    return result;
  }

  const systemPrompt = buildSystemPrompt(runtimeContext, vaultSession);
  const memorySnippet = memories
    .slice(0, 8)
    .map((memory) => `- [${memory.source}] ${memory.content}`)
    .join('\n');

  const onboardingPrompt = vaultSession?.isNewVault
    ? `\n\n## ОБЯЗАТЕЛЬНО ДЛЯ НОВОГО VAULT\nЕсли уместно, задай один короткий живой вопрос: ${ONBOARDING_QUESTION}`
    : '';

  const fullPrompt = `${prompt}

## Retrieved Memory (используй только если прямо относится к вопросу)
${memorySnippet || '(no relevant memory)'}

## ВАЖНО
- Отвечай на вопрос пользователя, а не на содержимое памяти
- Память — это контекст, а не ответ
- Если не уверен, что факт относится к человеку, не используй его${onboardingPrompt}`;

  const agent = new ToolLoopAgent({ model, instructions: systemPrompt, tools });
  const llm = await agent.generate({ prompt: fullPrompt });
  const text = appendOnboardingQuestionIfNeeded(llm.text || '', vaultSession);

  const result: AgentResult = {
    text,
    type: 'message',
    sources: memories.map((memory) => ({
      id: memory.id,
      snippet: memory.content,
      similarity: memory.similarity,
      source: memory.source,
      sourceType: memory.sourceType,
    })),
    metadata: {
      model: provider === 'groq' ? 'openai/gpt-oss-120b' : 'qwen/qwen3-1.7b',
      provider,
      serviceId: runtimeContext.serviceId,
      spaceId: runtimeContext.spaceId,
      vaultId: vaultSession?.vaultId,
      isNewVault: vaultSession?.isNewVault,
      vaultOnboardingStatus: vaultSession?.onboardingStatus,
      profileBootstrap,
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

  await persistResultMemory(result, runtimeContext);

  if (runtimeContext.memoryAccess.write) {
    try {
      if (isExplicitMemoryRequest(prompt)) {
        const explicitContent = extractExplicitContent(prompt);
        if (explicitContent.length > 5) {
          await persistExplicitMemory(explicitContent, runtimeContext);
        }
      }

      const autoMemories = await extractMemories(prompt, text);
      if (autoMemories.length > 0) {
        await persistAutoMemories(autoMemories, runtimeContext);
      }
    } catch (err) {
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
