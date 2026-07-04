import {
  pgTable,
  uuid,
  text,
  integer,
  decimal,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';

export const memory = pgTable(
  'cf_kristina_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    content: text('content').notNull(),
    category: text('category', {
      enum: ['insight', 'pattern', 'knowledge', 'decision', 'reflection'],
    }).notNull(),
    importance: integer('importance').notNull(),
    tags: text('tags').array().default([]),
    vaultId: uuid('vault_id'),
    userId: uuid('user_id'),
    spaceId: uuid('space_id'),
    service: text('service'),
    context: jsonb('context').$type<{
      channel?: string;
      emotionalTone?: string;
      situation?: string;
    }>(),
    embedding: vector('embedding', { dimensions: 768 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('memory_vault_id_idx').on(t.vaultId),
    index('memory_user_id_idx').on(t.userId),
    index('memory_space_id_idx').on(t.spaceId),
    index('memory_service_idx').on(t.service),
    index('memory_category_idx').on(t.category),
    index('memory_created_at_idx').on(t.createdAt),
  ]
);

export const vaults = pgTable(
  'cf_kristina_vaults',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    globalUserId: text('global_user_id').notNull(),
    displayName: text('display_name'),
    status: text('status', { enum: ['active', 'archived', 'blocked'] })
      .notNull()
      .default('active'),
    onboardingStatus: text('onboarding_status', {
      enum: ['pending', 'completed'],
    })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at'),
  },
  (t) => [
    uniqueIndex('vaults_global_user_id_idx').on(t.globalUserId),
    index('vaults_status_idx').on(t.status),
  ]
);

export const vaultItems = pgTable(
  'cf_kristina_vault_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => vaults.id),
    kind: text('kind', {
      enum: ['memory', 'user_file', 'agent_file', 'note', 'profile', 'artifact'],
    }).notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    storageKey: text('storage_key'),
    sha256: text('sha256'),
    source: text('source', { enum: ['user', 'agent', 'system'] }).notNull(),
    createdByUserId: text('created_by_user_id'),
    tags: text('tags').array().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('vault_items_vault_id_idx').on(t.vaultId),
    index('vault_items_kind_idx').on(t.kind),
    index('vault_items_created_at_idx').on(t.createdAt),
  ]
);

export const vaultEvents = pgTable(
  'cf_kristina_vault_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => vaults.id),
    itemId: uuid('item_id'),
    type: text('type').notNull(),
    actorType: text('actor_type', { enum: ['user', 'agent', 'system'] }).notNull(),
    actorId: text('actor_id'),
    details: jsonb('details').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('vault_events_vault_id_idx').on(t.vaultId),
    index('vault_events_type_idx').on(t.type),
    index('vault_events_created_at_idx').on(t.createdAt),
  ]
);

export const interests = pgTable(
  'cf_kristina_interests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: text('topic').notNull(),
    score: decimal('score', { precision: 4, scale: 2 }).notNull().default('5.00'),
    priority: integer('priority').notNull().default(3),
    source: text('source', {
      enum: ['memory_analysis', 'conversation', 'reflection', 'manual'],
    }).notNull(),
    lastExplored: timestamp('last_explored'),
    scoreBelowThresholdSince: timestamp('score_below_threshold_since'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('interests_score_idx').on(t.score),
    index('interests_topic_idx').on(t.topic),
  ]
);

export const traits = pgTable(
  'cf_kristina_traits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    value: decimal('value', { precision: 3, scale: 2 }).notNull().default('0.50'),
    history: jsonb('history')
      .$type<Array<{ value: number; reason: string; timestamp: string }>>()
      .default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('traits_name_idx').on(t.name)]
);

export const activityLog = pgTable(
  'cf_kristina_activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
    type: text('type', {
      enum: [
        'message_received',
        'message_sent',
        'memory_stored',
        'memory_searched',
        'reflection_started',
        'reflection_completed',
        'interest_generated',
        'interest_evolved',
        'decision_made',
      ],
    }).notNull(),
    context: jsonb('context').$type<{
      channel?: string;
      userId?: string;
    }>(),
    details: jsonb('details').$type<{
      input?: string;
      output?: string;
      reasoning?: string;
      memoriesAccessed?: string[];
      confidence?: number;
    }>(),
  },
  (t) => [
    index('activity_log_timestamp_idx').on(t.timestamp),
    index('activity_log_type_idx').on(t.type),
  ]
);

export const diary = pgTable(
  'cf_kristina_diary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: text('topic').notNull(),
    reflection: text('reflection').notNull(),
    insightsCount: integer('insights_count').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('diary_created_at_idx').on(t.createdAt)]
);
