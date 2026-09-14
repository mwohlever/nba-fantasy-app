import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getActiveSlateAccessForUser } from '@/lib/groups/context';
import { loadGolfFantasy } from '@/lib/golf/fantasy.server';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Login required.' }, { status: 401 });
  const slateId = Number(request.nextUrl.searchParams.get('slateId'));
  if (!Number.isSafeInteger(slateId) || slateId <= 0) return NextResponse.json({ error: 'Valid slate required.' }, { status: 400 });
  const access = await getActiveSlateAccessForUser(user, slateId);
  if (!access || access.slate.sport !== 'golf') return NextResponse.json({ error: 'Golf slate not found in this Group.' }, { status: 404 });
  try {
    return NextResponse.json(await loadGolfFantasy(slateId, { groupId: access.context.group.id }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Golf Scores unavailable.' }, { status: 500 });
  }
}
