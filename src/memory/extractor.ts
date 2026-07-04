/**
 * Memory extraction module for Kristina.
 *
 * This module handles two types of memory extraction:
 * 1. Auto-memory: Automatically extracts significant facts after each response
 * 2. On-demand memory: Saves when user explicitly asks ("запомни это", "запомни")
 */

import { storeOwnMemory, storeUserMemory } from './store';
import { logActivity } from '../transparency';
import type { AgentContext } from '../agent/types';

interface ExtractedMemory {
  content: string;
  category: 'insight' | 'pattern' | 'knowledge' | 'decision' | 'reflection';
  importance: number;
  tags: string[];
}

/**
 * Check if user explicitly asked to remember something.
 */
export function isExplicitMemoryRequest(prompt: string): boolean {
  const patterns = [
    /запомни/i,
    /запомн/i,
    /не забудь/i,
    /сохрани/i,
    /запиши/i,
    /记住/,
    /remember/i,
    /save this/i,
    /keep in mind/i,
  ];
  return patterns.some(p => p.test(prompt));
}

/**
 * Extract the "what to remember" part from explicit request.
 * E.g., "запомни что я люблю кофе" -> "Пользователь любит кофе"
 */
/**
 * Extract the "what to remember" part from explicit request.
 * E.g., "запомни что я люблю кофе" -> "Пользователь любит кофе"
 */
export function extractExplicitContent(prompt: string): string {
  // Remove common prefixes
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

  let content = prompt;
  for (const prefix of prefixes) {
    content = content.replace(prefix, '');
  }

  return content.trim();
}

/**
 * Auto-extract memories from a conversation turn.
 * Returns 0-2 significant memories worth saving.
 */
export async function extractMemories(
  prompt: string,
  response: string,
  context: AgentContext,
): Promise<ExtractedMemory[]> {
  const memories: ExtractedMemory[] = [];

  // Combine prompt and response for analysis
  const combined = `User: ${prompt}\nAssistant: ${response}`;

  // Rule 1: Extract decisions
  const decisionPatterns = [
    /решили?\s*(что|об|о|установить|выбрать|сделать|начать|продолжать)/i,
    /важное решение/i,
    /договорились/i,
    /выбрали?\s*(что|модель|подход|стратегию)/i,
    /цель\s*(—|:|=)\s*/i,
    /план\s*(—|:|=)\s*/i,
  ];

  for (const pattern of decisionPatterns) {
    if (pattern.test(combined)) {
      memories.push({
        content: extractDecision(prompt, response),
        category: 'decision',
        importance: 8,
        tags: ['decision', 'canfly'],
      });
      break;
    }
  }

  // Rule 2: Extract user preferences (about the user)
  const preferencePatterns = [
    /я\s*(люблю|предпочитаю|ненавижу|хочу|не хочу|думаю|считаю)/i,
    /мне\s*(нравится|не нравится|нужно|важно)/i,
    /я\s*(работаю|занимаюсь|изучаю)/i,
  ];

  for (const pattern of preferencePatterns) {
    if (pattern.test(prompt)) {
      memories.push({
        content: `Пользователь: ${extractPreference(prompt)}`,
        category: 'knowledge',
        importance: 6,
        tags: ['user-preference'],
      });
      break;
    }
  }

  // Rule 3: Extract project facts (Canfly-specific)
  const projectPatterns = [
    /canfly/i,
    /комикс/i,
    /издательств/i,
    /проект/i,
    /бизнес/i,
    /деньги|долг|бюджет|прибыл/i,
  ];

  for (const pattern of projectPatterns) {
    if (pattern.test(combined)) {
      memories.push({
        content: extractProjectFact(prompt, response),
        category: 'knowledge',
        importance: 7,
        tags: ['canfly', 'project'],
      });
      break;
    }
  }

  // Rule 4: Extract insights (patterns across conversations)
  const insightPatterns = [
    /всегда\s*(говорит|делает|использует|предпочитает)/i,
    /никогда\s*(не\s*)?(говорит|делает|использует)/i,
    /обычно\s*(говорит|делает|использует)/i,
    /каждый раз/i,
    /по привычке/i,
  ];

  for (const pattern of insightPatterns) {
    if (pattern.test(combined)) {
      memories.push({
        content: extractInsight(prompt, response),
        category: 'pattern',
        importance: 6,
        tags: ['pattern', 'user-behavior'],
      });
      break;
    }
  }

  // Deduplicate and limit
  const unique = deduplicateMemories(memories);
  return unique.slice(0, 2); // Max 2 memories per turn
}

/**
 * Persist auto-extracted memories to the database.
 */
