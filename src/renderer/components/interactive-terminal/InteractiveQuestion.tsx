import { CheckCircledIcon } from "@radix-ui/react-icons";
import { Box, Flex, Text, TextArea } from "@radix-ui/themes";
import type { ClarifyingQuestion, QuestionAnswer } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

interface InteractiveQuestionProps {
  question: ClarifyingQuestion;
  answer?: QuestionAnswer;
  isActive: boolean;
  onAnswer: (answer: QuestionAnswer) => void;
  onNext: () => void;
}

export function InteractiveQuestion({
  question,
  answer,
  isActive,
  onAnswer,
  onNext,
}: InteractiveQuestionProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(
    answer ? question.options.indexOf(answer.selectedOption) : 0,
  );
  const [showInput, setShowInput] = useState(false);
  const [customInput, setCustomInput] = useState(answer?.customInput || "");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const isAnswered = !!answer;

  useEffect(() => {
    if (showInput && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [showInput]);

  const handleSelect = useCallback(() => {
    const selectedOption = question.options[selectedIndex];
    const needsInput =
      selectedOption.toLowerCase().includes("something else") ||
      selectedOption.toLowerCase().includes("please specify");

    if (needsInput && !customInput.trim()) {
      setShowInput(true);
      return;
    }

    onAnswer({
      questionId: question.id,
      selectedOption,
      customInput: customInput.trim() || undefined,
    });
    onNext();
  }, [question, selectedIndex, customInput, onAnswer, onNext]);

  const handleTextSubmit = useCallback(() => {
    if (customInput.trim()) {
      onAnswer({
        questionId: question.id,
        selectedOption: question.options[selectedIndex],
        customInput: customInput.trim(),
      });
      onNext();
    }
  }, [customInput, question, selectedIndex, onAnswer, onNext]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive || isAnswered) return;

      if (showInput) {
        // In text input mode
        if (e.key === "Escape") {
          e.preventDefault();
          setShowInput(false);
          setCustomInput("");
        }
        // Let Enter be handled by the TextArea's onKeyDown
        return;
      }

      // Navigation mode
      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < question.options.length - 1 ? prev + 1 : prev,
          );
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          handleSelect();
          break;
      }
    },
    [isActive, isAnswered, showInput, question, handleSelect],
  );

  useEffect(() => {
    if (isActive && !isAnswered) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
    return undefined;
  }, [isActive, isAnswered, handleKeyDown]);

  return (
    <Box
      mb="4"
      p="3"
      style={{
        border: `1px solid ${isActive ? "var(--accent-9)" : "var(--gray-6)"}`,
        borderRadius: "var(--radius-2)",
        backgroundColor: isActive ? "var(--accent-2)" : "var(--gray-2)",
        opacity: isAnswered ? 0.7 : 1,
      }}
    >
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          {isAnswered && <CheckCircledIcon color="green" />}
          <Text size="3" weight="bold">
            {question.question}
          </Text>
        </Flex>

        <Box ml="4">
          {question.options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isAnsweredOption =
              isAnswered && answer?.selectedOption === option;

            return (
              <Flex
                key={`${question.id}-${index}`}
                align="center"
                gap="2"
                py="1"
                px="2"
                style={{
                  backgroundColor:
                    isActive && isSelected ? "var(--accent-4)" : "transparent",
                  borderRadius: "var(--radius-1)",
                  cursor: isActive && !isAnswered ? "pointer" : "default",
                }}
                onClick={() => {
                  if (isActive && !isAnswered) {
                    setSelectedIndex(index);
                    handleSelect();
                  }
                }}
              >
                <Text
                  size="2"
                  style={{
                    fontFamily: "monospace",
                    fontWeight: isAnsweredOption ? "bold" : "normal",
                    color: isAnsweredOption
                      ? "var(--green-11)"
                      : isActive && isSelected
                        ? "var(--accent-12)"
                        : "var(--gray-12)",
                  }}
                >
                  {isActive && isSelected && !isAnswered ? "→ " : "  "}
                  {option}
                </Text>
              </Flex>
            );
          })}
        </Box>

        {showInput && isActive && !isAnswered && (
          <Box ml="4" mt="2">
            <Text size="2" mb="1" style={{ color: "var(--gray-11)" }}>
              Please provide details:
            </Text>
            <TextArea
              ref={textAreaRef}
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleTextSubmit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setShowInput(false);
                  setCustomInput("");
                }
              }}
              placeholder="Type your answer and press Cmd/Ctrl+Enter..."
              rows={3}
              style={{ width: "100%" }}
            />
            <Text size="1" mt="1" style={{ color: "var(--gray-10)" }}>
              Press Cmd/Ctrl+Enter to submit, Esc to cancel
            </Text>
          </Box>
        )}

        {isAnswered && answer?.customInput && (
          <Box ml="4" mt="2">
            <Text
              size="2"
              style={{
                fontStyle: "italic",
                color: "var(--gray-11)",
              }}
            >
              "{answer.customInput}"
            </Text>
          </Box>
        )}

        {isActive && !isAnswered && !showInput && (
          <Text size="1" mt="2" style={{ color: "var(--gray-10)" }}>
            Use ↑↓ or j/k to navigate, Enter to select
          </Text>
        )}
      </Flex>
    </Box>
  );
}
