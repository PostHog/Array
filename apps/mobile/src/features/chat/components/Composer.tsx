import { GlassContainer, GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { ArrowUp, Microphone, Stop } from "phosphor-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Platform,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useVoiceRecording } from "../hooks/useVoiceRecording";

interface ComposerProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  isUserTurn?: boolean;
}

function PulsingBorder({ active, color }: { active: boolean; color: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      opacity.setValue(0);
      animRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      animRef.current = null;
      opacity.setValue(0);
    }
    return () => {
      animRef.current?.stop();
    };
  }, [active, opacity]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity,
        borderWidth: 2,
        borderColor: color,
        borderRadius: 24,
      }}
    />
  );
}

export function Composer({
  onSend,
  onStop,
  disabled = false,
  placeholder = "Ask a question",
  isUserTurn = false,
}: ComposerProps) {
  const themeColors = useThemeColors();
  const [message, setMessage] = useState("");

  const appendTranscript = useCallback((transcript: string) => {
    setMessage((prev) => (prev ? `${prev} ${transcript}` : transcript));
  }, []);

  const { status, startRecording, stopRecording, cancelRecording } =
    useVoiceRecording({ onTranscript: appendTranscript });

  const isRecording = status === "recording";
  const isTranscribing = status === "transcribing";

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    setMessage("");
    Keyboard.dismiss();
    onSend(trimmed);
  };

  const handleMicPress = async () => {
    if (isRecording) {
      await stopRecording();
    } else if (!isTranscribing) {
      await startRecording();
    }
  };

  const handleMicLongPress = async () => {
    if (isRecording) {
      await cancelRecording();
    }
  };

  const canSend = message.trim().length > 0 && !disabled && !isRecording;
  const showStop =
    !isUserTurn && !canSend && !isRecording && !isTranscribing && !!onStop;

  const handleStop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStop?.();
  };
  const effectivePlaceholder = placeholder;

  if (Platform.OS === "ios") {
    return (
      <View
        style={{
          paddingHorizontal: 8,
        }}
      >
        {/* <LinearGradient
          colors={[
            toRgba(themeColors.background, 0),
            toRgba(themeColors.background, 1),
          ]}
          style={{
            position: "absolute",
            top: -40,
            left: 0,
            right: 0,
            bottom: -40,
          }}
          pointerEvents="none"
        /> */}
        <GlassContainer
          spacing={8}
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          {/* Input field with pulsing border when it's the user's turn */}
          <View style={{ flex: 1, position: "relative" }}>
            <PulsingBorder active={isUserTurn} color={themeColors.accent[9]} />
            <GlassView
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 24,
                paddingHorizontal: 16,
                paddingVertical: 12,
                justifyContent: "center",
              }}
              isInteractive
            >
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={
                  isRecording
                    ? "Recording..."
                    : isTranscribing
                      ? "Transcribing..."
                      : effectivePlaceholder
                }
                placeholderTextColor={themeColors.gray[9]}
                editable={!disabled && !isRecording}
                multiline
                numberOfLines={8}
                style={{
                  fontSize: 16,
                  color: themeColors.gray[12],
                  paddingTop: 0,
                  paddingBottom: 0,
                }}
              />
            </GlassView>
          </View>

          {/* Mic / Send / Stop button */}
          <TouchableOpacity
            onPress={
              canSend ? handleSend : showStop ? handleStop : handleMicPress
            }
            onLongPress={handleMicLongPress}
            activeOpacity={0.7}
            disabled={isTranscribing || disabled}
          >
            <GlassView
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                justifyContent: "center",
                alignItems: "center",
              }}
              isInteractive
            >
              {isTranscribing ? (
                <ActivityIndicator size="small" color={themeColors.gray[12]} />
              ) : canSend ? (
                <ArrowUp size={20} color={themeColors.gray[12]} weight="bold" />
              ) : isRecording || showStop ? (
                <Stop
                  size={20}
                  color={themeColors.status.error}
                  weight="fill"
                />
              ) : (
                <Microphone size={20} color={themeColors.gray[12]} />
              )}
            </GlassView>
          </TouchableOpacity>
        </GlassContainer>
      </View>
    );
  }
}
