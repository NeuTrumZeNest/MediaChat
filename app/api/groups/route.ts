import { validMutationOrigin } from "../../../src/lib/request-origin";
import { NextRequest, NextResponse } from 'next/server';
import { authorizeImageRequest } from '../../../src/lib/image-storage';
import { limitedJson } from '../../../src/lib/request-body';
import { createGroup } from '../../../src/lib/groups';
import { consumeLimit } from '../../../src/lib/rate-limit';
export async function POST(request: NextRequest) {
  if (!validMutationOrigin(request) || !request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Недопустимый запрос' }, { status: 403 });
  const auth = await authorizeImageRequest(request); if (!auth.ok) return auth.response;
  if (consumeLimit(`groups:${auth.userId}`, 20, 60000)) return NextResponse.json({ error: 'Подождите минуту' }, { status: 429 });
  try {
    const body = await limitedJson(request) as { title?: unknown; userIds?: unknown };
    return NextResponse.json({ conversationId: await createGroup(auth.userId, body.title, body.userIds) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
