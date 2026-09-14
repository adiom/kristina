import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '../agent/model';
import { logActivity } from '../transparency';
import {
  storeOwnMemory,
  upsertVaultMemory,
  type MemorySourceType,
  type MemoryType,
} from './store';
import type { AgentContext } from '../agent/types';

export interface ExtractedMemory {
  content: string;
  category: 'insight' | 'pattern' | 'knowledge' | 'decision' | 'reflection';
  importance: number;
  tags: string[];
  memoryType: MemoryType;
  confidence: number;
  sourceType: MemorySourceType;
}

const memorySchema = z.object({
  memories: z
    .array(
      z.object({
        content: z.string().min(8).max(500),
        category: z.enum([
          'insight',
          'pattern',
          'knowledge',
          'decision',
          'reflection',
        ]),
        importance: z.number().min(1).max(10),
        tags: z.array(z.string().min(1)).max(6).default([]),
        memoryType: z.enum(['fact', 'episode', 'summary']),
        confidence: z.number().min(0).max(100),
      }),
    )
    .max(2),
});

const onboardingSchema = z.object({
  fact: z
    .object({
      content: z.string().min(8).max(500),
      importance: z.number().min(1).max(10),
      confidence: z.number().min(0).max(100),
    })
    .nullable(),
});

export function isExplicitMemoryRequest(prompt: string): boolean {
  return [
    /запомни/i,
    /не забудь/i,
    /сохрани/i,
    /запиши/i,
    /记住/,
    /remember/i,
    /save this/i,
    /keep in mind/i,
  ].some((pattern) => pattern.test(prompt));
}

export function extractExplicitContent(prompt: string): string {
  const prefixes = [
    /запомни,?\s*/i,
    /запомни это,?\s*/i,
    /запомни что\s*/i,
    /не забудь,?\s*/i,
    /не забудь что\s*/i,
    /сохрани,?\s*/i,
    /сохрани это,?\s*/i,
    /запиши,?\s*/i,
    /запиши что\s*/i,
    /remember,?\s*/i,
    /remember that\s*/i,
    /save this,?\s*/i,
    /keep in mind,?\s*/i,
  ];

  return prefixes.reduce((content, prefix) => content.replace(prefix, ''), prompt).trim();
}

export function isMemoryStatusRequest(prompt: string): boolean {
  return (
    /что ты (обо меня |обо мне |про меня )?(знаешь|помнишь)/i.test(prompt) ||
    /что (есть|хранится) в (твоей )?памяти/i.test(prompt) ||
    /покажи (мне )?(твою )?память/i.test(prompt) ||
    /расскажи (мне )?про (твою )?память/i.test(prompt) ||
    /what do you (remember|know)/i.test(prompt)
  );
}

export function isForgetRequest(prompt: string): boolean {
  return /забудь/i.test(prompt) || /forget/i.test(prompt);
}

export function isOutdatedFactRequest(prompt: string): boolean {
  return /это уже не так/i.test(prompt) || /это больше не (так|верно)/i.test(prompt);
}

export function extractMemoryCommandContent(prompt: string): string {
  return prompt
    .replace(/^(забудь,?\s*что|забудь|forget that,?\s*|forget,?\s*)/i, '')
    .replace(/^(это уже не так[:\s]*|это больше не (так|верно)[:\s]*)/i, '')
    .trim();
}

export async function extractMemories(
  prompt: string,
  response: string,
): Promise<ExtractedMemory[]> {
  try {
    const result = await generateObject({
      model: getModel(),
      schema: memorySchema,
      prompt: [
        'Extract only durable facts about the user worth remembering long-term.',
        'Do not extract temporary emotions, secrets, speculation, or model assumptions.',
        'Return at most two concise third-person facts.',
        `User message: ${prompt}`,
        `Assistant message: ${response}`,
      ].join('\n'),
    });

    return result.object.memories.map((memory) => ({
      ...memory,
      tags: memory.tags ?? [],
      sourceType: 'auto',
    }));
  } catch {
    return [];
  }
}

export async function extractOnboardingMemory(
  prompt: string,
): Promise<ExtractedMemory | null> {
  try {
    const result = await generateObject({
      model: getModel(),
      schema: onboardingSchema,
      prompt: [
        'Does this onboarding answer contain one durable fact about the person?',
        'Return null for small talk, secrets, or temporary states.',
        `Answer: ${prompt}`,
      ].join('\n'),
    });
    if (!result.object.fact) return null;
    return {
      content: result.object.fact.content,
      category: 'knowledge',
      importance: result.object.fact.importance,
      tags: ['onboarding'],
      memoryType: 'fact',
      confidence: result.object.fact.confidence,
      sourceType: 'onboarding',
    };
  } catch {
    return null;
  }
}

export async function persistAutoMemories(
  memories: ExtractedMemory[],
  context: AgentContext,
): Promise<void> {
  if (!context.memoryAccess.write || !context.userId || !context.vaultId) return;

  for (const memory of memories) {
    try {
      const result = await upsertVaultMemory(
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

      await logActivity({
        type: 'memory_stored',
        channel: context.source,
        details: {
          category: memory.category,
          importance: memory.importance,
          tags: memory.tags,
          contentLength: memory.content.length,
          source: 'auto-extraction',
          stored: result.stored,
          superseded: result.superseded ?? false,
        },
      });
    } catch (err) {
      console.error('[persistAutoMemories] Failed:', err);
    }
  }
}

export async function persistExplicitMemory(
  content: string,
  context: AgentContext,
): Promise<boolean> {
  if (!context.memoryAccess.write) return false;

  try {
    if (context.userId && context.vaultId) {
      const result = await upsertVaultMemory(
        context.vaultId,
        {
          content,
          category: 'knowledge',
          importance: 9,
          tags: ['explicit', 'user-request'],
          memoryType: 'fact',
          confidence: 95,
          sourceType: 'explicit',
          spaceId: context.spaceId,
          service: context.serviceId,
        },
        context.userId,
      );
      return result.stored || Boolean(result.confirmed);
    }

    await storeOwnMemory({
      content,
      category: 'knowledge',
      importance: 9,
      tags: ['explicit', 'user-request'],
      memoryType: 'fact',
      confidence: 95,
      sourceType: 'explicit',
      spaceId: context.spaceId,
      service: context.serviceId,
    });
    return true;
  } catch (err) {
    console.error('[persistExplicitMemory] Failed:', err);
    return false;
  }
}
