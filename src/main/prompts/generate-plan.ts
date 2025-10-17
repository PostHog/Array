import type { QuestionAnswer } from "../../shared/types";

export function buildPlanningPrompt(
  taskTitle: string,
  taskDescription: string,
  questionAnswers: QuestionAnswer[],
): string {
  const answersText = questionAnswers
    .map((answer) => {
      const customText = answer.customInput
        ? ` (Details: ${answer.customInput})`
        : "";
      return `- ${answer.questionId}: ${answer.selectedOption}${customText}`;
    })
    .join("\n");

  return `You are a planning agent creating implementation plans.

# TASK
**Title**: ${taskTitle}
**Description**: ${taskDescription}

# USER'S IMPLEMENTATION PREFERENCES
Based on the research phase, the user has provided these answers to guide the implementation:

${answersText}

# YOUR GOAL
Generate a detailed, actionable implementation plan in markdown format that takes the user's preferences into account.

# PLAN STRUCTURE
Your plan should include the following sections:

## Overview
Brief summary of what will be implemented and the overall approach

## Implementation Approach
High-level strategy based on the user's answers to the clarifying questions

## Files to Create/Modify
List each file that needs to be created or modified with:
- File path
- Purpose/changes needed
- Key functions/components to add

## Step-by-Step Implementation
1. First step (e.g., "Add types to types.ts")
   - Specific changes
   - Code snippets if helpful
2. Second step
   - ...
3. Continue with all steps in logical order

## Testing Strategy
- How to verify the implementation works
- Manual testing steps
- Edge cases to consider

## Considerations
- Dependencies between changes
- Potential risks or gotchas
- Performance or security considerations
- Migration or backward compatibility notes

# INSTRUCTIONS
1. Write the plan in clean, well-formatted markdown
2. Be specific about file paths and function names
3. Include code snippets for complex logic (optional but helpful)
4. Ensure steps are in a logical implementation order
5. Make it detailed enough that another developer could implement it
6. Reference the user's answers throughout the plan

Begin generating the implementation plan now:`;
}
