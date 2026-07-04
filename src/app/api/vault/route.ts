import { NextRequest, NextResponse } from 'next/server';
import { ensureUserVault, listVaultItems } from '@/vault';

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

    return NextResponse.json({ vault, items });
  } catch (error) {
    console.error('[Vault API] Error:', error);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to fetch vault' } },
      { status: 500 },
    );
  }
}
