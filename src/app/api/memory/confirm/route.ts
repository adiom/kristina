import { NextResponse } from 'next/server';
import { confirmMemoryControl } from '@/memory/control';
import {
  authorizeMemoryRequest,
  memoryErrorResponse,
  parseMemoryRequest,
} from '@/transport/memory-http';

export async function POST(request: Request) {
  const parsed = await parseMemoryRequest(request);
  if (parsed instanceof NextResponse) return parsed;

  const unauthorized = await authorizeMemoryRequest(
    request,
    parsed.rawBody,
    parsed.context,
    true,
  );
  if (unauthorized) return unauthorized;

  const memoryId = typeof parsed.body.memoryId === 'string' ? parsed.body.memoryId : undefined;
  const query = typeof parsed.body.query === 'string' ? parsed.body.query : undefined;
  if (!memoryId && !query) {
    return NextResponse.json(
      {
        error: {
          code: 'missing_target',
          message: 'memoryId or query is required',
        },
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await confirmMemoryControl({ memoryId, query }, parsed.context),
    );
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
