export { Conversation } from "./autoreply/conversation.js";
export type { WorkerEnv } from "./autoreply/environment.js";

import { handleWorkerRequest } from "./autoreply/http.js";

export default { fetch: handleWorkerRequest };
