import { NextResponse } from 'next/server';
import { forgetMemoryControl } from '@/memory/control';
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

  if (typeof parsed.body.query !== 'string' || parsed.body.query.length === 0) {
    return NextResponse.json(
      { error: { code: 'missing_query', message: 'query is required' } },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await forgetMemoryControl(parsed.body.query, parsed.context, {
        exact: parsed.body.exact === true,
      }),
    );
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
