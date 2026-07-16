const ALLOWED_ORIGINS = new Set([
  "https://keepon-web.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export function resolveAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): HeadersInit {
  const allowed = resolveAllowedOrigin(origin);
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

// サーバーレス関数のウォームインスタンス内でのみ有効な簡易レート制限。
// インスタンスをまたぐ厳密な制限が必要になったら外部ストア（Upstash Redis等）に置き換える。
const requestLog = new Map<string, number[]>();

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(ip) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(ip, timestamps);
    return true;
  }

  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return false;
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
