import type { NextConfig } from "next";
import { allowedOrigins } from './src/lib/origin-policy.ts';

const nextConfig: NextConfig = {
  // Отдельный build/dev каталог для проверок, не затрагивающий запущенный dev-сервер.
  distDir: process.env.MEDIA_CHAT_DIST_DIR || ".next",
  allowedDevOrigins: [...new Set([...allowedOrigins()].map((origin) => new URL(origin).hostname))],
};

export default nextConfig;
