import { NextRequest, NextResponse } from 'next/server';
import { avatarChange } from '../../../../../src/lib/avatar-route';
import { conversationId } from '../../../../../src/lib/conversations';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const id = conversationId((await context.params).id); if (!id) throw new Error(); return avatarChange(request, id); }
  catch { return NextResponse.json({ error: 'Некорректная группа' }, { status: 400 }); }
}
export const DELETE = POST;
