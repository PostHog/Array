//! ACP prompt → SDK user message conversion.
//!
//! Port of `adapters/claude/conversion/acp-to-sdk.ts` (`promptToClaude`).

use serde_json::{json, Value};

const CLAUDE_IMAGE_MIME_TYPES: [&str; 4] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/// Path-only workspace attach text (never embed file contents from disk).
/// Port of `workspacePromptFromFileUri` + `readToolGuidanceForPath`.
fn workspace_prompt_from_file_uri(uri: &str) -> String {
    let Some(file_path) = uri.strip_prefix("file://") else {
        return uri.to_string();
    };
    let name = std::path::Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string());
    let ext = std::path::Path::new(file_path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let guidance = if ext == "pdf" {
        "Optional `pages` string (e.g. \"1-5\") per Read call instead of loading the entire PDF."
    } else if matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "bmp"
            | "svg"
            | "mp4"
            | "mov"
            | "webm"
            | "mkv"
            | "avi"
            | "mpeg"
            | "mpg"
    ) {
        "Binary file — use Read with `file_path`; prefer bounded reads where supported."
    } else {
        "Large text — use multiple Read calls with optional `offset` and `limit`."
    };
    format!(
        "Attached workspace file — use Read with required `file_path`:\n- file_path: {file_path}\n- name (context): {name}\n{guidance}"
    )
}

fn sdk_text(text: &str) -> Value {
    json!({ "type": "text", "text": text })
}

/// `promptToClaude`: ACP prompt request → SDK user message. Also returns the
/// plain text preview used for the user_message_chunk broadcast.
pub fn prompt_to_claude(session_id: &str, params: &Value) -> Value {
    let mut content: Vec<Value> = Vec::new();
    let mut context: Vec<Value> = Vec::new();

    let meta = params.get("_meta");
    if let Some(pr_context) = meta
        .and_then(|m| m.get("prContext"))
        .and_then(Value::as_str)
    {
        content.push(sdk_text(pr_context));
    }
    if let Some(skill_context) = meta
        .and_then(|m| m.get("localSkillContext"))
        .and_then(Value::as_str)
    {
        content.push(sdk_text(skill_context));
    }

    let empty = Vec::new();
    let chunks = params
        .get("prompt")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    for chunk in chunks {
        match chunk.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = chunk.get("text").and_then(Value::as_str) {
                    content.push(sdk_text(text));
                }
            }
            Some("resource_link") => {
                if let Some(uri) = chunk.get("uri").and_then(Value::as_str) {
                    if uri.starts_with("file://") {
                        content.push(sdk_text(&workspace_prompt_from_file_uri(uri)));
                    } else {
                        content.push(sdk_text(uri));
                    }
                }
            }
            Some("resource") => {
                let resource = chunk.get("resource");
                let uri = resource
                    .and_then(|r| r.get("uri"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let text = resource.and_then(|r| r.get("text")).and_then(Value::as_str);
                if let Some(text) = text {
                    if uri.starts_with("file://") {
                        content.push(sdk_text(&workspace_prompt_from_file_uri(uri)));
                    } else {
                        content.push(sdk_text(uri));
                        context.push(sdk_text(&format!(
                            "\n<context ref=\"{uri}\">\n{text}\n</context>"
                        )));
                    }
                }
            }
            Some("image") => {
                let data = chunk.get("data").and_then(Value::as_str);
                let mime = chunk.get("mimeType").and_then(Value::as_str).unwrap_or("");
                let uri = chunk.get("uri").and_then(Value::as_str);
                if let Some(data) = data {
                    if CLAUDE_IMAGE_MIME_TYPES.contains(&mime) {
                        content.push(json!({
                            "type": "image",
                            "source": { "type": "base64", "data": data, "media_type": mime },
                        }));
                    } else {
                        content.push(sdk_text(&format!(
                            "[Unsupported image MIME type: {mime}. Supported: image/jpeg, image/png, image/gif, image/webp.]"
                        )));
                    }
                } else if let Some(uri) = uri {
                    if uri.starts_with("http") {
                        content.push(json!({
                            "type": "image",
                            "source": { "type": "url", "url": uri },
                        }));
                    } else if uri.starts_with("file://") {
                        content.push(sdk_text(&workspace_prompt_from_file_uri(uri)));
                    }
                }
            }
            _ => {}
        }
    }

    content.extend(context);

    let mut message = json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "session_id": session_id,
        "parent_tool_use_id": null,
    });

    // A steer folds into the running turn at the next tool-call boundary.
    let is_steer = meta
        .and_then(|m| m.get("steer"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if is_steer {
        message["priority"] = json!("next");
    }
    message
}

/// The user_message_chunk updates the driver broadcasts for a prompt (the TS
/// adapter's `broadcastUserMessage`): one chunk per visible prompt block,
/// skipping `_meta.ui.hidden` blocks (resume scaffolding).
pub fn user_message_updates(params: &Value) -> Vec<Value> {
    let empty = Vec::new();
    let chunks = params
        .get("prompt")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    chunks
        .iter()
        .filter(|chunk| chunk.pointer("/_meta/ui/hidden").and_then(Value::as_bool) != Some(true))
        .filter_map(|chunk| match chunk.get("type").and_then(Value::as_str) {
            Some("text") | Some("resource_link") | Some("image") => Some(json!({
                "sessionUpdate": "user_message_chunk",
                "content": chunk,
            })),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_text_and_resource_links() {
        let message = prompt_to_claude(
            "sess-1",
            &json!({
                "sessionId": "sess-1",
                "prompt": [
                    { "type": "text", "text": "Fix the bug" },
                    { "type": "resource_link", "uri": "file:///tmp/att/report.pdf", "name": "report.pdf" },
                ],
                "_meta": { "prContext": "PR context here" },
            }),
        );
        assert_eq!(message["type"], "user");
        assert_eq!(message["session_id"], "sess-1");
        let content = message["message"]["content"].as_array().unwrap();
        assert_eq!(content[0]["text"], "PR context here");
        assert_eq!(content[1]["text"], "Fix the bug");
        let attach = content[2]["text"].as_str().unwrap();
        assert!(attach.contains("file_path: /tmp/att/report.pdf"));
        assert!(attach.contains("pages"));
        assert!(message.get("priority").is_none());
    }

    #[test]
    fn steer_meta_sets_priority_next() {
        let message = prompt_to_claude(
            "sess-1",
            &json!({
                "prompt": [{ "type": "text", "text": "also do X" }],
                "_meta": { "steer": true },
            }),
        );
        assert_eq!(message["priority"], "next");
    }

    #[test]
    fn hidden_blocks_are_not_broadcast() {
        let updates = user_message_updates(&json!({
            "prompt": [
                { "type": "text", "text": "resume scaffold", "_meta": { "ui": { "hidden": true } } },
                { "type": "text", "text": "visible" },
            ],
        }));
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0]["content"]["text"], "visible");
    }
}
