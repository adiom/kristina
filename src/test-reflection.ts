import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  console.log('Starting reflection test...');
  const { runReflection } = await import('./reflection/index');
  console.log('Module loaded, running reflection...');
  const result = await runReflection('нейросети');
  console.log('Done!');
  console.log('Topic:', result.topic);
  console.log('Insights:', result.insights.length);
  console.log('Diary:', result.diaryEntry.substring(0, 300));
}

main().catch(e => { console.error(e); process.exit(1); });
