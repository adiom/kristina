import {
  pgTable,
  uuid,
  text,
  integer,
  decimal,
  timestamp,
  jsonb,
  index,
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
    index('memory_user_id_idx').on(t.userId),
    index('memory_space_id_idx').on(t.spaceId),
    index('memory_service_idx').on(t.service),
    index('memory_category_idx').on(t.category),
    index('memory_created_at_idx').on(t.createdAt),
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
