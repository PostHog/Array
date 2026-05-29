import {
  electronStorage,
  RENDERER_STATE_STORAGE,
  type RendererStateStorage,
} from "@posthog/ui/shell/rendererStorage";
import { container } from "@renderer/di/container";
import { trpcClient } from "../trpc";

const electronStorageRaw: RendererStateStorage = {
  getItem: async (key: string): Promise<string | null> => {
    return await trpcClient.secureStore.getItem.query({ key });
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await trpcClient.secureStore.setItem.query({ key, value });
  },
  removeItem: async (key: string): Promise<void> => {
    await trpcClient.secureStore.removeItem.query({ key });
  },
};

container
  .bind<RendererStateStorage>(RENDERER_STATE_STORAGE)
  .toConstantValue(electronStorageRaw);

export { electronStorage };
