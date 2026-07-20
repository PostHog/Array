//! Run artifacts: skill-bundle installation and attachment hydration.
//!
//! Port of the artifact half of `agent-server.ts`: skill bundles are
//! checksum-verified, unzipped under `.posthog/skills/` and copied into the
//! agent skill roots; other artifacts are downloaded to
//! `.posthog/attachments/` and surfaced to the prompt as `resource_link`
//! blocks. `/skill-name` invocations inject the installed SKILL.md as
//! `localSkillContext` prompt meta.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};
use sha2::Digest;

use crate::posthog_api::PostHogApiClient;

#[derive(Debug, Clone)]
pub struct BuiltPrompt {
    pub prompt: Vec<Value>,
    pub meta: Option<Value>,
}

#[derive(Debug, Clone)]
struct InstalledSkillBundle {
    skill_name: String,
    skill_definition: String,
    skill_root: PathBuf,
}

#[derive(Default)]
pub struct ArtifactManager {
    installed_bundles: Mutex<HashSet<String>>,
    installed_info: Mutex<HashMap<String, InstalledSkillBundle>>,
}

/// `buildMissingAttachmentNotice`.
pub fn missing_attachment_notice(count: usize) -> String {
    let subject = if count == 1 {
        "A file".to_string()
    } else {
        format!("{count} files")
    };
    let pronoun = if count == 1 { "it" } else { "they" };
    let noun = if count == 1 {
        "attachment"
    } else {
        "attachments"
    };
    format!(
        "{subject} the user attached to this message could not be loaded into the session, \
         so {pronoun} are unavailable here. Do not guess at the contents. Tell the user the \
         {noun} didn't come through, and ask them to paste the text directly or send {pronoun} again."
    )
}

/// `getSafeArtifactName`.
pub fn safe_artifact_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().trim().to_string())
        .unwrap_or_default();
    let normalized: String = base
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if normalized.is_empty() || normalized.chars().all(|c| c == '.') {
        "attachment".to_string()
    } else {
        normalized
    }
}

fn artifact_str<'a>(artifact: &'a Value, key: &str) -> Option<&'a str> {
    artifact
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

impl ArtifactManager {
    /// `buildPromptFromContentAndArtifacts`.
    #[allow(clippy::too_many_arguments)]
    pub async fn build_prompt(
        &self,
        api: &PostHogApiClient,
        workspace_root: &str,
        task_id: &str,
        run_id: &str,
        content_blocks: Vec<Value>,
        artifacts: &[Value],
    ) -> BuiltPrompt {
        self.install_skill_bundles(api, workspace_root, task_id, run_id, artifacts)
            .await;
        let skill_context = self.installed_skill_prompt_context(&content_blocks, run_id, artifacts);

        let mut prompt = content_blocks;
        for artifact in artifacts {
            if artifact_str(artifact, "type") == Some("skill_bundle") {
                continue;
            }
            match self
                .hydrate_artifact(api, workspace_root, task_id, run_id, artifact)
                .await
            {
                Ok(Some(block)) => prompt.push(block),
                Ok(None) => {}
                Err(err) => tracing::warn!(error = %err, "Failed to hydrate artifact"),
            }
        }

        let meta = skill_context.map(|(skill_name, context)| {
            json!({ "localSkillContext": context, "localSkillName": skill_name })
        });
        BuiltPrompt { prompt, meta }
    }

    /// `installSkillBundleArtifacts` (per-artifact failures are logged, not fatal).
    pub async fn install_skill_bundles(
        &self,
        api: &PostHogApiClient,
        workspace_root: &str,
        task_id: &str,
        run_id: &str,
        artifacts: &[Value],
    ) {
        for artifact in artifacts {
            if artifact_str(artifact, "type") != Some("skill_bundle") {
                continue;
            }
            if let Err(err) = self
                .install_skill_bundle(api, workspace_root, task_id, run_id, artifact)
                .await
            {
                tracing::warn!(error = %err, "Failed to install skill bundle artifact");
            }
        }
    }

