//! ACP prompt → codex `UserInput[]` conversion. Port of `input.ts`
//! (`toCodexInput`): text passes through; images map to `image`/`localImage`;
//! `file://` resources become path notes and non-file resource text is
//! inlined as a trailing `<context ref>` block. Audio/blob/malformed drop.

use serde_json::{json, Value};

fn text_input(text: &str) -> Value {
    json!({ "type": "text", "text": text, "text_elements": [] })
}

fn file_uri_to_path(uri: &str) -> Option<&str> {
    uri.strip_prefix("file://")
}

/// A `file://` resource is surfaced as its path so codex reads it from disk.
fn resource_link_text(uri: &str) -> String {
    match file_uri_to_path(uri) {
        Some(path) => format!("Attached workspace file (read it from disk): {path}"),
        None => format!("Attached resource: {uri}"),
    }
}

fn image_to_codex_input(block: &Value) -> Option<Value> {
    let data = block.get("data").and_then(Value::as_str).unwrap_or("");
    if !data.is_empty() {
        let mime = block.get("mimeType").and_then(Value::as_str).unwrap_or("");
        return Some(json!({ "type": "image", "url": format!("data:{mime};base64,{data}") }));
    }
    let uri = block.get("uri").and_then(Value::as_str)?;
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return Some(json!({ "type": "image", "url": uri }));
    }
    file_uri_to_path(uri).map(|path| json!({ "type": "localImage", "path": path }))
}

pub fn to_codex_input(prompt: &[Value]) -> Vec<Value> {
    let mut input: Vec<Value> = Vec::new();
    let mut context: Vec<String> = Vec::new();

    for block in prompt {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    input.push(text_input(text));
                }
            }
            Some("image") => {
                if let Some(mapped) = image_to_codex_input(block) {
                    input.push(mapped);
                }
            }
            Some("resource_link") => {
                if let Some(uri) = block.get("uri").and_then(Value::as_str) {
                    input.push(text_input(&resource_link_text(uri)));
                }
            }
            Some("resource") => {
                let resource = block.get("resource");
                let Some(text) = resource.and_then(|r| r.get("text")).and_then(Value::as_str)
                else {
                    continue;
                };
                let uri = resource
                    .and_then(|r| r.get("uri"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if uri.starts_with("file://") {
                    input.push(text_input(&resource_link_text(uri)));
                    continue;
                }
                if !uri.is_empty() {
                    input.push(text_input(uri));
                }
                context.push(format!("<context ref=\"{uri}\">\n{text}\n</context>"));
            }
            _ => {}
        }
    }

    if !context.is_empty() {
        input.push(text_input(&context.join("\n")));
    }
    input
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_text_images_and_resources() {
        let input = to_codex_input(&[
            json!({ "type": "text", "text": "Fix the bug" }),
            json!({ "type": "image", "data": "abc", "mimeType": "image/png" }),
            json!({ "type": "image", "data": "", "uri": "https://x.test/a.png" }),
            json!({ "type": "resource_link", "uri": "file:///tmp/a.txt" }),
            json!({ "type": "resource", "resource": { "uri": "zed://ctx", "text": "extra" } }),
            json!({ "type": "audio", "data": "zzz" }),
        ]);
        assert_eq!(input.len(), 6);
        assert_eq!(input[0]["text"], "Fix the bug");
        assert_eq!(input[1]["url"], "data:image/png;base64,abc");
        assert_eq!(input[2]["url"], "https://x.test/a.png");
        assert_eq!(
            input[3]["text"],
            "Attached workspace file (read it from disk): /tmp/a.txt"
        );
        assert_eq!(input[4]["text"], "zed://ctx");
        assert!(input[5]["text"]
            .as_str()
            .unwrap()
            .contains("<context ref=\"zed://ctx\">"));
    }

    #[test]
    fn empty_prompt_maps_to_no_input() {
        assert!(to_codex_input(&[json!({ "type": "audio", "data": "x" })]).is_empty());
    }
}
