import type { RecentsService } from "./recentsService";

export const RECENTS_SERVICE = Symbol.for("posthog.core.recents.service");
export type IRecentsService = Pick<RecentsService, "list" | "record">;
