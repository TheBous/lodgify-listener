import { createServer, type Server } from "node:http";
import type { ProcessDependencies } from "./application/process-guest-message.js";
import { createMessageProcessor } from "./application/process-guest-message.js";
import { createDefaultDependencies } from "./composition.js";
import { handleLodgifyWebhook } from "./http/lodgify-webhook.js";

export function createApp(dependencies: ProcessDependencies = createDefaultDependencies()): Server {
  const processMessage = createMessageProcessor(dependencies);
  return createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook/lodgify") {
      res.writeHead(404).end();
      return;
    }
    void handleLodgifyWebhook(req, res, processMessage).catch((error: unknown) => {
      console.error("Unhandled webhook error:", error);
      if (!res.headersSent) res.writeHead(500).end("processing failed");
    });
  });
}
