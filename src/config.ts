import type { Result } from "./domain/result.js";

export interface AppConfig {
  port: number;
  typesafeApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
}

export type ConfigError = { kind: "missing"; name: string } | { kind: "invalid-port" };

export function loadConfig(env: NodeJS.ProcessEnv): Result<AppConfig, ConfigError> {
  const port = parsePort(env.PORT);
  if (!port.ok) return port;
  const typesafeApiKey = required(env, "TYPESAFE_API_KEY");
  if (!typesafeApiKey.ok) return typesafeApiKey;
  const telegramBotToken = required(env, "TELEGRAM_BOT_TOKEN");
  if (!telegramBotToken.ok) return telegramBotToken;
  const telegramChatId = required(env, "TELEGRAM_CHAT_ID");
  if (!telegramChatId.ok) return telegramChatId;
  return {
    ok: true,
    value: {
      port: port.value,
      typesafeApiKey: typesafeApiKey.value,
      telegramBotToken: telegramBotToken.value,
      telegramChatId: telegramChatId.value,
    },
  };
}

function required(env: NodeJS.ProcessEnv, name: string): Result<string, ConfigError> {
  const value = env[name];
  return value ? { ok: true, value } : { ok: false, error: { kind: "missing", name } };
}

function parsePort(value: string | undefined): Result<number, ConfigError> {
  if (value === undefined) return { ok: true, value: 3000 };
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535
    ? { ok: true, value: port }
    : { ok: false, error: { kind: "invalid-port" } };
}

export function describeConfigError(error: ConfigError): string {
  return error.kind === "missing" ? `Missing required env var: ${error.name}` : "Invalid PORT";
}
