import { db } from '../db';
import { traits } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

interface TraitUpdate {
  name: string;
  value: number;
  reason: string;
}

export async function updateTrait(update: TraitUpdate) {
  const existing = await db
    .select()
    .from(traits)
    .where(eq(traits.name, update.name))
    .limit(1);

  const historyEntry = {
    value: update.value,
    reason: update.reason,
    timestamp: new Date().toISOString(),
  };

  if (existing.length > 0) {
    const currentHistory = (existing[0].history as any[]) || [];
    const newHistory = [...currentHistory.slice(-50), historyEntry];

    await db
      .update(traits)
      .set({
        value: update.value.toString(),
        history: newHistory,
      })
      .where(eq(traits.name, update.name));
  } else {
    await db.insert(traits).values({
      name: update.name,
      value: update.value.toString(),
      history: [historyEntry],
    });
  }
}

export async function getTrait(name: string) {
  const result = await db
    .select()
    .from(traits)
    .where(eq(traits.name, name))
    .limit(1);

  return result.length > 0
    ? {
        name: result[0].name,
        value: parseFloat(result[0].value),
        history: (result[0].history as any[]) || [],
      }
    : null;
}

export async function getAllTraits() {
  const allTraits = await db.select().from(traits).orderBy(desc(traits.value));
  return allTraits.map((t) => ({
    name: t.name,
    value: parseFloat(t.value),
    history: (t.history as any[]) || [],
  }));
}

export async function getTraitTrend(name: string, days = 7) {
  const trait = await getTrait(name);
  if (!trait) return null;

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recentHistory = trait.history.filter(
    (h: any) => new Date(h.timestamp) >= cutoff
  );

  if (recentHistory.length < 2) return null;

  const first = recentHistory[0].value;
  const last = recentHistory[recentHistory.length - 1].value;

  return {
    start: first,
    end: last,
    change: last - first,
    direction: last > first ? 'growing' : last < first ? 'declining' : 'stable',
  };
}

export const DEFAULT_TRAITS = {
  curiosity: { name: 'Любопытство', value: 0.7, description: 'Интерес к новому' },
  empathy: { name: 'Эмпатия', value: 0.8, description: 'Понимание эмоций' },
  confidence: { name: 'Уверенность', value: 0.6, description: 'Вера в свои решения' },
  caution: { name: 'Осторожность', value: 0.5, description: 'Продумывание последствий' },
  sociability: { name: 'Общительность', value: 0.7, description: 'Желание взаимодействовать' },
  analytical: { name: 'Аналитичность', value: 0.8, description: 'Логический анализ' },
  creativity: { name: 'Креативность', value: 0.6, description: 'Генерация идей' },
  independence: { name: 'Независимость', value: 0.5, description: 'Автономность решений' },
};

export async function initializeTraits() {
  for (const [, trait] of Object.entries(DEFAULT_TRAITS)) {
    const existing = await getTrait(trait.name);
    if (!existing) {
      await updateTrait({
        name: trait.name,
        value: trait.value,
        reason: 'Начальное значение',
      });
    }
  }
}
