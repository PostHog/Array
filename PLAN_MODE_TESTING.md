# Plan Mode Testing Guide

This document provides comprehensive testing instructions for the new Plan Mode feature in Array.

## Overview

Plan Mode is an interactive research-driven planning flow that allows users to:
1. Research the codebase and generate clarifying questions
2. Answer questions interactively with keyboard navigation
3. Generate a detailed implementation plan
4. Edit and refine the plan before execution

## Prerequisites

1. Build the application: `pnpm run build`
2. Run the application: `pnpm run dev`
3. Have PostHog API credentials configured
4. Have a task created with a repository configured

## Test Cases

### 1. Mode Toggle

**Test**: Toggle between Workflow and Plan modes

**Steps**:
1. Open a task
2. Look for the "Mode" segmented control below the Working Directory field
3. Click to toggle between "Workflow" and "Plan"
4. **Keyboard shortcut**: Press `Shift+Tab` to toggle

**Expected**:
- Mode switches between "Workflow" and "Plan"
- Button text changes from "Run Agent" to "Start Research" in Plan mode
- The local/cloud toggle only shows in Workflow mode
- Keyboard shortcut works from anywhere in the task detail view

---

### 2. Research Phase

**Test**: Start plan mode research

**Steps**:
1. Switch to Plan mode
2. Click "Start Research" button
3. Observe the terminal pane on the right

