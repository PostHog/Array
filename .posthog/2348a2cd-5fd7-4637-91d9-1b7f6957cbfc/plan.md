I'll analyze the codebase to understand the issue with repo selection when no GitHub integration is set up. Let me start by exploring the relevant files.
Let me search for task-related components and repository selection UI:
Let me examine the TaskDetail component since the issue is on a task page:
Now let me search for where the issue might be with the "undefined/undefined" display and the integration setup link:
Now I can see the issue. Looking at the TaskDetail component (lines 314-320), when there are no repositories (repositories.length === 0) but a selectedRepo exists, it displays the selectedRepo value. However, the issue described mentions that it shows "undefined/undefined" with a link to open the repo. 

Let me check if there's any place where the repo link button is being rendered when it shouldn't be:
Let me check the TaskCreate component to see if there's similar logic there:
Let me search for where the integration setup link might be displayed:
Now let me check the types to understand the repository config structure better:
Now let me check the WorkflowView to see if there's similar logic there:
Now let me search for any place that might have text related to setting up integrations or links to the integration settings:
Let me look at the authStore to understand the full context:
Based on my analysis, I now understand the issue. Looking at TaskDetail.tsx lines 314-335, when there are no repositories available (no GitHub integration setup), the component shows:
1. Lines 314-320: Shows "None" in gray when `repositories.length === 0` and no `selectedRepo`
2. Lines 321-333: Shows a GitHub external link button when `selectedRepo` exists and is not "__none__"

The problem is that when a task has a `repository_config` with `undefined` organization or repository values, the code at lines 62-65 tries to build a string like `${undefined}/${undefined}`, which results in "undefined/undefined". Then the external link button (lines 321-333) is rendered with this invalid value.

The issue occurs when:
- The task has a `repository_config` object but with undefined/null values for organization or repository
- No GitHub integration is set up (repositories.length === 0)
- The button to open the repo is still shown with the invalid "undefined/undefined" URL

Let me verify this by checking the posthogClient to see how repository configs are handled:
Perfect! Now I have a complete understanding of the issue. Let me create a comprehensive implementation plan.
Perfect! I've completed my analysis and created a detailed implementation plan. Here's what I found:

## Problem Summary

The issue occurs in the TaskDetail component when:
1. **No GitHub integration is configured** (repositories array is empty)
2. A task has a **malformed `repository_config`** object with `undefined` organization or repository values

This causes the UI to display "undefined/undefined" with a broken external link button instead of helping users set up the GitHub integration.

## Root Cause

The code has three issues:

1. **Unsafe state initialization** (lines 61-66): The `selectedRepo` state is built from `task.repository_config` without validating that organization/repository are defined strings
2. **Missing integration setup prompt**: When no GitHub integration exists, there's no helpful message guiding users to set it up
3. **Invalid external link rendering**: The GitHub link button renders for any non-empty repo value, including "undefined/undefined"

## Solution

The plan includes:

1. **Add validation** to repository state initialization to prevent "undefined/undefined"
2. **Show a setup prompt** when no GitHub integration exists, with a button linking to PostHog's integration settings page
3. **Only show the external link** when a valid integration and repository are selected
4. **Use the correct URL format**: `https://app.posthog.com/project/{team_id}/settings/environment-integrations`

The plan is ready for your review. Would you like me to proceed with implementation?