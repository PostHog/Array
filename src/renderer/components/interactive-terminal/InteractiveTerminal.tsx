import { Box } from "@radix-ui/themes";
import type { ClarifyingQuestion, QuestionAnswer } from "@shared/types";
import { QuestionList } from "./QuestionList";

interface InteractiveTerminalProps {
  questions: ClarifyingQuestion[];
  answers: QuestionAnswer[];
  onAnswersComplete: (answers: QuestionAnswer[]) => void;
  onCancel?: () => void;
}

export function InteractiveTerminal({
  questions,
  answers,
  onAnswersComplete,
  onCancel,
}: InteractiveTerminalProps) {
  return (
    <Box
      height="100%"
      style={{
        overflowY: "auto",
        backgroundColor: "var(--gray-1)",
      }}
    >
      <QuestionList
        questions={questions}
        answers={answers}
        onAnswersComplete={onAnswersComplete}
        onCancel={onCancel}
      />
    </Box>
  );
}