**Expected**:
- Button changes to "Running..."
- Terminal shows "Starting plan mode research phase..."
- Agent begins exploring the codebase (you'll see file reads, searches, etc.)
- After research completes, you should see a JSON block with questions in the terminal

**Example output**:
```json
{
  "questions": [
    {
      "id": "q1",
      "question": "How should we handle X?",
      "options": [
        "a) Approach A",
        "b) Approach B", 
        "c) Something else (please specify)"
      ]
    }
  ]
}
```

---

### 3. Interactive Questions Phase

**Test**: Answer clarifying questions

**Steps**:
1. After research completes, the terminal should switch to showing interactive questions
2. Use keyboard navigation:
   - `↑` or `k` - Move up
   - `↓` or `j` - Move down
   - `Enter` - Select current option
3. For "something else" options:
   - When selected, a text area appears
   - Type your custom answer
   - Press `Cmd/Ctrl+Enter` to submit
   - Press `Esc` to cancel
4. Answer all questions
5. Click "Generate Plan" when all questions are answered

**Expected**:
- Questions appear one at a time with visual highlighting
- Keyboard navigation works smoothly
- Current selection is highlighted with a blue background
- After answering, question shows checkmark and fades slightly
- Can click options with mouse as well
- Text input works for custom options
- "Generate Plan" button appears after all questions answered

**Edge Cases**:
- Cancel during questions (Cancel button should work)
- Switch away from Plan mode during questions (should preserve state)
- Try navigating beyond first/last question (should stop at boundaries)

---

### 4. Plan Generation Phase

**Test**: Generate implementation plan

**Steps**:
1. After clicking "Generate Plan", observe the terminal
2. Agent should start generating the plan based on your answers

**Expected**:
- Terminal shows "Generating implementation plan..."
- Agent processes the answers and generates markdown content
- Status shows "Plan written" when complete
- Plan file created at `.posthog/{task_id}/plan.md` in the repository

---

### 5. Plan Review Phase

**Test**: Review and edit the plan

**Steps**:
1. After plan generation completes, the terminal should switch to the plan editor
2. The editor should show the generated plan in markdown format
3. Edit the plan:
   - Add text
   - Format with bold, italic, lists
   - Add code blocks
   - Use @ mentions for files (if in repo)
4. Click "Save Plan"
5. Close the plan editor with the X button

**Expected**:
- Plan editor appears with TipTap rich text editor
- Plan content is formatted and readable
- Editing works smoothly
- Save button saves changes to `.posthog/{task_id}/plan.md`
- "Last saved" timestamp updates after saving
- Close button returns to terminal view
- Plan persists after closing

---

### 6. Switch to Workflow Mode

**Test**: Run workflow mode with the plan as context

**Steps**:
1. After creating and editing a plan, switch back to Workflow mode
2. Click "Run Agent"
3. The agent should have access to the plan file as context

**Expected**:
- Mode switches to Workflow
- Button changes to "Run Agent"
- Agent can read the plan.md file during execution
- Implementation follows the plan

---

### 7. Cancel Operations

**Test**: Cancel during different phases

**Steps**:
1. Start research, then click Cancel
2. Start plan generation, then click Cancel

**Expected**:
- Cancel button appears when running
- Agent stops execution
- Phase resets appropriately
- No errors in console

---

### 8. Error Handling

**Test**: Handle various error conditions

**Test Cases**:
- No repository selected - should show error
- No API key - should show error message
- Network issues during research/planning
- Invalid JSON in questions response
- Failed to write plan file

**Expected**:
- Clear error messages in terminal
- Graceful failure without crashes
- Ability to retry after fixing issues

---

### 9. State Persistence

**Test**: Plan mode state persists across sessions

**Steps**:
1. Start research phase
2. Close the application
3. Reopen and navigate to the same task
4. Check if state is restored

**Expected**:
- Execution mode preference is NOT persisted (always starts in workflow)
- Questions and answers ARE NOT persisted
- Plan content CAN be loaded from `.posthog/{task_id}/plan.md`

---

### 10. File System Integration

**Test**: Verify .posthog folder and plan.md creation

**Steps**:
1. Complete full plan mode flow
2. Check repository folder structure

**Expected**:
- `.posthog/{task_id}/` folder exists in repository
- `plan.md` file exists in that folder
- Plan content matches what was generated/edited
- File is valid markdown

**Verify with**:
```bash
ls -la /path/to/repo/.posthog/{task-id}/
cat /path/to/repo/.posthog/{task-id}/plan.md
```

---

## Integration Testing

### Complete End-to-End Flow

**Test**: Full plan mode to execution flow

**Steps**:
1. Create a new task with a clear description
2. Switch to Plan mode
3. Click "Start Research"
4. Wait for questions (2-5 minutes typically)
5. Answer all questions thoughtfully
6. Review generated plan
7. Edit plan if needed
8. Save plan
9. Switch to Workflow mode
10. Run the agent
11. Verify the agent uses the plan during execution

**Expected**:
- Smooth flow through all phases
- Questions are relevant to the task
- Plan is detailed and actionable
- Agent follows the plan during execution
- Implementation matches the plan

---

## Performance Testing

### Research Phase Performance

**Test**: Ensure research completes in reasonable time

**Expected**:
- Research phase: 2-10 minutes (depending on repository size)
- Question generation: Appears immediately after research
- Plan generation: 30 seconds - 3 minutes

**If slow**:
- Check network connection
- Check Claude API status
- Check repository size (very large repos may take longer)

---

## Known Limitations & Future Enhancements

### Current Limitations

1. Questions must be manually answered (no skip/default)
2. Cannot go back to edit previous answers
3. Plan editor doesn't support real-time collaboration
4. No plan versioning (overwrites existing plan)
5. Cannot re-run research without answering questions again

### Future Enhancements

- Plan history/versioning (plan-v1.md, plan-v2.md)
- Ability to edit and regenerate specific questions
- Template plans for common patterns
- Plan diff viewer before execution
- Collaborative plan editing

---

## Troubleshooting

### Questions Not Appearing

**Problem**: Research completes but no questions show

**Check**:
1. Look for JSON block in terminal logs (Pretty mode)
2. Check browser console for parsing errors
3. Verify the agent actually generated questions (switch to Raw mode)

**Fix**:
- If JSON is malformed, the agent might need to be prompted better
- Check the research prompt in `src/main/prompts/research-questions.ts`

### Plan Not Loading

**Problem**: Plan editor shows empty after generation

**Check**:
1. Verify `.posthog/{task_id}/plan.md` exists
2. Check file permissions
3. Look for errors in browser console

**Fix**:
- Check `readPlanFile` IPC handler
- Verify file system access permissions

### Keyboard Shortcuts Not Working

**Problem**: Shift+Tab or navigation keys don't work

**Check**:
1. Focus is on the correct element
2. No other component is capturing the keyboard event
3. Check browser console for errors

**Fix**:
- Click into the task detail area
- Ensure no modal or input field is focused

---

## Success Criteria

The feature is working correctly if:

✅ Mode toggle switches between Plan and Workflow modes
✅ Research phase completes and generates 3-5 relevant questions
✅ Keyboard navigation works in question interface
✅ All questions can be answered (including custom input)
✅ Plan generates based on answers
✅ Plan.md file is created in .posthog folder
✅ Plan editor loads and allows editing
✅ Plan saves successfully
✅ Can switch to workflow mode and run with plan context
✅ No console errors during normal operation
✅ Graceful error handling for edge cases

---

## Reporting Issues

When reporting issues, please include:

1. Steps to reproduce
2. Expected vs actual behavior
3. Screenshots/screen recordings
4. Browser console logs
5. Task description and repository info (if not sensitive)
6. Contents of `.posthog/{task_id}/plan.md` (if relevant)

---

## Next Steps After Testing

Once testing is complete:

1. Mark the testing todo as completed
2. Document any issues found
3. Create follow-up tasks for improvements
4. Update user documentation
5. Consider creating a video demo

