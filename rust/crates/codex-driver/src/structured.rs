//! Structured-output parsing from the final assistant message. Port of
//! `structured-output.ts`: fenced block, whole message, then the first
//! balanced `{...}` in the prose (string-aware, so trailing braces in prose
//! can't extend the match).

use serde_json::Value;

pub fn parse_structured_output(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    if let Some(parsed) = parse_json_object(trimmed) {
        return Some(parsed);
    }
    if let Some(fenced) = extract_fenced_block(trimmed) {
        if let Some(parsed) = parse_json_object(fenced.trim()) {
            return Some(parsed);
        }
    }

    let mut search_from = 0;
    for _ in 0..100 {
        let start = trimmed[search_from..].find('{')? + search_from;
        let end = find_balanced_object_end(trimmed, start)?;
        if let Some(parsed) = parse_json_object(&trimmed[start..=end]) {
            return Some(parsed);
        }
        search_from = start + 1;
    }
    None
}

fn extract_fenced_block(text: &str) -> Option<&str> {
    let start = text.find("```")?;
    let after_fence = &text[start + 3..];
    let body_start = after_fence.strip_prefix("json").unwrap_or(after_fence);
    let end = body_start.find("```")?;
    Some(&body_start[..end])
}

fn parse_json_object(candidate: &str) -> Option<Value> {
    let parsed: Value = serde_json::from_str(candidate).ok()?;
    parsed.is_object().then_some(parsed)
}

/// Byte index of the `}` closing the object opened at `start` (string-aware).
fn find_balanced_object_end(text: &str, start: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0i64;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &byte) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_plain_fenced_and_embedded_objects() {
        assert_eq!(
            parse_structured_output("{\"a\": 1}"),
            Some(json!({ "a": 1 }))
        );
        assert_eq!(
            parse_structured_output("Here you go:\n```json\n{\"a\": 2}\n```\nDone."),
            Some(json!({ "a": 2 }))
        );
        assert_eq!(
            parse_structured_output("The result is {\"a\": \"b } c\"} as requested {not json}."),
            Some(json!({ "a": "b } c" }))
        );
        assert_eq!(parse_structured_output("[1, 2]"), None);
        assert_eq!(parse_structured_output("no json here"), None);
    }
}
