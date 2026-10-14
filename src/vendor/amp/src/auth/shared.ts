import type { Request } from "express";

export function extractBearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ", 2);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}
