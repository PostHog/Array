//! Claude Code session JSONL location and healing.
//!
//! Port of the path/sanitize half of
//! `adapters/claude/session/jsonl-hydration.ts`. The Claude CLI persists each
//! session as `<config dir>/projects/<encoded cwd>/<sessionId>.jsonl`; the
//! agent-server hydrates that file for native resume and the Claude driver
//! reads it back to rehydrate task state, so the encoding lives here where
//! both can share it.

use std::path::{Path, PathBuf};

use serde_json::Value;

const MAX_PROJECT_KEY_LENGTH: usize = 200;

/// The JS string hash from `jsonl-hydration.ts` (`(hash << 5) - hash + code`
/// over UTF-16 units, |0 each step), rendered as base36 of the magnitude.
fn hash_string(s: &str) -> String {
    let mut hash: i32 = 0;
    for code in s.encode_utf16() {
        hash = hash
            .wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(code as i32);
    }
    to_base36((hash as i64).unsigned_abs())
}

fn to_base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("base36 digits are ascii")
}

/// Mirror of the Claude CLI's project-directory encoding: every
/// non-alphanumeric character becomes `-`, over-long keys are truncated with
/// a hash suffix.
pub fn encode_cwd_to_project_key(cwd: &str) -> String {
    let mut key: String = cwd
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    if key.len() > MAX_PROJECT_KEY_LENGTH {
        key = format!("{}-{}", &key[..MAX_PROJECT_KEY_LENGTH], hash_string(cwd));
    }
    key
}

/// `<CLAUDE_CONFIG_DIR|~/.claude>/projects/<encoded cwd>/<sessionId>.jsonl`.
pub fn get_session_jsonl_path(session_id: &str, cwd: &str) -> PathBuf {
    let config_dir = std::env::var("CLAUDE_CONFIG_DIR")
        .ok()
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
            Path::new(&home).join(".claude")
        });
    config_dir
        .join("projects")
        .join(encode_cwd_to_project_key(cwd))
        .join(format!("{session_id}.jsonl"))
}

/// `isEmptyContentBlock`: a text/thinking block with no payload.
pub fn is_empty_content_block(block: &Value) -> bool {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => block
            .get("text")
            .and_then(Value::as_str)
            .map(str::is_empty)
            .unwrap_or(true),
        Some("thinking") => block
            .get("thinking")
            .and_then(Value::as_str)
            .map(str::is_empty)
            .unwrap_or(true),
        _ => false,
    }
}

/// The `type: user|assistant` messages of a session JSONL, in file order.
/// Unparseable lines are skipped (the CLI appends non-message records too).
pub fn read_session_messages(jsonl_path: &Path) -> Vec<Value> {
    let Ok(raw) = std::fs::read_to_string(jsonl_path) else {
        return Vec::new();
    };
    raw.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .filter(|parsed| {
            matches!(
                parsed.get("type").and_then(Value::as_str),
                Some("user") | Some("assistant")
            )
        })
        .collect()
}

/// `sanitizeSessionJsonl`: heals JSONL files written before the empty-block
/// filters existed — without this an already-poisoned transcript keeps 400ing
/// on every resume. Returns whether the file changed. Aborts (returning
/// false) when a concurrent writer touched the file between read and rename.
pub fn sanitize_session_jsonl(jsonl_path: &Path) -> std::io::Result<bool> {
    let stat_before = std::fs::metadata(jsonl_path)?;
    let raw = std::fs::read_to_string(jsonl_path)?;

    let mut changed = false;
    let sanitized: Vec<String> = raw
        .split('\n')
        .map(|line| {
            if line.trim().is_empty() {
                return line.to_string();
            }
            let Ok(mut parsed) = serde_json::from_str::<Value>(line) else {
                return line.to_string();
            };
            let Some(content) = parsed
                .pointer_mut("/message/content")
                .and_then(Value::as_array_mut)
            else {
                return line.to_string();
            };
            let kept: Vec<Value> = content
                .iter()
                .filter(|block| !is_empty_content_block(block))
                .cloned()
                .collect();
            if kept.len() == content.len() {
                return line.to_string();
            }
            changed = true;
            *content = if kept.is_empty() {
                vec![serde_json::json!({ "type": "text", "text": " " })]
            } else {
                kept
            };
            parsed.to_string()
        })
        .collect();

    if !changed {
        return Ok(false);
    }

    let tmp_path = jsonl_path.with_extension(format!("tmp.{}", std::process::id()));
    let result = (|| {
        std::fs::write(&tmp_path, sanitized.join("\n"))?;
        // A concurrent writer may still own the file; abort rather than
        // clobber lines appended since the read. The next resume retries.
        let stat_now = std::fs::metadata(jsonl_path)?;
        if stat_now.len() != stat_before.len()
            || stat_now.modified().ok() != stat_before.modified().ok()
        {
            return Ok(false);
        }
        std::fs::rename(&tmp_path, jsonl_path)?;
        Ok(true)
    })();
    if !matches!(result, Ok(true)) {
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn encodes_cwd_like_the_cli() {
        assert_eq!(
            encode_cwd_to_project_key("/tmp/workspace/repos/posthog/posthog"),
            "-tmp-workspace-repos-posthog-posthog"
        );
        let long = format!("/{}", "a".repeat(300));
        let key = encode_cwd_to_project_key(&long);
        assert_eq!(
            key.len(),
            MAX_PROJECT_KEY_LENGTH + 1 + hash_string(&long).len()
        );
        assert!(key.starts_with("-aaaa"));
    }

    #[test]
    fn js_hash_matches_reference_values() {
        // Reference values computed with the JS implementation.
        assert_eq!(hash_string("abc"), "22ci");
        assert_eq!(hash_string(""), "0");
        assert_eq!(
            hash_string("/tmp/workspace/repos/posthog/posthog"),
            "4hsoim"
        );
    }

    #[test]
    fn sanitize_removes_empty_blocks_and_keeps_rest() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("s.jsonl");
        let lines = [
            json!({ "type": "assistant", "message": { "content": [
                { "type": "text", "text": "" },
                { "type": "text", "text": "keep" },
            ]}})
            .to_string(),
            json!({ "type": "assistant", "message": { "content": [
                { "type": "thinking", "thinking": "" },
            ]}})
            .to_string(),
            json!({ "type": "queue-operation" }).to_string(),
        ];
        std::fs::write(&path, lines.join("\n")).expect("write");

        assert!(sanitize_session_jsonl(&path).expect("sanitize"));
        let healed = read_session_messages(&path);
        assert_eq!(healed.len(), 2);
        assert_eq!(
            healed[0]["message"]["content"],
            json!([{ "type": "text", "text": "keep" }])
        );
        // A fully-empty content array is replaced with a single space block.
        assert_eq!(
            healed[1]["message"]["content"],
            json!([{ "type": "text", "text": " " }])
        );
        // Idempotent: a clean file reports no change.
        assert!(!sanitize_session_jsonl(&path).expect("second pass"));
    }
}
