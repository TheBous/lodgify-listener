import { readFileSync } from "node:fs";
import { createLodgifyThreadHistory } from "./adapters/lodgify-threads.js";
import { createTelegramNotifier } from "./adapters/telegram-notifier.js";
import { createTypeSafeTriage } from "./adapters/typesafe-triage.js";
import type { ProcessDependencies } from "./application/process-guest-message.js";
import { type AppConfig, describeConfigError, loadConfig } from "./config.js";

export function createDependencies(config: AppConfig): ProcessDependencies {
  return {
    triage: createTypeSafeTriage(config.typesafeApiKey),
    notifyOwner: createTelegramNotifier(config.telegramBotToken, config.telegramChatId),
    threadHistory: createLodgifyThreadHistory(config.lodgifyApiKey),
    propertyContext: loadPropertyContext(config.propertyContextPath),
  };
}

function loadPropertyContext(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`Property context file not found at ${path}, triaging without it`);
    return "";
  }
}

export function createDefaultDependencies(): ProcessDependencies {
  const loaded = loadConfig(process.env);
  if (!loaded.ok) throw new Error(describeConfigError(loaded.error));
  return createDependencies(loaded.value);
}
