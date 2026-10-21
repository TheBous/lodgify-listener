import type { z } from "zod";

/** Describe rejected fields without copying their values into logs. */
export function schemaIssues(error: z.ZodError, input: unknown): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".") || "(root)";
      const value = issue.path.reduce<unknown>(
        (current, key) =>
          current && typeof current === "object"
            ? (current as Record<string, unknown>)[String(key)]
            : undefined,
        input,
      );
      return `${path}:${issue.code}:${valueShape(value)}`;
    })
    .join(", ");
}

function valueShape(value: unknown): string {
  if (value === undefined) return "(absent)";
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "object") return Array.isArray(value) ? "array" : "object";
  if (typeof value !== "string") return typeof value;
  return value.replace(/[a-z]/gi, "a").replace(/\d/g, "d").slice(0, 60) || "(empty)";
}
