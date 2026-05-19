#!/usr/bin/env bash
# SessionStart hook: inject PR workflow guidance.
#  - Always: instruct the agent to leave a reply and resolve each PR review
#    conversation it deals with.
#  - Always: instruct the agent to search for matching open issues before
#    opening a PR and link them via `Closes #N` / `Refs #N`.
#  - When detectable: inject the repo's PR template (or the org's `.github`
#    repo template as a fallback) so PRs are opened with the right structure.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

template=""
src=""

for path in \
  .github/pull_request_template.md \
  .github/PULL_REQUEST_TEMPLATE.md \
  .github/pull_request_template.txt \
  docs/pull_request_template.md \
  docs/PULL_REQUEST_TEMPLATE.md \
  pull_request_template.md \
  PULL_REQUEST_TEMPLATE.md
do
  if [[ -f "$path" ]]; then
    template=$(cat "$path")
    src="repo: $path"
    break
  fi
done

if [[ -z "$template" ]] && command -v gh >/dev/null 2>&1; then
  remote=$(git config --get remote.origin.url 2>/dev/null || echo "")
  owner=$(printf '%s' "$remote" | sed -nE 's|.*github\.com[:/]([^/]+)/.*|\1|p')

  if [[ -n "$owner" ]]; then
    for path in \
      .github/pull_request_template.md \
      .github/PULL_REQUEST_TEMPLATE.md \
      profile/pull_request_template.md \
      pull_request_template.md \
      PULL_REQUEST_TEMPLATE.md
    do
      content=$(gh api "/repos/${owner}/.github/contents/${path}" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || true)
      if [[ -n "$content" ]]; then
        template="$content"
        src="org fallback: ${owner}/.github/${path}"
        break
      fi
    done
  fi
fi

review_block="### PR review / comment handling
When addressing PR review comments or review threads, treat each thread as done only after BOTH of these:
  1. Reply to the thread with a short note describing what changed (and the commit SHA when useful) so the reviewer can see the resolution inline.
  2. Resolve the conversation thread.
Use the GitHub GraphQL API via \`gh\` to resolve threads, e.g.:
  gh api graphql -f query='mutation(\$id:ID!){resolveReviewThread(input:{threadId:\$id}){thread{isResolved}}}' -f id=\"<thread-node-id>\"
Reply to a thread via \`gh api -X POST /repos/{owner}/{repo}/pulls/{n}/comments/{id}/replies -f body='...'\`. Never silently push fixes without confirming each related thread is replied to and resolved."

issue_block="### Related-issue linking
Before opening a pull request, search the repo for existing open issues that match the work in the branch. Use \`gh issue list --state open --search '<keywords>'\` (and \`gh issue view <n>\` to confirm relevance) to find candidates derived from the branch name, commit messages, and changed files. For every issue the PR would resolve, include a \`Closes #<n>\` line in the PR body so GitHub auto-links and auto-closes it on merge. If the issue is related but the PR does not fully resolve it, use \`Refs #<n>\` instead. Skip this only when there are clearly no matching issues."

if [[ -n "$template" ]]; then
  template_block="

### PR template
A PR template was detected (${src}). When opening a pull request with \`gh pr create\`, pass the template below as the \`--body\` argument — preserve the section headings exactly and fill each section based on the branch's actual changes. Do NOT fall back to the generic Summary/Test plan format. Keep any required PR footer (e.g. the PostHog Code attribution) appended after the template.

--- BEGIN PR TEMPLATE ---
${template}
--- END PR TEMPLATE ---"
else
  template_block=""
fi

ctx="${review_block}

${issue_block}${template_block}"

jq -nc --arg c "$ctx" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
