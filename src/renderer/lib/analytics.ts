import posthog from "posthog-js/dist/module.full.no-external";
import {
  ANALYTICS_EVENTS,
  type RepositorySelectProperties,
  type TaskCreateProperties,
  type TaskListViewProperties,
  type TaskRunProperties,
  type TaskViewProperties,
  type UserIdentifyProperties,
} from "../../types/analytics";

let isInitialized = false;

export function initializePostHog() {
  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
  const apiHost =
    import.meta.env.VITE_POSTHOG_API_HOST || "https://internal-c.posthog.com";
  const uiHost =
    import.meta.env.VITE_POSTHOG_UI_HOST || "https://us.i.posthog.com";

  if (!apiKey || isInitialized) {
    return;
  }

  posthog.init(apiKey, {
    api_host: apiHost,
    ui_host: uiHost,
    capture_pageview: false,
    capture_pageleave: false,
  });

  isInitialized = true;
}

export function identifyUser(
  userId: string,
  properties?: UserIdentifyProperties,
) {
  if (!isInitialized) return;

  posthog.identify(userId, properties);
}

export function resetUser() {
  if (!isInitialized) return;

  posthog.reset();
}

export function trackTaskListView(properties?: TaskListViewProperties) {
  if (!isInitialized) return;

  posthog.capture(ANALYTICS_EVENTS.TASK_LIST_VIEWED, properties);
}

export function trackTaskCreate(properties: TaskCreateProperties) {
  if (!isInitialized) return;

  posthog.capture(ANALYTICS_EVENTS.TASK_CREATED, properties);
}

export function trackTaskView(properties: TaskViewProperties) {
  if (!isInitialized) return;

  posthog.capture(ANALYTICS_EVENTS.TASK_VIEWED, properties);
}

export function trackTaskRun(properties: TaskRunProperties) {
  if (!isInitialized) return;

  posthog.capture(ANALYTICS_EVENTS.TASK_RUN, properties);
}

export function trackRepositorySelect(properties: RepositorySelectProperties) {
  if (!isInitialized) return;

  posthog.capture(ANALYTICS_EVENTS.REPOSITORY_SELECTED, properties);
}

export function trackUserLoggedIn(properties?: UserIdentifyProperties) {
  if (!isInitialized) return;

  posthog.capture(ANALYTICS_EVENTS.USER_LOGGED_IN, properties);
}

export function trackUserLoggedOut() {
  if (!isInitialized) return;

  posthog.capture(ANALYTICS_EVENTS.USER_LOGGED_OUT);
}
