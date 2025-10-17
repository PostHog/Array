import { Box, Button, Flex, Heading, Text } from "@radix-ui/themes";
import type { ClarifyingQuestion, QuestionAnswer } from "@shared/types";
import { useState } from "react";
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

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    } else {
      // All questions answered
      onAnswersComplete(answers);
    }
  };

  const handleSubmit = () => {
    onAnswersComplete(answers);
  };

  const allAnswered = answers.length === questions.length;
  const progress = `${answers.length}/${questions.length}`;

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
          Please answer the following questions to guide the implementation
          planning:
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
            />
          );
        })}
      </Box>

      {allAnswered && (
        <Flex gap="2" mt="4">
          <Button onClick={handleSubmit} size="3" variant="solid">
            Generate Plan
          </Button>
          {onCancel && (
            <Button onClick={onCancel} size="3" variant="outline" color="gray">
              Cancel
            </Button>
          )}
        </Flex>
      )}
    </Box>
  );
}
