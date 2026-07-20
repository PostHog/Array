//! PostHog Django API client.
//!
//! Port of the endpoints in `packages/agent/src/posthog-api.ts` that the
//! agent-server calls. Task/TaskRun are deserialized loosely — the server
//! only reads a handful of fields and must tolerate schema growth.

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct PostHogApiClient {
    client: reqwest::Client,
    base_url: String,
    project_id: i64,
    api_key: String,
    user_agent: String,
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct ApiError(pub String);

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Task {
    pub id: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub internal: bool,
    pub origin_product: Option<String>,
    pub signal_report: Option<String>,
    pub json_schema: Option<Value>,
    pub created_by: Option<Value>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TaskRun {
    pub id: Option<String>,
    pub task: Option<String>,
    pub status: Option<String>,
    pub state: Option<Value>,
    pub artifacts: Option<Value>,
    pub log_url: Option<String>,
}

impl TaskRun {
    pub fn state_string(&self, key: &str) -> Option<String> {
        self.state.as_ref()?.get(key)?.as_str().map(str::to_string)
    }

    pub fn state_bool(&self, key: &str) -> Option<bool> {
        self.state.as_ref()?.get(key)?.as_bool()
    }
}

impl PostHogApiClient {
    pub fn new(api_url: &str, project_id: i64, api_key: &str, version: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: api_url.trim_end_matches('/').to_string(),
            project_id,
            api_key: api_key.to_string(),
            user_agent: format!("posthog/cloud.hog.dev; version: {version}"),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn project_id(&self) -> i64 {
        self.project_id
    }

    async fn request(
        &self,
        method: reqwest::Method,
        endpoint: &str,
        body: Option<Value>,
    ) -> Result<Value, ApiError> {
        let url = format!("{}{}", self.base_url, endpoint);
        let mut request = self
            .client
            .request(method, &url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("User-Agent", &self.user_agent);
        if let Some(body) = body {
            request = request.json(&body);
        }

        let response = request
            .send()
            .await
            .map_err(|err| ApiError(format!("Request to {endpoint} failed: {err}")))?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(ApiError(format!(
                "Failed request: [{}] {}",
                status.as_u16(),
                text
            )));
        }

        response
            .json::<Value>()
            .await
            .map_err(|err| ApiError(format!("Invalid JSON from {endpoint}: {err}")))
    }

    pub async fn get_task(&self, task_id: &str) -> Result<Task, ApiError> {
        let value = self
            .request(
                reqwest::Method::GET,
                &format!("/api/projects/{}/tasks/{task_id}/", self.project_id),
                None,
            )
            .await?;
        serde_json::from_value(value).map_err(|err| ApiError(format!("Invalid Task: {err}")))
    }

    pub async fn get_task_run(&self, task_id: &str, run_id: &str) -> Result<TaskRun, ApiError> {
        let value = self
            .request(
                reqwest::Method::GET,
                &format!(
                    "/api/projects/{}/tasks/{task_id}/runs/{run_id}/",
                    self.project_id
                ),
                None,
            )
            .await?;
        serde_json::from_value(value).map_err(|err| ApiError(format!("Invalid TaskRun: {err}")))
    }

    pub async fn update_task_run(
        &self,
        task_id: &str,
        run_id: &str,
        payload: Value,
    ) -> Result<(), ApiError> {
        self.request(
            reqwest::Method::PATCH,
            &format!(
                "/api/projects/{}/tasks/{task_id}/runs/{run_id}/",
                self.project_id
            ),
            Some(payload),
        )
        .await?;
        Ok(())
    }

    pub async fn set_task_run_output(
        &self,
        task_id: &str,
        run_id: &str,
        output: Value,
    ) -> Result<(), ApiError> {
        self.request(
            reqwest::Method::PATCH,
            &format!(
                "/api/projects/{}/tasks/{task_id}/runs/{run_id}/set_output/",
                self.project_id
            ),
            Some(output),
        )
        .await?;
        Ok(())
    }

    /// `entries` are `StoredNotification` envelopes
    /// (`{type:"notification",timestamp,notification}`).
    pub async fn append_task_run_log(
        &self,
        task_id: &str,
        run_id: &str,
        entries: Vec<Value>,
    ) -> Result<(), ApiError> {
        self.request(
            reqwest::Method::POST,
            &format!(
                "/api/projects/{}/tasks/{task_id}/runs/{run_id}/append_log/",
                self.project_id
            ),
            Some(json!({ "entries": entries })),
        )
        .await?;
        Ok(())
    }

    /// Upload artifacts; the backend returns the full manifest — callers get
    /// the artifacts corresponding to this upload (the tail).
    pub async fn upload_task_artifacts(
        &self,
        task_id: &str,
        run_id: &str,
        artifacts: Vec<Value>,
    ) -> Result<Vec<Value>, ApiError> {
        let count = artifacts.len();
        if count == 0 {
            return Ok(Vec::new());
        }
        let response = self
            .request(
                reqwest::Method::POST,
                &format!(
                    "/api/projects/{}/tasks/{task_id}/runs/{run_id}/artifacts/",
                    self.project_id
                ),
                Some(json!({ "artifacts": artifacts })),
            )
            .await?;
        let manifest = response
            .get("artifacts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let skip = manifest.len().saturating_sub(count);
        Ok(manifest.into_iter().skip(skip).collect())
    }

    /// Download artifact content by storage path (raw response bytes; handoff
    /// artifacts are stored base64-encoded, skill bundles as raw zips).
    pub async fn download_artifact(
        &self,
        task_id: &str,
        run_id: &str,
        storage_path: &str,
    ) -> Result<Vec<u8>, ApiError> {
        let url = format!(
            "{}/api/projects/{}/tasks/{task_id}/runs/{run_id}/artifacts/download/",
            self.base_url, self.project_id
        );
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("User-Agent", &self.user_agent)
            .json(&json!({ "storage_path": storage_path }))
            .send()
            .await
            .map_err(|err| ApiError(format!("Artifact download failed: {err}")))?;
        if !response.status().is_success() {
            return Err(ApiError(format!(
                "Failed to download artifact: {}",
                response.status().as_u16()
            )));
        }
        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|err| ApiError(format!("Artifact download read failed: {err}")))
    }

    /// Fetch the run's persisted log as parsed NDJSON entries. 404 → empty.
    pub async fn fetch_task_run_logs(
        &self,
        task_id: &str,
        run_id: &str,
    ) -> Result<Vec<Value>, ApiError> {
        let url = format!(
            "{}/api/projects/{}/tasks/{task_id}/runs/{run_id}/logs",
            self.base_url, self.project_id
        );
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("User-Agent", &self.user_agent)
            .send()
            .await
            .map_err(|err| ApiError(format!("Failed to fetch task run logs: {err}")))?;
        if response.status().as_u16() == 404 {
            return Ok(Vec::new());
        }
        if !response.status().is_success() {
            return Err(ApiError(format!(
                "Failed to fetch logs: {}",
                response.status().as_u16()
            )));
        }
        let content = response
            .text()
            .await
            .map_err(|err| ApiError(format!("Failed to read task run logs: {err}")))?;
        let mut entries = Vec::new();
        for line in content.trim().lines() {
            if line.trim().is_empty() {
                continue;
            }
            let entry: Value = serde_json::from_str(line)
                .map_err(|err| ApiError(format!("Failed to parse task run logs: {err}")))?;
            entries.push(entry);
        }
        Ok(entries)
    }

    pub async fn relay_message(
        &self,
        task_id: &str,
        run_id: &str,
        text: &str,
        text_parts: &[String],
    ) -> Result<(), ApiError> {
        // Send `text_parts` alongside the joined `text` so backends that
        // understand the new schema can pick just the post-last-tool-use
        // answer, while older backends still get the flat `text` field.
        let mut body = json!({ "text": text });
        if !text_parts.is_empty() {
            body["text_parts"] = json!(text_parts);
        }
        self.request(
            reqwest::Method::POST,
            &format!(
                "/api/projects/{}/tasks/{task_id}/runs/{run_id}/relay_message/",
                self.project_id
            ),
            Some(body),
        )
        .await?;
        Ok(())
    }
}
