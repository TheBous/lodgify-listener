import { createTelegramNotifier } from "./adapters/telegram-notifier.js";
import { createTypeSafeTriage } from "./adapters/typesafe-triage.js";
import type { ProcessDependencies } from "./application/process-guest-message.js";
import { type AppConfig, describeConfigError, loadConfig } from "./config.js";

export function createDependencies(config: AppConfig): ProcessDependencies {
  return {
    triage: createTypeSafeTriage(config.typesafeApiKey),
    notifyOwner: createTelegramNotifier(config.telegramBotToken, config.telegramChatId),
  };
}

export function createDefaultDependencies(): ProcessDependencies {
  const loaded = loadConfig(process.env);
  if (!loaded.ok) throw new Error(describeConfigError(loaded.error));
  return createDependencies(loaded.value);
}
