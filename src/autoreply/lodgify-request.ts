import { errorType, logProviderRequest } from "./diagnostics.js";

export async function requestLodgify(input: {
  apiKey: string;
  operation: string;
  label: string;
  kind: "read" | "send";
  method: "GET" | "POST";
  path: string;
  threadId: string;
  body?: string;
}): Promise<Response> {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`https://api.lodgify.com${input.path}`, {
      method: input.method,
      headers: {
        "X-ApiKey": input.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(4000),
      ...(input.body ? { body: input.body } : {}),
    });
  } catch (error) {
    logProviderRequest({
      provider: "lodgify",
      operation: input.operation,
      method: input.method,
      durationMs: Date.now() - startedAt,
      status: null,
      threadId: input.threadId,
      outcome: "network_error",
      errorType: errorType(error),
    });
    throw new Error(`Lodgify ${input.label} ${input.kind} network failure (${errorType(error)})`);
  }
  logProviderRequest({
    provider: "lodgify",
    operation: input.operation,
    method: input.method,
    durationMs: Date.now() - startedAt,
    status: response.status,
    response,
    threadId: input.threadId,
    outcome: response.ok ? "success" : "http_error",
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const retryHint = retryAfter
      ? /^\d+$/.test(retryAfter)
        ? ` retry-after=${retryAfter}s`
        : ` retry-after-date=${retryAfter}`
      : "";
    const hint = response.status === 429 ? retryHint : "";
    throw new Error(`Lodgify ${input.kind} failed (${response.status}) ${input.label}${hint}`);
  }
  return response;
}
