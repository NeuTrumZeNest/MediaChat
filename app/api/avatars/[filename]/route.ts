import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../src/prisma/db';
import { authorizeImageRequest } from '../../../../src/lib/image-storage';
import { avatarFilename, avatarBytes } from '../../../../src/lib/avatar-storage';
import { canAccessConversation } from '../../../../src/lib/conversations';
export async function GET(request: NextRequest, context: { params: Promise<{ filename: string }> }) {
  const auth = await authorizeImageRequest(request); if (!auth.ok) return auth.response;
  const { filename } = await context.params; const url = `/api/avatars/${filename}`;
  if (!avatarFilename(url)) return new NextResponse(null, { status: 404 });
  try {
    const user = await db.orm.public.User.where({ avatarUrl: url }).select('id').first();
    const group = user ? null : await db.orm.public.Conversation.where({ avatarUrl: url, deletedAt: null }).select('id').first();
    if (!user && (!group || !await canAccessConversation(auth.userId, group.id))) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(await avatarBytes(filename)), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
