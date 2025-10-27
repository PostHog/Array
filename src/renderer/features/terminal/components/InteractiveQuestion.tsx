import { PencilSimpleIcon } from "@phosphor-icons/react";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { Box, Flex, Text, TextArea } from "@radix-ui/themes";
import type { ClarifyingQuestion, QuestionAnswer } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface InteractiveQuestionProps {
  question: ClarifyingQuestion;
  answer?: QuestionAnswer;
  isActive: boolean;
  onAnswer: (answer: QuestionAnswer) => void;
  onNext: () => void;
  onClearAnswer?: () => void;
}

// Convert index to letter (0 -> 'a', 1 -> 'b', etc.)
const indexToLetter = (index: number): string => {
  return String.fromCharCode(97 + index); // 97 is 'a' in ASCII
};

const SOMETHING_ELSE_OPTION = "Something else? (Please specify)";

export function InteractiveQuestion({
  question,
  answer,
  isActive,
  onAnswer,
  onNext,
  onClearAnswer,
}: InteractiveQuestionProps) {
  // Automatically add "Something else" option to all questions
  const allOptions = useMemo(
    () => [...question.options, SOMETHING_ELSE_OPTION],
    [question.options],
  );
  const somethingElseIndex = allOptions.length - 1;

  const [selectedIndex, setSelectedIndex] = useState<number>(() => {
    if (answer) {
      if (answer.customInput) {
        return somethingElseIndex;
      }
      const index = question.options.indexOf(answer.selectedOption);
      return index >= 0 ? index : 0;
    }
    return 0;
  });
  const [showInput, setShowInput] = useState(!!answer?.customInput);
  const [customInput, setCustomInput] = useState(answer?.customInput || "");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const isAnswered = !!answer;

  useEffect(() => {
    if (showInput && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [showInput]);

  const handleSelect = useCallback(
    (optionIndex?: number) => {
      const index = optionIndex ?? selectedIndex;
      const isSomethingElse = index === somethingElseIndex;

      if (isSomethingElse && !customInput.trim()) {
        setSelectedIndex(index);
        setShowInput(true);
        return;
      }

      onAnswer({
        questionId: question.id,
        selectedOption: isSomethingElse
          ? SOMETHING_ELSE_OPTION
          : allOptions[index],
        customInput: customInput.trim() || undefined,
      });
      onNext();
    },
    [
      question,
      selectedIndex,
      customInput,
      onAnswer,
      onNext,
      somethingElseIndex,
      allOptions,
    ],
  );

  const handleTextSubmit = useCallback(() => {
    if (customInput.trim()) {
      onAnswer({
        questionId: question.id,
        selectedOption: SOMETHING_ELSE_OPTION,
        customInput: customInput.trim(),
      });
      onNext();
    }
  }, [customInput, question, onAnswer, onNext]);

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

      // Check for letter key shortcuts (a, b, c, etc.)
      if (e.key.length === 1 && e.key >= "a" && e.key <= "z") {
        const index = e.key.charCodeAt(0) - 97; // Convert 'a' to 0, 'b' to 1, etc.
        if (index < allOptions.length) {
          e.preventDefault();
          setSelectedIndex(index);
          handleSelect(index);
          return;
        }
      }

      // Navigation mode
      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < allOptions.length - 1 ? prev + 1 : prev,
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
    [isActive, isAnswered, showInput, allOptions.length, handleSelect],
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
        <Flex align="center" justify="between">
          <Flex align="center" gap="2">
            {isAnswered && <CheckCircledIcon color="green" />}
            <Text size="3" weight="bold">
              {question.question}
            </Text>
          </Flex>
          {isAnswered && onClearAnswer && (
            <Box
              style={{
                cursor: "pointer",
                opacity: 0.6,
                transition: "opacity 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "0.6";
              }}
              onClick={onClearAnswer}
            >
              <PencilSimpleIcon size={16} weight="bold" />
            </Box>
          )}
        </Flex>

        <Box ml="4">
          {allOptions.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isHovered = index === hoveredIndex;
            const isAnsweredOption =
              isAnswered && answer?.selectedOption === option;
            const isSomethingElse = index === somethingElseIndex;
            const letter = indexToLetter(index);

            return (
              <Flex
                key={`${question.id}-${index}`}
                align="center"
                gap="2"
                py="1"
                px="2"
                style={{
                  backgroundColor:
                    isActive && isSelected
                      ? "var(--accent-4)"
                      : isActive && isHovered && !isAnswered
                        ? "var(--accent-3)"
                        : "transparent",
                  borderRadius: "var(--radius-1)",
                  cursor: isActive && !isAnswered ? "pointer" : "default",
                  transition: "background-color 0.1s ease",
                }}
                onMouseEnter={() => {
                  if (isActive && !isAnswered) {
                    setHoveredIndex(index);
                  }
                }}
                onMouseLeave={() => {
                  if (isActive && !isAnswered) {
                    setHoveredIndex(null);
                  }
                }}
                onClick={() => {
                  if (isActive && !isAnswered) {
                    setSelectedIndex(index);
                    handleSelect(index);
                  }
                }}
              >
                <Text
                  size="2"
                  weight="bold"
                  style={{
                    fontFamily: "monospace",
                    color: isAnsweredOption
                      ? "var(--green-11)"
                      : isActive && (isSelected || isHovered)
                        ? "var(--accent-11)"
                        : "var(--gray-10)",
                    minWidth: "20px",
                  }}
                >
                  {letter})
                </Text>
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
                    fontStyle: isSomethingElse ? "italic" : "normal",
                  }}
                >
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
            Press letter key (a, b, c...) to select, or use ↑↓/j/k + Enter
          </Text>
        )}
      </Flex>
    </Box>
  );
}
