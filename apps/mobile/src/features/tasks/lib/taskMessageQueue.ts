import { CloudTaskQueue } from "@posthog/core/sessions/cloudTaskQueue";
import type { PendingAttachment } from "../composer/attachments/types";

let queueId = 0;

export const taskMessageQueue = new CloudTaskQueue<PendingAttachment>({
  createId: () => `queue-${++queueId}`,
});
