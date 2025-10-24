import { Box, Button, Flex, Heading, Text } from "@radix-ui/themes";
import type { ClarifyingQuestion, QuestionAnswer } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { InteractiveQuestion } from "./InteractiveQuestion";

interface QuestionListProps {
  questions: ClarifyingQuestion[];
  answers: QuestionAnswer[];
  onAnswersComplete: (answers: QuestionAnswer[]) => void;
  onCancel?: () => void;
}

export function QuestionList({
  questions,
  answers: initialAnswers,
  onAnswersComplete,
  onCancel,
}: QuestionListProps) {
  const [answers, setAnswers] = useState<QuestionAnswer[]>(initialAnswers);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(
    initialAnswers.length,
  );

  const handleAnswer = (answer: QuestionAnswer) => {
    setAnswers((prev) => {
      const existingIndex = prev.findIndex(
        (a) => a.questionId === answer.questionId,
      );
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = answer;
        return updated;
      }
      return [...prev, answer];
    });
  };

  const handleClearAnswer = (questionId: string) => {
    setAnswers((prev) => prev.filter((a) => a.questionId !== questionId));
    // Set the current question to the one being edited
    const questionIndex = questions.findIndex((q) => q.id === questionId);
    if (questionIndex >= 0) {
      setCurrentQuestionIndex(questionIndex);
    }
  };

  const handleNext = () => {
    // Only advance to next question, don't auto-submit on last question
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  };

  const handleSubmit = useCallback(() => {
    onAnswersComplete(answers);
  }, [answers, onAnswersComplete]);

  const allAnswered = answers.length === questions.length;
  const progress = `${answers.length}/${questions.length}`;

  // Listen for Cmd/Ctrl+Enter to submit when all questions are answered
  useEffect(() => {
    if (!allAnswered) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [allAnswered, handleSubmit]);

  return (
    <Box p="4">
      <Flex direction="column" gap="3" mb="4">
        <Flex justify="between" align="center">
          <Heading size="5">Clarifying Questions</Heading>
          <Text size="2" style={{ color: "var(--gray-11)" }}>
            {progress} answered
          </Text>
        </Flex>
        <Text size="2" style={{ color: "var(--gray-11)" }}>
          Please answer the following questions to guide the implementation:
        </Text>
      </Flex>

      <Box>
        {questions.map((question, index) => {
          const answer = answers.find((a) => a.questionId === question.id);
          const isActive = index === currentQuestionIndex;

          return (
            <InteractiveQuestion
              key={question.id}
              question={question}
              answer={answer}
              isActive={isActive}
              onAnswer={handleAnswer}
              onNext={handleNext}
              onClearAnswer={() => handleClearAnswer(question.id)}
            />
          );
        })}
      </Box>

      {allAnswered && (
        <Flex direction="column" gap="2" mt="4">
          <Flex gap="2">
            <Button onClick={handleSubmit} size="3" variant="solid">
              Continue
            </Button>
            {onCancel && (
              <Button
                onClick={onCancel}
                size="3"
                variant="outline"
                color="gray"
              >
                Cancel
              </Button>
            )}
          </Flex>
          <Text size="1" style={{ color: "var(--gray-10)" }}>
            Press {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to
            continue
          </Text>
        </Flex>
      )}
    </Box>
  );
}
