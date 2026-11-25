import { validMutationOrigin } from "../../../../src/lib/request-origin";
import { NextRequest, NextResponse } from 'next/server';
import { authorizeImageRequest } from '../../../../src/lib/image-storage';
import { conversationId } from '../../../../src/lib/conversations';
import { groupInfo, changeGroup } from '../../../../src/lib/groups';
import { limitedJson } from '../../../../src/lib/request-body';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const auth = await authorizeImageRequest(request); if (!auth.ok) return auth.response;
  try { const id = conversationId((await context.params).id); if (!id) throw new Error('Некорректная группа'); return NextResponse.json(await groupInfo(auth.userId, id)); }
  catch { return NextResponse.json({ error: 'Группа недоступна' }, { status: 403 }); }
}
export async function PATCH(request: NextRequest, context: Context) {
  if (!validMutationOrigin(request) || !request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Недопустимый запрос' }, { status: 403 });
  const auth = await authorizeImageRequest(request); if (!auth.ok) return auth.response;
  try { const id = conversationId((await context.params).id); if (!id) throw new Error('Некорректная группа'); const body = await limitedJson(request) as { action?: unknown; value?: unknown }; await changeGroup(auth.userId, id, body.action, body.value); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 403 }); }
}
