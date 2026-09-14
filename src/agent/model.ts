import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const provider = process.env.LLM_PROVIDER || 'lmstudio';

export function getModel() {
  if (provider === 'groq') {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return groq('openai/gpt-oss-120b');
  }

  const lmstudio = createOpenAICompatible({
    name: 'lmstudio',
    baseURL: process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
  });
  return lmstudio('qwen/qwen3-1.7b');
}
