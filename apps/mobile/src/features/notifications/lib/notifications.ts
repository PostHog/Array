import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { logger } from "@/lib/logger";

const log = logger.scope("notifications");

export interface NotificationData {
  taskId: string;
  taskRunId: string;
}

export type NotificationResponseHandler = (data: NotificationData) => void;

let handlerConfigured = false;

function configureHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Requests permission and returns an Expo push token for this device, or null
 * if permission is denied / not supported (e.g. iOS Simulator).
 */
export async function registerForPushNotificationsAsync(): Promise<
  string | null
> {
  configureHandler();

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    log.debug("Push notification permission not granted", { finalStatus });
    return null;
  }

  if (!Device.isDevice) {
    log.debug("Skipping push token retrieval: not a physical device");
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    log.warn("Missing EAS projectId in app config; cannot fetch push token");
    return null;
  }

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    log.debug("Retrieved Expo push token");
    return tokenResponse.data;
  } catch (err) {
    log.warn("Failed to retrieve Expo push token", { error: err });
    return null;
  }
}

export async function presentLocalNotification(args: {
  title: string;
  body: string;
  data: NotificationData;
}): Promise<void> {
  configureHandler();
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: args.title,
        body: args.body,
        data: args.data as unknown as Record<string, unknown>,
        sound: "default",
      },
      trigger: null,
    });
  } catch (err) {
    log.warn("Failed to present local notification", { error: err });
  }
}

function extractNotificationData(
  response: Notifications.NotificationResponse,
): NotificationData | null {
  const data = response.notification.request.content.data as
    | Partial<NotificationData>
    | undefined;
  if (
    !data ||
    typeof data.taskId !== "string" ||
    typeof data.taskRunId !== "string"
  ) {
    return null;
  }
  return { taskId: data.taskId, taskRunId: data.taskRunId };
}

/**
 * Wires a listener that fires when the user taps a notification. Returns an
 * unsubscribe function. Also checks for a cold-start notification (the app
 * was launched by tapping a notification) and invokes the handler once.
 */
export function setupNotificationResponseListener(
  onTap: NotificationResponseHandler,
): () => void {
  configureHandler();

  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return;
      const data = extractNotificationData(response);
      if (data) onTap(data);
    })
    .catch((err) => {
      log.warn("Failed to read last notification response", { error: err });
    });

  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = extractNotificationData(response);
      if (data) onTap(data);
    },
  );

  return () => subscription.remove();
}
