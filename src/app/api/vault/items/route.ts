import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVaultItem, ensureUserVault, listVaultItems } from '@/vault';

const createVaultItemSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().optional(),
  kind: z.enum(['memory', 'user_file', 'agent_file', 'note', 'profile', 'artifact']),
  title: z.string().min(1),
  summary: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  storageKey: z.string().optional(),
  sha256: z.string().optional(),
  source: z.enum(['user', 'agent', 'system']),
  createdByUserId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const userName = searchParams.get('userName') ?? undefined;

    if (!userId) {
      return NextResponse.json(
        { error: { code: 'missing_user_id', message: 'userId is required' } },
        { status: 400 },
      );
    }

    const vault = await ensureUserVault(userId, { displayName: userName });
    const items = await listVaultItems(vault.vaultId);
    return NextResponse.json({ vaultId: vault.vaultId, items });
  } catch (error) {
    console.error('[Vault Items API] Error:', error);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to fetch vault items' } },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = createVaultItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid body' } },
      { status: 400 },
    );
  }

  try {
    const { userId, userName, ...itemInput } = parsed.data;
    const vault = await ensureUserVault(userId, { displayName: userName });
    const item = await createVaultItem({
      vaultId: vault.vaultId,
      ...itemInput,
    });
    return NextResponse.json({ vaultId: vault.vaultId, item }, { status: 201 });
  } catch (error) {
    console.error('[Vault Items API] Error:', error);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to create vault item' } },
      { status: 500 },
    );
  }
}
