import { createHash, randomUUID } from "node:crypto";
export class BusinessError extends Error {
  constructor(
    public code: string,
    public retryAfterSeconds?: number,
  ) {
    super(code);
  }
}
export function fail(code: string): never {
  throw new BusinessError(code);
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const uuid = () => randomUUID();
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_ARGUMENT");
  return value as Record<string, unknown>;
}
export function fields(
  value: unknown,
  allowed: string[],
): Record<string, unknown> {
  const v = object(value);
  if (Object.keys(v).some((k) => !allowed.includes(k)))
    fail("INVALID_ARGUMENT");
  return v;
}
export function str(v: unknown, max = 128): string {
  if (typeof v !== "string" || !v.length || v.length > max)
    fail("INVALID_ARGUMENT");
  return v;
}
export function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    fail("INVALID_ARGUMENT");
  return v;
}
export const overlap = (
  a: { startTime: number; endTime: number },
  b: { startTime: number; endTime: number },
) => a.startTime < b.endTime && a.endTime > b.startTime;
export const stamped = (data: Record<string, unknown>, now: number) => ({
  ...data,
  createdAt: now,
  updatedAt: now,
});
