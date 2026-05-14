import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { logger } from "@/lib/logger";
import type { WatchTaskCommand, WatchTaskEnvelope } from "./types";

type NativeWatchTaskControlModule = {
  isSupported: () => Promise<boolean>;
  publishEnvelope: (envelope: WatchTaskEnvelope) => Promise<boolean>;
  sendUrgentUpdate: (envelope: WatchTaskEnvelope) => Promise<boolean>;
};

const nativeModule = NativeModules.WatchTaskControlModule as
  | NativeWatchTaskControlModule
  | undefined;

const log = logger.scope("watch-task-control");

const isAvailable = Platform.OS === "ios" && !!nativeModule;
const emitter =
  isAvailable && nativeModule
    ? new NativeEventEmitter(nativeModule as never)
    : null;

export function isWatchTaskControlAvailable(): boolean {
  return isAvailable;
}

export async function isWatchTaskControlSupported(): Promise<boolean> {
  if (!isAvailable || !nativeModule) return false;
  try {
    return await nativeModule.isSupported();
  } catch {
    return false;
  }
}

export async function publishWatchTaskEnvelope(
  envelope: WatchTaskEnvelope,
): Promise<boolean> {
  if (!isAvailable || !nativeModule) {
    log.warn("WatchTaskControl native module is unavailable", {
      platform: Platform.OS,
      hasModule: !!nativeModule,
    });
    return false;
  }
  return nativeModule.publishEnvelope(envelope);
}

export async function sendUrgentWatchTaskUpdate(
  envelope: WatchTaskEnvelope,
): Promise<boolean> {
  if (!isAvailable || !nativeModule) {
    log.warn("WatchTaskControl native module is unavailable", {
      platform: Platform.OS,
      hasModule: !!nativeModule,
    });
    return false;
  }
  return nativeModule.sendUrgentUpdate(envelope);
}

export function subscribeToWatchTaskCommands(
  handler: (command: WatchTaskCommand) => void,
): () => void {
  if (!emitter) return () => {};
  const subscription = emitter.addListener(
    "WatchTaskControlCommand",
    (payload: WatchTaskCommand) => {
      if (
        payload &&
        typeof payload === "object" &&
        typeof payload.type === "string"
      ) {
        handler(payload);
      }
    },
  );
  return () => subscription.remove();
}
