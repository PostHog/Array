/**
 * Whether a local desktop session should enable agent spoken narration
 * (the `speak` tool and its prompt instructions). Strictly opt-in: the
 * rollout feature flag, the user's spoken-notifications setting, and a
 * configured ElevenLabs key must all be present. The host supplies each
 * fact through `SessionServiceDeps.settings`; this rule keeps the gate in
 * one tested place for both the start and reconnect paths.
 */
export function resolveLocalSpokenNarration(settings: {
  spokenNarrationFlagEnabled?: boolean;
  spokenNotifications?: boolean;
  elevenLabsKeyConfigured?: boolean;
}): boolean {
  return (
    settings.spokenNarrationFlagEnabled === true &&
    settings.spokenNotifications === true &&
    settings.elevenLabsKeyConfigured === true
  );
}
