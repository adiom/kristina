import { NextResponse } from 'next/server';
import { memoryStatusControl } from '@/memory/control';
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
    false,
  );
  if (unauthorized) return unauthorized;

  try {
    return NextResponse.json({
      memories: await memoryStatusControl(parsed.context),
    });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
