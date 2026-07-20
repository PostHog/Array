//! Cloud system prompt construction.
//!
//! Faithful port of `buildCloudSystemPrompt` / `buildDetectedPrContext` /
//! `buildSessionSystemPrompt` from `agent-server.ts`. The prompt text is a
//! behavioral contract with the agent — keep byte-identical with the TS
//! implementation when editing either side.

use crate::config::ServerConfig;

pub const SIGNED_COMMIT_TOOL: &str = "mcp__posthog-code-tools__git_signed_commit";
pub const SIGNED_MERGE_TOOL: &str = "mcp__posthog-code-tools__git_signed_merge";
pub const SIGNED_REWRITE_TOOL: &str = "mcp__posthog-code-tools__git_signed_rewrite";

pub struct PromptContext<'a> {
    pub config: &'a ServerConfig,
    pub pr_url: Option<&'a str>,
    pub slack_thread_url: Option<&'a str>,
    pub inbox_report_url: Option<&'a str>,
}

/// Automated, PostHog-branded origins: the Slack app and the Self-driving
/// inbox. Both auto-publish by default and attribute PRs to "PostHog".
pub fn is_automated_origin(config: &ServerConfig) -> bool {
    matches!(
        config.interaction_origin.as_deref(),
        Some("slack") | Some("signal_report")
    )
}

pub fn should_auto_publish_cloud_changes(config: &ServerConfig) -> bool {
    (is_automated_origin(config) || config.auto_publish == Some(true))
        && config.create_pr != Some(false)
}

fn identity_instructions(config: &ServerConfig) -> String {
    if config.interaction_origin.as_deref() != Some("slack") {
        return String::new();
    }
    r#"
# Identity
You are the PostHog Slack app, PostHog's agent for helping users with their product data and coding tasks from Slack. When introducing yourself or referring to yourself in messages to the user, identify as "PostHog Slack app". Do NOT refer to yourself as Claude, an Anthropic assistant, or any underlying model name.

# Response Style
You are replying in a Slack thread. Slack readers want short, skimmable answers — be concise by default.
- Answer simple questions in a single sentence. Keep everything else brief — a few sentences at most.
- Lead with the answer or the outcome. Skip preamble, restating the question, and sign-offs.
- Prefer plain prose. Treat bullet lists as the exception, not the norm, and avoid headers and tables unless they genuinely make a complex answer clearer.
- Do not narrate your thinking or list every step you took; report what matters and the result.
- This is a default, not a hard rule. If the user (or their saved memory) asks for more depth or a specific format, follow that instead.

# Mentioning users
To ping a Slack user, reuse a `<@U…|displayname>` token that already appears in the message context — copy it verbatim, including the `U…` ID. Do NOT construct a mention token from a name, and do NOT substitute the display name (or any other string) for the `U…` ID — `<@Jane|Jane Doe>` is not a valid mention; only the form with the real ID like `<@U01ABCDEF23|Jane Doe>` is. If the person you want to refer to has no `<@U…|displayname>` token anywhere in the thread context, write their name as plain text instead of inventing one.

# Suggesting code changes
You can also open pull requests directly from this Slack thread. When the user's question describes a problem with a plausible code-side fix — a bug visible in errors or logs, missing or broken instrumentation, a broken funnel step traceable to UI code, a stale config that lives in a repo — end your reply with a one-sentence offer to open a PR for the fix and ask if they want you to proceed. Skip the offer for pure data lookups with no actionable code change (e.g. "what was DAU yesterday?"), and skip it when the fix would clearly live outside any repo you can reach.
"#
    .to_string()
}

