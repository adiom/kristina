import { createAgent } from '../agent/core';
import { searchOwnMemory, storeOwnMemory } from '../memory/store';
import { db } from '../db';
import { diary, interests } from '../db/schema';
import { sql, desc, eq } from 'drizzle-orm';

const REFLECTION_PROMPT = `Ты — Кристина, AI-агент с постоянной памятью.
Твоя задача — провести рефлексию над выбранной темой на основе своих воспоминаний.

Проанализируй воспоминания и извлеки:
1. Ключевые инсайты (что нового ты узнала)
2. Паттерны (что повторяется)
3. Выводы (что стоит запомнить)

Формат ответа:
ИНСАЙТ: <текст инсайта> [важность: 1-10] [теги: tag1, tag2]
ИНСАЙТ: <текст инсайта> [важность: 1-10] [теги: tag1, tag2]

Будь краткой и конкретной.`;

interface ReflectionResult {
  topic: string;
  insights: Array<{ content: string; importance: number; tags: string[] }>;
  diaryEntry: string;
}

export async function runReflection(topic?: string): Promise<ReflectionResult> {
  // Step 1: Select topic
  if (!topic) {
    topic = await selectTopic();
  }
  console.log(`[Reflection] Topic: ${topic}`);

  // Step 2: Search memory
  const memories = await searchOwnMemory(topic, { limit: 10 });
  console.log(`[Reflection] Found ${memories.length} related memories`);

  if (memories.length === 0) {
    return {
      topic,
      insights: [],
      diaryEntry: `Нет воспоминаний по теме "${topic}" для рефлексии.`,
    };
  }

  // Step 3: LLM reasoning
  const memoryText = memories
    .map((m) => `- ${m.content} [категория: ${m.category}, важность: ${m.importance}]`)
    .join('\n');

  const prompt = `${REFLECTION_PROMPT}

Тема: ${topic}

Воспоминания:
${memoryText}

Проведи рефлексию:`;

  const agent = createAgent();
  const result = await agent.generate({ prompt });
  const reflectionText = result.text;

  // Step 4: Extract insights
  const insights = extractInsights(reflectionText);
  console.log(`[Reflection] Extracted ${insights.length} insights`);

  // Step 5: Store insights
  for (const insight of insights) {
    await storeOwnMemory({
      content: insight.content,
      category: 'reflection',
      importance: insight.importance,
      tags: ['reflection', topic, ...insight.tags],
      context: { channel: 'reflection', situation: topic },
    });
  }

  // Step 6: Write diary
  await db.insert(diary).values({
    topic,
    reflection: reflectionText,
    insightsCount: insights.length,
  });

  // Step 7: Update interests
  await updateInterests(topic);

  return {
    topic,
    insights,
    diaryEntry: reflectionText,
  };
}

async function selectTopic(): Promise<string> {
  const topInterests = await db
    .select()
    .from(interests)
    .orderBy(desc(interests.score))
    .limit(5);

  if (topInterests.length === 0) {
    return 'общие наблюдения';
  }

  const totalScore = topInterests.reduce(
    (sum, i) => sum + parseFloat(i.score),
    0
  );
  const random = Math.random() * totalScore;

  let cumulative = 0;
  for (const interest of topInterests) {
    cumulative += parseFloat(interest.score);
    if (random <= cumulative) {
      return interest.topic;
    }
  }

  return topInterests[0].topic;
}

function extractInsights(text: string): Array<{ content: string; importance: number; tags: string[] }> {
  const insights: Array<{ content: string; importance: number; tags: string[] }> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const match = line.match(/ИНСАЙТ:\s*(.+?)(?:\s*\[важность:\s*(\d+)\])?(?:\s*\[теги:\s*(.+?)\])?/i);
    if (match) {
      insights.push({
        content: match[1].trim(),
        importance: parseInt(match[2] || '6'),
        tags: match[3] ? match[3].split(',').map((t) => t.trim()) : [],
      });
    }
  }

  return insights;
}

async function updateInterests(topic: string) {
  const existing = await db
    .select()
    .from(interests)
    .where(eq(interests.topic, topic))
    .limit(1);

  if (existing.length > 0) {
    const currentScore = parseFloat(existing[0].score);
    const newScore = Math.min(10, currentScore + 0.5);
    await db
      .update(interests)
      .set({ score: newScore.toString(), lastExplored: new Date() })
      .where(eq(interests.topic, topic));
  } else {
    await db.insert(interests).values({
      topic,
      score: '6.00',
      priority: 3,
      source: 'reflection',
      lastExplored: new Date(),
    });
  }
}

export async function getDiaryEntries(limit = 10) {
  return db
    .select()
    .from(diary)
    .orderBy(desc(diary.createdAt))
    .limit(limit);
}
