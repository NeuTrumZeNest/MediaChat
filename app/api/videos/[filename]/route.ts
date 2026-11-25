import { NextRequest } from "next/server";
import { videoResponse } from "../../../../src/lib/video-response";
export const runtime = "nodejs";
type Context = { params: Promise<{ filename: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  return videoResponse(request, (await params).filename);
}
export async function HEAD(request: NextRequest, { params }: Context) {
  return videoResponse(request, (await params).filename, false, true);
}
