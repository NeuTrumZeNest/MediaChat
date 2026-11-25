import { validMutationOrigin } from '../../../src/lib/request-origin';
import { InputError, limitedJson } from '../../../src/lib/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeImageRequest } from '../../../src/lib/image-storage';
import { conversationId, createDirectConversation, listConversations, publishConversation } from '../../../src/lib/conversations';
import { consumeLimit } from '../../../src/lib/rate-limit';

export async function GET(request: NextRequest) {
  const auth = await authorizeImageRequest(request);
  if (!auth.ok) return auth.response;
  try { return NextResponse.json({ conversations: await listConversations(auth.userId) }); }
  catch (error) { console.error('Список переписок:', error); return NextResponse.json({ error: 'Не удалось загрузить переписки' }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  const auth = await authorizeImageRequest(request);
  if (!auth.ok) return auth.response;
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return NextResponse.json({ error: 'Ожидается JSON' }, { status: 415 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });
  if (consumeLimit(`direct:${auth.userId}`, 30, 60_000)) return NextResponse.json({ error: 'Слишком много запросов. Подождите минуту.' }, { status: 429 });
  if (Number(request.headers.get('content-length')) > 1024) return NextResponse.json({ error: 'Слишком большой запрос' }, { status: 413 });
  try {
    const body = await limitedJson(request);
    const peerId = conversationId(body && typeof body === 'object' && 'userId' in body ? body.userId : null);
    if (!peerId) throw new Error('Укажите пользователя');
    const row = await createDirectConversation(auth.userId, peerId);
    await publishConversation([auth.userId, peerId], row.id);
    return NextResponse.json({ conversationId: row.id });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = (error as Error).message;
    if (['Нельзя создать переписку с собой', 'Пользователь не найден', 'Некорректный идентификатор переписки', 'Укажите пользователя'].includes(message) || error instanceof SyntaxError)
      return NextResponse.json({ error: error instanceof SyntaxError ? 'Некорректный запрос' : message }, { status: 400 });
    console.error('Создание переписки:', error); return NextResponse.json({ error: 'Не удалось создать переписку' }, { status: 500 });
  }
}
