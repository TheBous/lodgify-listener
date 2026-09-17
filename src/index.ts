import { createDependencies } from "./composition.js";
import { describeConfigError, loadConfig } from "./config.js";
import { createApp } from "./server.js";

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(describeConfigError(loaded.error));
  process.exitCode = 1;
} else {
  createApp(createDependencies(loaded.value)).listen(loaded.value.port, () => {
    console.log(`lodgify-listener listening on :${loaded.value.port}`);
  });
}
