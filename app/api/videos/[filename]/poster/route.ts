import { NextRequest } from "next/server";
import { videoResponse } from "../../../../../src/lib/video-response";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  return videoResponse(request, (await params).filename, true);
}
