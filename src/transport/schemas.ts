import { z } from 'zod';
import type { AgentAttachment, AgentContext } from '../agent/types';

export const memoryAccessSchema = z.object({
  own: z.boolean(),
  user: z.boolean(),
  space: z.boolean(),
  service: z.boolean(),
  write: z.boolean(),
});

export const identityLinkSchema = z.object({
  serviceId: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().optional(),
  primary: z.boolean().optional(),
});

export const userProfileSchema = z.object({
  completed: z.literal(true),
  name: z.string().optional(),
  role: z.string().optional(),
  interests: z.string().optional(),
  goals: z.string().optional(),
  context: z.string().optional(),
  completedAt: z.string().optional(),
});

export const publicContextSchema = z.object({
  source: z.enum(['sfera', 'http', 'ws', 'sim']),
  serviceId: z.string().min(1),
  serviceName: z.string().optional(),
  spaceId: z.string().min(1),
  spaceName: z.string().optional(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  identityLinks: z.array(identityLinkSchema).optional(),
  attachments: z
    .array(
      z.object({
        type: z.enum(['file', 'image', 'document', 'artifact']),
        source: z.enum(['storage', 'url', 'base64', 'vault_item']),
        title: z.string().min(1),
        mimeType: z.string().optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        storageKey: z.string().optional(),
        url: z.string().optional(),
        data: z.string().optional(),
        sha256: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        author: z.string().optional(),
        content: z.string(),
      }),
    )
    .optional(),
  userProfile: userProfileSchema.optional(),
  trigger: z.enum(['mention', 'command', 'event', 'system']),
  responseMode: z.enum(['public', 'private', 'analysis', 'action', 'draft']),
  memoryAccess: memoryAccessSchema,
});

export const agentRequestSchema = z.object({
  prompt: z.string().min(1),
  context: publicContextSchema,
  attachments: z.array(z.custom<AgentAttachment>()).optional(),
});

export function parsePublicContext(value: unknown): AgentContext {
  return publicContextSchema.parse(value) as AgentContext;
}
