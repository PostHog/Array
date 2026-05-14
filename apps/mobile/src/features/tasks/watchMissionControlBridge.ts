import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { logger } from "@/lib/logger";
import type { WatchMissionCommand, WatchMissionEnvelope } from "./types";

type NativeWatchMissionControlModule = {
  isSupported: () => Promise<boolean>;
  publishEnvelope: (envelope: WatchMissionEnvelope) => Promise<boolean>;
  sendUrgentUpdate: (envelope: WatchMissionEnvelope) => Promise<boolean>;
};

const nativeModule = NativeModules.WatchMissionControlModule as
  | NativeWatchMissionControlModule
  | undefined;

const log = logger.scope("watch-mission-control");

const isAvailable = Platform.OS === "ios" && !!nativeModule;
const emitter =
  isAvailable && nativeModule
    ? new NativeEventEmitter(nativeModule as never)
    : null;

export function isWatchMissionControlAvailable(): boolean {
  return isAvailable;
}

export async function isWatchMissionControlSupported(): Promise<boolean> {
  if (!isAvailable || !nativeModule) return false;
  try {
    return await nativeModule.isSupported();
  } catch {
    return false;
  }
}

export async function publishWatchMissionEnvelope(
  envelope: WatchMissionEnvelope,
): Promise<boolean> {
  if (!isAvailable || !nativeModule) {
    log.warn("WatchMissionControl native module is unavailable", {
      platform: Platform.OS,
      hasModule: !!nativeModule,
    });
    return false;
  }
  return nativeModule.publishEnvelope(envelope);
}

export async function sendUrgentWatchMissionUpdate(
  envelope: WatchMissionEnvelope,
): Promise<boolean> {
  if (!isAvailable || !nativeModule) {
    log.warn("WatchMissionControl native module is unavailable", {
      platform: Platform.OS,
      hasModule: !!nativeModule,
    });
    return false;
  }
  return nativeModule.sendUrgentUpdate(envelope);
}

export function subscribeToWatchMissionCommands(
  handler: (command: WatchMissionCommand) => void,
): () => void {
  if (!emitter) return () => {};
  const subscription = emitter.addListener(
    "WatchMissionControlCommand",
    (payload: WatchMissionCommand) => {
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
