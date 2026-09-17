const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const config = {
  get port(): number {
    return Number(process.env.PORT ?? 3000);
  },
  get lodgifyApiKey(): string {
    return required("LODGIFY_API_KEY");
  },
  get telegramBotToken(): string {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get telegramChatId(): string {
    return required("TELEGRAM_CHAT_ID");
  },
};