    async fn install_skill_bundle(
        &self,
        api: &PostHogApiClient,
        workspace_root: &str,
        _task_id: &str,
        run_id: &str,
        artifact: &Value,
    ) -> Result<(), String> {
        let name = artifact_str(artifact, "name").unwrap_or("<unnamed>");
        let storage_path = artifact_str(artifact, "storage_path");
        let skill_name = artifact
            .pointer("/metadata/skill_name")
            .and_then(Value::as_str);
        let expected_sha256 = artifact
            .pointer("/metadata/content_sha256")
            .and_then(Value::as_str);
        let (Some(storage_path), Some(skill_name), Some(expected_sha256)) =
            (storage_path, skill_name, expected_sha256)
        else {
            return Err(format!("Skill bundle artifact {name} is missing metadata"));
        };

        let install_key = format!("{run_id}:{expected_sha256}:{skill_name}");
        let info_key = format!("{run_id}:{skill_name}");
        {
            let bundles = self.installed_bundles.lock().expect("bundles lock");
            let info = self.installed_info.lock().expect("info lock");
            if bundles.contains(&install_key) && info.contains_key(&info_key) {
                return Ok(());
            }
        }

        let data = api
            .download_artifact(_task_id, run_id, storage_path)
            .await
            .map_err(|e| format!("Failed to download skill bundle {name}: {e}"))?;

        let actual_sha256 = hex::encode(sha2::Sha256::digest(&data));
        if actual_sha256 != expected_sha256 {
            return Err(format!(
                "Skill bundle {skill_name} failed checksum validation"
            ));
        }

        let safe_name = safe_artifact_name(skill_name);
        let skill_root = Path::new(workspace_root)
            .join(".posthog/skills")
            .join(run_id)
            .join(&actual_sha256)
            .join(&safe_name);

        let _ = tokio::fs::remove_dir_all(&skill_root).await;
        tokio::fs::create_dir_all(&skill_root)
            .await
            .map_err(|e| format!("mkdir skill root: {e}"))?;
        extract_zip(&data, &skill_root).map_err(|e| format!("unzip {skill_name}: {e}"))?;

        let skill_definition = tokio::fs::read_to_string(skill_root.join("SKILL.md"))
            .await
            .ok()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| format!("Skill bundle {skill_name} does not contain SKILL.md"))?;

        for destination in skill_install_directories(&safe_name) {
            let _ = tokio::fs::remove_dir_all(&destination).await;
            if let Some(parent) = destination.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            if let Err(err) = copy_dir_recursive(&skill_root, &destination).await {
                tracing::warn!(
                    destination = %destination.display(),
                    error = %err,
                    "Failed to copy skill bundle to skill root"
                );
            }
        }

        self.installed_bundles
            .lock()
            .expect("bundles lock")
            .insert(install_key);
        self.installed_info.lock().expect("info lock").insert(
            info_key,
            InstalledSkillBundle {
                skill_name: skill_name.to_string(),
                skill_definition,
                skill_root,
            },
        );
        tracing::debug!(skill_name, content_sha256 = %actual_sha256, "Installed skill bundle artifact");
        Ok(())
    }

    /// `hydrateArtifactToPromptBlock`.
    async fn hydrate_artifact(
        &self,
        api: &PostHogApiClient,
        workspace_root: &str,
        task_id: &str,
        run_id: &str,
        artifact: &Value,
    ) -> Result<Option<Value>, String> {
        let name = artifact_str(artifact, "name").unwrap_or("attachment");
        let Some(storage_path) = artifact_str(artifact, "storage_path") else {
            tracing::warn!(
                artifact_name = name,
                "Skipping artifact without storage path"
            );
            return Ok(None);
        };

        let data = api
            .download_artifact(task_id, run_id, storage_path)
            .await
            .map_err(|e| format!("Failed to download artifact {name}: {e}"))?;

        let safe_name = safe_artifact_name(name);
        let artifact_dir = Path::new(workspace_root)
            .join(".posthog/attachments")
            .join(run_id)
            .join(artifact_str(artifact, "id").unwrap_or(&safe_name));
        tokio::fs::create_dir_all(&artifact_dir)
            .await
            .map_err(|e| format!("mkdir attachments: {e}"))?;
        let artifact_path = artifact_dir.join(&safe_name);
        tokio::fs::write(&artifact_path, &data)
            .await
            .map_err(|e| format!("write attachment: {e}"))?;

        let mut block = json!({
            "type": "resource_link",
            "uri": format!("file://{}", artifact_path.display()),
            "name": name,
        });
        if let Some(content_type) = artifact_str(artifact, "content_type") {
            block["mimeType"] = json!(content_type);
        }
        if let Some(size) = artifact.get("size").and_then(Value::as_u64) {
            block["size"] = json!(size);
        }
        Ok(Some(block))
    }

    /// `buildInstalledSkillPromptContext` + `parseLocalSkillInvocation`.
    fn installed_skill_prompt_context(
        &self,
        content_blocks: &[Value],
        run_id: &str,
        artifacts: &[Value],
    ) -> Option<(String, String)> {
        let text = content_blocks.iter().find_map(|block| {
            (block.get("type").and_then(Value::as_str) == Some("text"))
                .then(|| block.get("text").and_then(Value::as_str))
                .flatten()
                .filter(|t| !t.trim().is_empty())
        })?;

        let trimmed = text.trim();
        let rest = trimmed.strip_prefix('/')?;
        let (skill_name, args) = match rest.split_once(char::is_whitespace) {
            Some((name, args)) => (name, Some(args.trim())),
            None => (rest, None),
        };
        if skill_name.is_empty() {
            return None;
        }

        let has_matching_artifact = artifacts.iter().any(|artifact| {
            artifact_str(artifact, "type") == Some("skill_bundle")
                && artifact
                    .pointer("/metadata/skill_name")
                    .and_then(Value::as_str)
                    == Some(skill_name)
        });
        if !has_matching_artifact {
            return None;
        }

        let info = self.installed_info.lock().expect("info lock");
        let skill = info.get(&format!("{run_id}:{skill_name}"))?;

        let context = [
            format!(
                "The user invoked the local skill \"/{}\". Apply these skill instructions for this turn.",
                skill.skill_name
            ),
            String::new(),
            format!("--- BEGIN LOCAL SKILL {} ---", skill.skill_name),
            skill.skill_definition.trim().to_string(),
            format!("--- END LOCAL SKILL {} ---", skill.skill_name),
            String::new(),
            format!("Installed skill path: {}", skill.skill_root.display()),
            String::new(),
            "User request:".to_string(),
            args.filter(|a| !a.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Run /{}.", skill.skill_name)),
        ]
        .join("\n");

        Some((skill.skill_name.clone(), context))
    }
}