fn signed_commit_instructions(task_id: &str) -> String {
    format!(
        r#"
## Committing (signed commits required)
Commits MUST be signed. `git commit` and `git push` are blocked in this environment.
To commit: stage your changes with `git add`, then call the `git_signed_commit` tool (full
name `{SIGNED_COMMIT_TOOL}`) with a `message` (and optional `body`/`paths`).
It creates a GitHub-signed ("Verified") commit on the branch and keeps your local checkout in
sync. To start a new branch, pass `branch` (prefixed with `posthog-code/`) — the tool creates
it on the remote for you.

## Updating from the base branch
To bring the base branch into your PR branch, call the `git_signed_merge` tool (full name
`{SIGNED_MERGE_TOOL}`) — it creates a Verified two-parent merge commit
server-side (like GitHub's "Update branch" button). NEVER run `git merge` followed by
`git_signed_commit`: a merge in progress is refused, because the commit API would linearize
the merge and dump every base-branch change into your PR. If `git_signed_merge` reports a
conflict, fix it with a rebase instead: `git rebase origin/<base>`, resolve, `git rebase
--continue`, then call `git_signed_rewrite`.

## Rewriting / force-pushing (rebases, conflict fixes)
`git push --force` is also blocked. To update a branch after a local rebase or conflict
resolution, rebase locally with normal `git` (resolve conflicts and finish with
`git rebase --continue`, NOT `git commit`), then call the `git_signed_rewrite` tool (full
name `{SIGNED_REWRITE_TOOL}`). It republishes the branch's commits as Verified
and atomically force-updates the remote branch. This is how you fix conflicts on an existing PR.
Histories containing merge commits are refused — rebase (which flattens merges) first.
If a signed-git tool refuses with a "merge in progress" or "leak" error, follow its recovery
instructions instead of retrying the same call.

## Re-committing to a branch with an open PR
Before committing again to a branch that already has an open PR, fetch it first. The remote
branch can advance between your commits — CI automation often auto-commits regenerated
artifacts (codegen, lockfiles, formatting) onto open PR branches, and collaborators can push
too. Committing from a stale local checkout silently reverts those commits, so
`git_signed_commit` refuses when the remote branch is ahead of your checkout. If it does, or
before your next commit, update your checkout — stash any uncommitted work across the update so
you don't lose it: `git stash --include-untracked`, `git fetch origin <branch>`,
`git reset --hard origin/<branch>`, `git stash pop` (resolve any conflicts), then re-stage
and commit. A soft/mixed reset would keep your stale files and re-commit the revert, so the
hard reset is the safe one here — your work is held in the stash.

## Attribution
Do NOT add "Co-Authored-By" trailers or "Generated with [Claude Code]" lines to your
commit messages. The `git_signed_commit` tool automatically appends the only trailers
we want:
  Generated-By: PostHog Code
  Task-Id: {task_id}"#
    )
}

const PR_LINK_INSTRUCTIONS: &str = r#"
## Referencing pull requests
When you mention a pull request in any reply or summary, always hyperlink it to its full URL
(e.g. a Markdown link like [#123](https://github.com/org/repo/pull/123)) rather than plain
text, so readers can open it directly."#;

const SHELL_EFFICIENCY_INSTRUCTIONS: &str = r#"
## Shell efficiency
Optimize for the fewest shell round trips.
- Batch related commands into one Bash invocation using `&&` (e.g. `npm run typecheck && npm run lint && npm test`).
- Emit all independent tool calls in the same response.
- Read multiple files at once.
- Never rerun a command solely to reproduce output you already have."#;

const WHY_CONTEXT_INSTRUCTION: &str = "   - Add a brief **Why** to the body — one or two sentences capturing the reason the user asked for this change (the motivation, not a restatement of the diff). Keep it short.";

const PUBLIC_REPO_SAFETY_INSTRUCTION: &str = "   - **Public-repo safety.** Treat the target repository as public-readable unless you have verified otherwise. The PR title, description, and commit messages must not contain private operational scale (exact event counts, internal row volumes, customer-usage percentages), customer names / emails / companies, references to internal tickets or incidents, the contents of Slack threads (do not quote or paraphrase what was said), or unreleased roadmap details. Linking to the originating Slack thread is fine and encouraged — Slack links are auth-gated and useful as context — as are channel references like \"raised in #team-foo\". Describe findings qualitatively (\"present on nearly all X events, absent from Y\") rather than with quantitative figures pulled from analytics queries — the reasoning that uses those numbers can stay in the thread; the PR copy cannot.";

fn pr_footer(ctx: &PromptContext) -> String {
    let created_with = if is_automated_origin(ctx.config) {
        "Created with [PostHog](https://posthog.com?ref=pr)"
    } else {
        "Created with [PostHog Code](https://posthog.com/code?ref=pr)"
    };
    match (ctx.slack_thread_url, ctx.inbox_report_url) {
        (Some(url), _) => format!("*{created_with} from a [Slack thread]({url})*"),
        (None, Some(url)) => format!("*{created_with} from an [inbox report]({url})*"),
        (None, None) => format!("*{created_with}*"),
    }
}

/// `buildDetectedPrContext` — host context injected on follow-up prompts when
/// a PR is already attributed to the run.
pub fn detected_pr_context(config: &ServerConfig, pr_url: &str) -> String {
    if !should_auto_publish_cloud_changes(config) {
        return format!(
            "An open pull request already exists: {pr_url}\n\
             Use that PR as context if it is helpful, but stop with local changes ready for review.\n\
             Do NOT create commits, push to the PR branch, update the pull request, create a new branch, or create a new pull request unless the user explicitly asks."
        );
    }
    format!(
        "IMPORTANT — OVERRIDE PREVIOUS INSTRUCTIONS ABOUT CREATING BRANCHES/PRs.\n\
         You already have an open pull request: {pr_url}\n\
         You MUST:\n\
         1. Check out the existing PR branch with `gh pr checkout {pr_url}`\n\
         2. Make changes, commit, and push to that branch\n\
         You MUST NOT create a new branch, close the existing PR, or create a new PR."
    )
}

/// `buildCloudSystemPrompt` — the cloud instruction block appended to the
/// agent's system prompt.
pub fn build_cloud_system_prompt(ctx: &PromptContext) -> String {
    let config = ctx.config;
    let task_id = &config.task_id;
    let should_auto_create_pr = should_auto_publish_cloud_changes(config);
    let identity = identity_instructions(config);
    let signed = signed_commit_instructions(task_id);
    let footer = pr_footer(ctx);

    if let Some(pr_url) = ctx.pr_url {
        if !should_auto_create_pr {
            return format!(
                "{identity}\n# Cloud Task Execution\n\nThis task already has an open pull request: {pr_url}\n\nDo the requested work, but stop with local changes ready for review.\n\nImportant:\n- Do NOT create new commits, push to the branch, or update the pull request unless the user explicitly asks.\n- Do NOT create a new branch or a new pull request.\n{signed}{PR_LINK_INSTRUCTIONS}{SHELL_EFFICIENCY_INSTRUCTIONS}\n"
            );
        }
        return format!(
            "{identity}\n# Cloud Task Execution\n\nThis task already has an open pull request: {pr_url}\n\nAfter completing the requested changes:\n1. Check out the existing PR branch with `gh pr checkout {pr_url}`\n2. Stage your changes with `git add`, then call the `git_signed_commit` tool with a clear `message` (do NOT use `git commit`/`git push` — they are blocked). This commits to the existing PR branch.\n   - If the branch is behind its base, call the `git_signed_merge` tool first — it merges the base in server-side with a Verified merge commit. Only if it reports a conflict: fetch and rebase locally (`git fetch origin <base>`, `git rebase origin/<base>`, resolve, `git rebase --continue`), then call the `git_signed_rewrite` tool to force-update this same PR branch.\n3. For every PR review comment or review thread you addressed, treat the thread as done only after BOTH of these:\n   - Reply on the thread with a short note describing what changed (reference the commit SHA when useful) using `gh api -X POST /repos/{{owner}}/{{repo}}/pulls/{{n}}/comments/{{id}}/replies -f body='...'`.\n   - Resolve the thread via the `resolveReviewThread` GraphQL mutation: `gh api graphql -f query='mutation($id:ID!){{resolveReviewThread(input:{{threadId:$id}}){{thread{{isResolved}}}}}}' -f id=\"<thread-node-id>\"`.\n   List unresolved threads first with `gh api graphql -f query='{{repository(owner:\"<owner>\",name:\"<repo>\"){{pullRequest(number:<n>){{reviewThreads(first:100){{nodes{{id isResolved comments(first:1){{nodes{{body}}}}}}}}}}}}}}'` so you can resolve each one you fixed.\n\nImportant:\n- Do NOT create a new branch or a new pull request.\n- Do NOT push fixes for review comments without replying to and resolving each related thread.\n{signed}{PR_LINK_INSTRUCTIONS}{SHELL_EFFICIENCY_INSTRUCTIONS}\n"
        );
    }

    if config.repository_path.is_none() {
        let publish_instructions = if config.create_pr == Some(false) {
            "\nWhen the user asks for code changes:\n- You may clone a repository and make local edits in that clone\n- Do NOT create branches, commits, push changes, or open pull requests in this run".to_string()
        } else if should_auto_create_pr {
            format!(
                "\nWhen the user asks to clone or work in a GitHub repository:\n- Clone the repository into /tmp/workspace/repos/<owner>/<repo> using `gh repo clone <owner>/<repo> /tmp/workspace/repos/<owner>/<repo>`\n- Work from inside that cloned repository for follow-up code changes\n- After completing code changes in a cloned repository, create a branch, stage your changes with `git add` and commit them with the `git_signed_commit` tool (do NOT use `git commit`/`git push` — they are blocked), and open a draft pull request from inside the clone without waiting to be asked. Before opening the PR, check the cloned repo for a PR template at `.github/pull_request_template.md` (or variants; fall back to the org's `.github` repo via `gh api`) and use it as the body structure, and search for matching open issues with `gh issue list --search` to include `Closes #<n>` / `Refs #<n>` links.\n- Keep the PR description brief overall. Summarize only the most important changes — do NOT enumerate every change you made. A few sentences or bullets is plenty.\n{}\n{}\n- End the PR description with a horizontal rule followed by this footer line: {footer}\n- Always create the PR as a draft. Do not ask for confirmation before publishing completed code changes",
                WHY_CONTEXT_INSTRUCTION.trim_start(),
                PUBLIC_REPO_SAFETY_INSTRUCTION.trim_start(),
            )
        } else {
            format!(
                "\nWhen the user explicitly asks to clone or work in a GitHub repository:\n- Clone the repository into /tmp/workspace/repos/<owner>/<repo> using `gh repo clone <owner>/<repo> /tmp/workspace/repos/<owner>/<repo>`\n- Work from inside that cloned repository for follow-up code changes\n- If the user explicitly asks you to open or update a pull request, create a branch, stage your changes with `git add` and commit them with the `git_signed_commit` tool (do NOT use `git commit`/`git push` — they are blocked), and open a draft pull request from inside the clone. Before opening the PR, check the cloned repo for a PR template at `.github/pull_request_template.md` (or variants; fall back to the org's `.github` repo via `gh api`) and use it as the body structure, and search for matching open issues with `gh issue list --search` to include `Closes #<n>` / `Refs #<n>` links.\n- Keep the PR description brief overall. Summarize only the most important changes — do NOT enumerate every change you made. A few sentences or bullets is plenty.\n{}\n{}\n- End the PR description with a horizontal rule followed by this footer line: {footer}\n- Do NOT create branches, commits, push changes, or open pull requests unless the user explicitly asks for that",
                WHY_CONTEXT_INSTRUCTION.trim_start(),
                PUBLIC_REPO_SAFETY_INSTRUCTION.trim_start(),
            )
        };

        return format!(
            "{identity}\n# Cloud Task Execution — No Repository Mode\n\nYou are a helpful assistant with access to PostHog via MCP tools. You can help with both code tasks and data/analytics questions.\n\nWhen the user asks about analytics, data, metrics, events, funnels, dashboards, feature flags, experiments, or anything PostHog-related:\n- Use your PostHog MCP tools to query data, search insights, and provide real answers\n- Do NOT tell the user to check an external analytics platform — you ARE the analytics platform\n- Use tools like insight-query, query-run, event-definitions-list, and others to answer questions directly\n\nWhen the user asks for code changes or software engineering tasks:\n- Let them know you can help but don't have a repository connected for this session\n- If they have not specified a repository to clone, offer to write code snippets, scripts, or provide guidance\n{publish_instructions}\n\nImportant:\n- Prefer using MCP tools to answer questions with real data over giving generic advice.\n{signed}{PR_LINK_INSTRUCTIONS}{SHELL_EFFICIENCY_INSTRUCTIONS}\n"
        );
    }

    if !should_auto_create_pr {
        return format!(
            "{identity}\n# Cloud Task Execution\n\nDo the requested work, but stop with local changes ready for review.\n\nImportant:\n- Do NOT create a branch, commit, push, or open a pull request unless the user explicitly asks.\n{signed}{PR_LINK_INSTRUCTIONS}{SHELL_EFFICIENCY_INSTRUCTIONS}\n"
        );
    }

    let base_flag = config
        .base_branch
        .as_deref()
        .map(|base| format!(" --base {base}"))
        .unwrap_or_default();
    format!(
        "{identity}\n# Cloud Task Execution\n\nIf the work you are being asked to do already has an open pull request — for example, the inbox report you fetched links an implementation PR (its `implementation_pr_url`), or this same thread already produced a PR that you are now being asked to revise — do NOT open a second PR. Check that PR out with `gh pr checkout <url>`, continue on its branch, and commit your changes to it with the `git_signed_commit` tool (if the branch is behind its base, call `git_signed_merge` first). A PR is only the one to continue if it is for this same request; if the thread merely mentions an unrelated or older PR, ignore it. Only open a new, separate PR when the change is genuinely distinct from the existing one.\n\nOtherwise, after completing the requested changes:\n1. Pick a new branch name prefixed with `posthog-code/` (e.g. `posthog-code/fix-login-redirect`)\n2. Stage your changes with `git add`, then call the `git_signed_commit` tool with `branch` set to that name and a clear `message` (do NOT use `git commit`/`git push` — they are blocked). The tool creates the branch on the remote and a signed commit on it.\n3. Before opening the PR, prepare the body:\n   - Keep the PR description brief overall. Summarize only the most important changes — do NOT enumerate every change you made. A few sentences or bullets is plenty.\n{WHY_CONTEXT_INSTRUCTION}\n{PUBLIC_REPO_SAFETY_INSTRUCTION}\n   - Check the repo for a PR template at `.github/pull_request_template.md` (also try `.github/PULL_REQUEST_TEMPLATE.md`, `docs/pull_request_template.md`, and root variants). If one exists, use its exact section headings as the PR body — do NOT fall back to a generic Summary/Test plan format.\n   - If no repo-level template exists, check the org's `.github` repo via `gh api /repos/<owner>/.github/contents/.github/pull_request_template.md` (and other common paths) and use that as a fallback.\n   - Search for matching open issues with `gh issue list --state open --search '<keywords>'` (derive keywords from the branch name, commits, and changed files; `gh issue view <n>` to confirm relevance). For every issue this PR would resolve, include a `Closes #<n>` line in the body so GitHub auto-links and auto-closes it on merge. For issues that are related but not fully resolved, use `Refs #<n>` instead.\n4. Create a draft pull request using `gh pr create --draft{base_flag}` with a descriptive title and the body prepared above. Add the following footer at the end of the PR description:\n```\n---\n{footer}\n```\n\nImportant:\n- Always create the PR as a draft. Do not ask for confirmation.\n{signed}{PR_LINK_INSTRUCTIONS}{SHELL_EFFICIENCY_INSTRUCTIONS}\n"
    )
}

/// `buildSessionSystemPrompt` — the `systemPrompt` value placed in the
/// session `_meta`: a plain string when the operator supplied a string
/// override, otherwise `{append}` on the claude_code preset.
pub fn build_session_system_prompt(ctx: &PromptContext) -> serde_json::Value {
    let cloud_append = build_cloud_system_prompt(ctx);
    let user_prompt = ctx
        .config
        .claude_code
        .as_ref()
        .and_then(|c| c.system_prompt.clone());

    match user_prompt {
        Some(serde_json::Value::String(user)) => {
            serde_json::Value::String(format!("{user}\n\n{cloud_append}"))
        }
        Some(serde_json::Value::Object(preset)) => {
            let user_append = preset
                .get("append")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let combined = [user_append, &cloud_append]
                .iter()
                .filter(|s| !s.is_empty())
                .cloned()
                .collect::<Vec<_>>()
                .join("\n\n");
            serde_json::json!({ "append": combined })
        }
        _ => serde_json::json!({ "append": cloud_append }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AgentMode, RuntimeAdapter, ServerConfig};

    fn test_config() -> ServerConfig {
        ServerConfig {
            port: 3001,
            repository_path: Some("/tmp/workspace/repo".to_string()),
            repo_ready_file: None,
            api_url: "https://us.posthog.com".to_string(),
            api_key: "k".to_string(),
            project_id: 2,
            jwt_public_key: "pk".to_string(),
            event_ingest_token: None,
            event_ingest_base_url: None,
            event_ingest_stream_window_ms: None,
            event_ingest_keep_stream_open: None,
            mode: AgentMode::Background,
            task_id: "task_123".to_string(),
            run_id: "run_456".to_string(),
            create_pr: None,
            auto_publish: None,
            mcp_servers: Vec::new(),
            base_branch: None,
            claude_code: None,
            allowed_domains: None,
            runtime_adapter: RuntimeAdapter::Claude,
            model: None,
            reasoning_effort: None,
            adapter_cmd: "true".to_string(),
            resume_run_id: None,
            interaction_origin: None,
            llm_gateway_url_override: None,
            hostname: None,
        }
    }

    #[test]
    fn review_first_by_default_for_manual_runs() {
        let config = test_config();
        let ctx = PromptContext {
            config: &config,
            pr_url: None,
            slack_thread_url: None,
            inbox_report_url: None,
        };
        let prompt = build_cloud_system_prompt(&ctx);
        assert!(prompt.contains("stop with local changes ready for review"));
        assert!(prompt.contains("Task-Id: task_123"));
        assert!(!prompt.contains("gh pr create --draft"));
    }

    #[test]
    fn slack_origin_auto_publishes_with_identity() {
        let mut config = test_config();
        config.interaction_origin = Some("slack".to_string());
        let ctx = PromptContext {
            config: &config,
            pr_url: None,
            slack_thread_url: Some("https://slack/x"),
            inbox_report_url: None,
        };
        let prompt = build_cloud_system_prompt(&ctx);
        assert!(prompt.contains("You are the PostHog Slack app"));
        assert!(prompt.contains("gh pr create --draft"));
        assert!(prompt.contains("*Created with [PostHog](https://posthog.com?ref=pr) from a [Slack thread](https://slack/x)*"));
    }

    #[test]
    fn base_branch_flows_into_pr_create_flag() {
        let mut config = test_config();
        config.auto_publish = Some(true);
        config.base_branch = Some("release-1.0".to_string());
        let ctx = PromptContext {
            config: &config,
            pr_url: None,
            slack_thread_url: None,
            inbox_report_url: None,
        };
        let prompt = build_cloud_system_prompt(&ctx);
        assert!(prompt.contains("gh pr create --draft --base release-1.0"));
    }

    #[test]
    fn existing_pr_review_first_blocks_updates() {
        let config = test_config();
        let ctx = PromptContext {
            config: &config,
            pr_url: Some("https://github.com/posthog/x/pull/1"),
            slack_thread_url: None,
            inbox_report_url: None,
        };
        let prompt = build_cloud_system_prompt(&ctx);
        assert!(prompt.contains(
            "This task already has an open pull request: https://github.com/posthog/x/pull/1"
        ));
        assert!(prompt.contains("Do NOT create new commits"));
    }

    #[test]
    fn no_repository_mode_mentions_mcp_tools() {
        let mut config = test_config();
        config.repository_path = None;
        let ctx = PromptContext {
            config: &config,
            pr_url: None,
            slack_thread_url: None,
            inbox_report_url: None,
        };
        let prompt = build_cloud_system_prompt(&ctx);
        assert!(prompt.contains("No Repository Mode"));
        assert!(prompt.contains("you ARE the analytics platform"));
    }

    #[test]
    fn session_prompt_wraps_in_append_by_default() {
        let config = test_config();
        let ctx = PromptContext {
            config: &config,
            pr_url: None,
            slack_thread_url: None,
            inbox_report_url: None,
        };
        let value = build_session_system_prompt(&ctx);
        assert!(value.get("append").is_some());
    }

    #[test]
    fn detected_pr_context_variants() {
        let mut config = test_config();
        let review_first = detected_pr_context(&config, "https://github.com/x/y/pull/2");
        assert!(review_first.contains("stop with local changes ready for review"));

        config.auto_publish = Some(true);
        let publish = detected_pr_context(&config, "https://github.com/x/y/pull/2");
        assert!(publish.contains("gh pr checkout https://github.com/x/y/pull/2"));
    }
}
