import { Text } from "@components/text";
import {
  INBOX_FEEDBACK_NOTE_MAX_LENGTH,
  INITIAL_INBOX_REPORT_FEEDBACK_STATE,
  type InboxReportFeedbackEvent,
  type InboxReportFeedbackSentiment,
  reduceInboxReportFeedback,
} from "@posthog/shared";
import * as Haptics from "expo-haptics";
import { ThumbsDown, ThumbsUp } from "phosphor-react-native";
import { type ReactNode, useCallback, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import {
  ANALYTICS_EVENTS,
  computeReportAgeHours,
  useAnalytics,
} from "@/lib/analytics";
import { useThemeColors } from "@/lib/theme";
import type { SignalReport } from "../types";

/**
 * Thumbs rating at the end of the report body, mirroring the desktop and web
 * footers: the rating submits on the first tap, and only once it's recorded does
 * an optional note appear, so the note can never gate the rating. The state and
 * the one-event-per-thumb rules come from `reduceInboxReportFeedback` in
 * `@posthog/shared`, so all three clients emit the same labels.
 */
export function ReportFeedbackFooter({ report }: { report: SignalReport }) {
  const themeColors = useThemeColors();
  const analytics = useAnalytics();
  const [state, setState] = useState(INITIAL_INBOX_REPORT_FEEDBACK_STATE);

  const dispatch = useCallback(
    (event: InboxReportFeedbackEvent) => {
      // Reduce outside the state updater — Strict Mode double-invokes updaters
      // in development, which would double-fire the event.
      const { state: next, emit } = reduceInboxReportFeedback(state, event);
      setState(next);
      if (!emit) return;
      const base = {
        report_id: report.id,
        report_title: report.title ?? null,
        report_age_hours: computeReportAgeHours(report.created_at),
        priority: report.priority ?? null,
        actionability: report.actionability ?? null,
        sentiment: emit.sentiment,
        has_pr: !!report.implementation_pr_url,
        surface: "detail_footer" as const,
      };
      if (emit.kind === "feedback") {
        analytics.track(ANALYTICS_EVENTS.INBOX_REPORT_FEEDBACK, base);
      } else {
        analytics.track(ANALYTICS_EVENTS.INBOX_REPORT_FEEDBACK_NOTE, {
          ...base,
          note: emit.note,
        });
      }
    },
    [analytics, report, state],
  );

  const rate = useCallback(
    (sentiment: InboxReportFeedbackSentiment) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      dispatch({ kind: "rate", sentiment });
    },
    [dispatch],
  );

  const noteReady = state.noteDraft.trim().length > 0;

  return (
    <View className="mt-2 mb-4 gap-2">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-[12px] text-gray-9">
          {state.sentiment ? "Thanks for the feedback" : "Was this useful?"}
        </Text>
        <ThumbButton
          label="This report was useful"
          selected={state.sentiment === "positive"}
          onPress={() => rate("positive")}
        >
          <ThumbsUp
            size={15}
            weight={state.sentiment === "positive" ? "fill" : "regular"}
            color={
              state.sentiment === "positive" ? "#ffffff" : themeColors.gray[11]
            }
          />
        </ThumbButton>
        <ThumbButton
          label="This report was not useful"
          selected={state.sentiment === "negative"}
          onPress={() => rate("negative")}
        >
          <ThumbsDown
            size={15}
            weight={state.sentiment === "negative" ? "fill" : "regular"}
            color={
              state.sentiment === "negative" ? "#ffffff" : themeColors.gray[11]
            }
          />
        </ThumbButton>
        {state.sentiment && !state.noteOpen && !state.noteSent && (
          <Pressable
            onPress={() => dispatch({ kind: "open_note" })}
            hitSlop={6}
            accessibilityRole="button"
            className="py-1 active:opacity-60"
          >
            <Text className="text-[12px] text-accent-11">Add a note</Text>
          </Pressable>
        )}
        {state.noteSent && (
          <Text className="text-[12px] text-gray-9">Note added</Text>
        )}
      </View>

      {state.noteOpen && (
        <View className="items-start gap-2">
          <TextInput
            value={state.noteDraft}
            onChangeText={(draft) =>
              dispatch({ kind: "set_note_draft", draft })
            }
            placeholder="What was useful or off?"
            placeholderTextColor={themeColors.gray[9]}
            accessibilityLabel="Add a note about this report"
            multiline
            maxLength={INBOX_FEEDBACK_NOTE_MAX_LENGTH}
            autoFocus
            className="min-h-[72px] w-full rounded-xl bg-gray-2 px-3 py-3 text-[14px] text-gray-12"
            style={{ textAlignVertical: "top" }}
          />
          <Pressable
            onPress={() => dispatch({ kind: "submit_note" })}
            disabled={!noteReady}
            accessibilityRole="button"
            accessibilityLabel="Send note"
            accessibilityState={{ disabled: !noteReady }}
            className={`rounded-full bg-accent-9 px-4 py-2 active:opacity-80 ${
              noteReady ? "" : "opacity-40"
            }`}
          >
            <Text className="font-semibold text-[13px] text-white">Send</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ThumbButton({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      className={`rounded-full border px-3 py-2 active:opacity-70 ${
        selected ? "border-accent-9 bg-accent-9" : "border-gray-6 bg-background"
      }`}
    >
      {children}
    </Pressable>
  );
}