export async function persistAutoMemories(
  memories: ExtractedMemory[],
  context: AgentContext,
): Promise<void> {
  for (const mem of memories) {
    try {
      // Check for duplicates in DB before saving
      const { searchOwnMemory } = await import('./store');
      const existing = await searchOwnMemory(mem.content, { limit: 1 });

      if (existing.length > 0 && existing[0].similarity > 0.9) {
        // Too similar to existing memory, skip
        continue;
      }

      if (context.userId) {
        await storeUserMemory(context.userId, {
          content: mem.content,
          category: mem.category,
          importance: mem.importance,
          tags: mem.tags,
          vaultId: context.vaultId,
          spaceId: context.spaceId,
          service: context.serviceId,
        });
      } else {
        await storeOwnMemory({
          content: mem.content,
          category: mem.category,
          importance: mem.importance,
          tags: mem.tags,
          spaceId: context.spaceId,
          service: context.serviceId,
        });
      }

      await logActivity({
        type: 'memory_stored',
        channel: context.source,
        details: {
          category: mem.category,
          importance: mem.importance,
          tags: mem.tags,
          contentLength: mem.content.length,
          source: 'auto-extraction',
        },
      });
    } catch (err) {
      console.error('[extractMemories] Failed to persist memory:', err);
    }
  }
}

/**
 * Persist explicitly requested memory.
 */
export async function persistExplicitMemory(
  content: string,
  context: AgentContext,
): Promise<boolean> {
  try {
    const { searchOwnMemory } = await import('./store');
    const existing = await searchOwnMemory(content, { limit: 1 });

    if (existing.length > 0 && existing[0].similarity > 0.95) {
      return false; // Already exists
    }

    if (context.userId) {
      await storeUserMemory(context.userId, {
        content,
        category: 'knowledge',
        importance: 9, // High importance for explicit requests
        tags: ['explicit', 'user-request'],
        vaultId: context.vaultId,
        spaceId: context.spaceId,
        service: context.serviceId,
      });
    } else {
      await storeOwnMemory({
        content,
        category: 'knowledge',
        importance: 9,
        tags: ['explicit', 'user-request'],
        spaceId: context.spaceId,
        service: context.serviceId,
      });
    }

    await logActivity({
      type: 'memory_stored',
      channel: context.source,
      details: {
        category: 'knowledge',
        importance: 9,
        tags: ['explicit', 'user-request'],
        contentLength: content.length,
        source: 'explicit-request',
      },
    });

    return true;
  } catch (err) {
    console.error('[persistExplicitMemory] Failed to persist memory:', err);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Helper functions for content extraction                             */
/* ------------------------------------------------------------------ */

function extractDecision(prompt: string, response: string): string {
  // Try to find the decision in the response
  const patterns = [
    /решили?\s*(что\s*)?(.+)/i,
    /важное решение[:\s]+(.+)/i,
    /выбрали?\s*(что\s*)?(.+)/i,
    /цель[:\s]+(.+)/i,
  ];

  for (const p of patterns) {
    const m = response.match(p);
    if (m) return m[1].trim();
  }

  // Fallback: use first sentence of response
  const sentences = response.split(/[.!?]/).filter(s => s.trim().length > 10);
  return sentences[0]?.trim() || response.slice(0, 200);
}

function extractPreference(prompt: string): string {
  const patterns = [
    /я\s*(люблю|предпочитаю|ненавижу|хочу|не хочу|думаю|считаю)\s+(.+)/i,
    /мне\s*(нравится|не нравится|нужно|важно)\s+(.+)/i,
    /я\s*(работаю|занимаюсь|изучаю)\s+(.+?)(\s+и\s+|\s*$)/i,
  ];

  for (const p of patterns) {
    const m = prompt.match(p);
    if (m) return m[0].trim();
  }

  return prompt.slice(0, 200);
}

function extractProjectFact(prompt: string, response: string): string {
  const combined = `${prompt} ${response}`;
  const patterns = [
    /canfly\s+(.+)/i,
    /(комикс|издательств|проект)\s+(.+)/i,
    /(деньги|долг|бюджет|прибыл)\s+(.+)/i,
  ];

  for (const p of patterns) {
    const m = combined.match(p);
    if (m) return m[0].trim();
  }

  return combined.slice(0, 200);
}

function extractInsight(prompt: string, response: string): string {
  const combined = `${prompt} ${response}`;
  const patterns = [
    /(всегда|никогда|обычно|каждый раз|по привычке)\s+(.+)/i,
  ];

  for (const p of patterns) {
    const m = combined.match(p);
    if (m) return m[0].trim();
  }

  return combined.slice(0, 200);
}

function deduplicateMemories(memories: ExtractedMemory[]): ExtractedMemory[] {
  const seen = new Set<string>();
  return memories.filter(m => {
    const key = m.content.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
