type Provider = "lodgify" | "openai" | "telegram";

type DiagnosticLevel = "info" | "warn" | "error";

const responseHeaderNames = [
  "x-request-id",
  "request-id",
  "cf-ray",
  "retry-after",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
] as const;

export function logDiagnostic(
  level: DiagnosticLevel,
  event: string,
  details: Record<string, unknown> = {},
): void {
  console[level](JSON.stringify({ event, ...details }));
}

export function logProviderRequest(input: {
  provider: Provider;
  operation: string;
  method: "GET" | "POST";
  durationMs: number;
  status: number | null;
  response?: Response;
  threadId?: string;
  recipientIndex?: number;
  outcome: "success" | "http_error" | "provider_error" | "network_error" | "invalid_response";
  errorType?: string;
  providerErrorCode?: number;
}): void {
  const headers = input.response ? responseDiagnostics(input.response.headers) : {};
  logDiagnostic(input.outcome === "success" ? "info" : "warn", "provider_request", {
    provider: input.provider,
    operation: input.operation,
    method: input.method,
    status: input.status,
    durationMs: input.durationMs,
    outcome: input.outcome,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.recipientIndex !== undefined ? { recipientIndex: input.recipientIndex } : {}),
    ...(input.errorType ? { errorType: input.errorType } : {}),
    ...(input.providerErrorCode ? { providerErrorCode: input.providerErrorCode } : {}),
    ...headers,
  });
}

export function responseDiagnostics(headers: Headers): Record<string, string> {
  const details: Record<string, string> = {};
  for (const name of responseHeaderNames) {
    const value = headers.get(name);
    if (value) details[name] = value.slice(0, 120);
  }
  return details;
}

export function errorType(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}

export function validationIssues(error: {
  issues: { path: PropertyKey[]; code: string }[];
}): { path: string; code: string }[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    code: issue.code,
  }));
}