/// `getSkillInstallDirectories`.
fn skill_install_directories(skill_name: &str) -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    vec![
        Path::new("/scripts/plugins/posthog/skills").join(skill_name),
        Path::new(&home).join(".agents/skills").join(skill_name),
        Path::new(&home).join(".claude/skills").join(skill_name),
    ]
}

/// `extractSkillBundle`: unzip with traversal protection.
fn extract_zip(archive: &[u8], destination_root: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(archive);
    let mut zip = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let raw_name = entry.name().replace('\\', "/");
        if raw_name.is_empty()
            || raw_name.ends_with('/')
            || raw_name.starts_with('/')
            || raw_name.split('/').any(|part| part == "..")
        {
            continue;
        }
        let destination = destination_root.join(&raw_name);
        if !destination.starts_with(destination_root) {
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut content = Vec::new();
        entry.read_to_end(&mut content).map_err(|e| e.to_string())?;
        std::fs::write(&destination, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(destination)
        .await
        .map_err(|e| e.to_string())?;
    let mut stack = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((src, dst)) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&src).await.map_err(|e| e.to_string())?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let entry_dst = dst.join(entry.file_name());
            let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
            if file_type.is_dir() {
                tokio::fs::create_dir_all(&entry_dst)
                    .await
                    .map_err(|e| e.to_string())?;
                stack.push((entry.path(), entry_dst));
            } else {
                tokio::fs::copy(entry.path(), &entry_dst)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// `getArtifactsById` — resolve pending artifact ids against the manifest.
pub fn artifacts_by_id(
    manifest: &[Value],
    artifact_ids: &[String],
    warn_on_missing: bool,
) -> Vec<Value> {
    artifact_ids
        .iter()
        .filter_map(|artifact_id| {
            let found = manifest
                .iter()
                .find(|artifact| artifact_str(artifact, "id") == Some(artifact_id));
            if found.is_none() && warn_on_missing {
                tracing::warn!(artifact_id, "Pending artifact missing from run manifest");
            }
            found.cloned()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn safe_names_are_sanitized() {
        assert_eq!(safe_artifact_name("my file (1).txt"), "my_file__1_.txt");
        assert_eq!(safe_artifact_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_artifact_name("..."), "attachment");
        assert_eq!(safe_artifact_name(""), "attachment");
    }

    #[test]
    fn missing_attachment_notice_pluralizes() {
        assert!(missing_attachment_notice(1).starts_with("A file"));
        assert!(missing_attachment_notice(3).starts_with("3 files"));
    }

    #[test]
    fn zip_extraction_skips_traversal_entries() {
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("SKILL.md", options).unwrap();
            writer.write_all(b"# skill").unwrap();
            writer.start_file("../evil.txt", options).unwrap();
            writer.write_all(b"nope").unwrap();
            writer.start_file("nested/ok.txt", options).unwrap();
            writer.write_all(b"fine").unwrap();
            writer.finish().unwrap();
        }
        let dir = tempfile::tempdir().unwrap();
        extract_zip(buffer.get_ref(), dir.path()).unwrap();
        assert!(dir.path().join("SKILL.md").exists());
        assert!(dir.path().join("nested/ok.txt").exists());
        assert!(!dir.path().parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn resolves_artifacts_by_id() {
        let manifest = vec![
            json!({"id": "a1", "name": "one"}),
            json!({"id": "a2", "name": "two"}),
        ];
        let resolved =
            artifacts_by_id(&manifest, &["a2".to_string(), "missing".to_string()], false);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0]["name"], "two");
    }
}
