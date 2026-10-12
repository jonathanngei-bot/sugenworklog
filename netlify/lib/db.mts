import { getDatabase } from "@netlify/database";

/** Shared Postgres client for every Work Diary function. */
export const db = getDatabase();

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/** Reads a JSON body without throwing on an empty or malformed payload. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Coerces anything to a trimmed string. */
export function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

/** UUID, or a time+random fallback for environments without crypto.randomUUID. */
export function uid(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === "function"
    ? c.randomUUID()
    : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
