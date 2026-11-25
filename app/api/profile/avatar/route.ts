import { NextRequest } from 'next/server';
import { avatarChange } from '../../../../src/lib/avatar-route';
export const POST = (request: NextRequest) => avatarChange(request, null);
export const DELETE = POST;
