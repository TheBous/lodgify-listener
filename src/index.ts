import { config } from "./config.js";
import { createApp } from "./server.js";

createApp().listen(config.port, () => {
  console.log(`lodgify-listener listening on :${config.port}`);
});
