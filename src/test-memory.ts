import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { storeOwnMemory, searchOwnMemory } = await import('./memory/store');

  console.log('Testing memory store with real embeddings...\n');
  console.log('DATABASE_URL:', process.env.DATABASE_URL);

  const memories = [
    {
      content: 'Кристина любит читать научную фантастику',
      category: 'knowledge' as const,
      importance: 7,
      tags: ['reading', 'science-fiction'],
    },
    {
      content: 'Пользователь часто спрашивает об искусственном интеллекте',
      category: 'pattern' as const,
      importance: 6,
      tags: ['AI', 'user-behavior'],
    },
    {
      content: 'Важное решение: использовать Qwen3-1.7B для MVP',
      category: 'decision' as const,
      importance: 8,
      tags: ['architecture', 'model-selection'],
    },
  ];

  console.log('Storing memories...');
  for (const mem of memories) {
    await storeOwnMemory(mem);
    console.log(`  ✓ Stored: ${mem.content.substring(0, 50)}...`);
  }

  console.log('\nSearching memories...');
  
  const results1 = await searchOwnMemory('литература');
  console.log('\nQuery "литература":');
  results1.forEach((r: any) => {
    console.log(`  - ${r.content} (similarity: ${r.similarity?.toFixed(3)})`);
  });

  const results2 = await searchOwnMemory('нейросети');
  console.log('\nQuery "нейросети":');
  results2.forEach((r: any) => {
    console.log(`  - ${r.content} (similarity: ${r.similarity?.toFixed(3)})`);
  });

  const results3 = await searchOwnMemory('выбор технологии');
  console.log('\nQuery "выбор технологии":');
  results3.forEach((r: any) => {
    console.log(`  - ${r.content} (similarity: ${r.similarity?.toFixed(3)})`);
  });

  console.log('\n✅ Memory store test complete!');
}

main().catch(console.error);
