//! Durable task-run event ingest.
//!
//! Port of `TaskRunEventStreamSender` (`event-stream-sender.ts`): events are
//! wrapped in `{"seq":n,"event":{...}}` envelopes and written as NDJSON lines
//! onto a chunked streaming POST, either directly to Django
//! (`/api/projects/{p}/tasks/{t}/runs/{r}/event_stream/`) or to the agent
//! proxy (`/v1/runs/{r}/ingest`). Semantics preserved: monotonic sequence
//! numbers, sequence sync + 409 rebase against the server's
//! `last_accepted_seq`, stream rotation windows (event count / bytes / age),
//! oversized-event drops, buffer backpressure drops, retry with delay, and a
//! `{"type":"_posthog/stream_complete","final_seq":n}` sentinel on stop.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;
use tokio_stream::wrappers::ReceiverStream;

pub const DEFAULT_MAX_BUFFERED_EVENTS: usize = 20_000;
pub const DEFAULT_MAX_STREAM_EVENTS: u64 = 900;
pub const DEFAULT_MAX_STREAM_BYTES: u64 = 4_000_000;
pub const DEFAULT_MAX_EVENT_BYTES: usize = 900_000;
pub const DEFAULT_RETRY_DELAY_MS: u64 = 1_000;
pub const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 10_000;
pub const DEFAULT_STOP_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_STREAM_WINDOW_MS: u64 = 5 * 60 * 1_000;
pub const STREAM_COMPLETE_CONTROL_TYPE: &str = "_posthog/stream_complete";

#[derive(Debug, Clone)]
pub struct IngestConfig {
    pub api_url: String,
    /// Base URL for the event-ingest POST only; falls back to `api_url`
    /// (Django path) when unset — presence selects the proxy route shape.
    pub event_ingest_base_url: Option<String>,
    pub keep_proxy_stream_open: bool,
    pub project_id: i64,
    pub task_id: String,
    pub run_id: String,
    pub token: String,
    pub max_buffered_events: usize,
    pub max_stream_events: u64,
    pub max_stream_bytes: u64,
    pub max_event_bytes: usize,
    pub retry_delay: Duration,
    pub request_timeout: Duration,
    pub stop_timeout: Duration,
    pub stream_window: Duration,
}

impl IngestConfig {
    pub fn new(
        api_url: impl Into<String>,
        project_id: i64,
        task_id: impl Into<String>,
        run_id: impl Into<String>,
        token: impl Into<String>,
    ) -> Self {
        Self {
            api_url: api_url.into(),
            event_ingest_base_url: None,
            keep_proxy_stream_open: false,
            project_id,
            task_id: task_id.into(),
            run_id: run_id.into(),
            token: token.into(),
            max_buffered_events: DEFAULT_MAX_BUFFERED_EVENTS,
            max_stream_events: DEFAULT_MAX_STREAM_EVENTS,
            max_stream_bytes: DEFAULT_MAX_STREAM_BYTES,
            max_event_bytes: DEFAULT_MAX_EVENT_BYTES,
            retry_delay: Duration::from_millis(DEFAULT_RETRY_DELAY_MS),
            request_timeout: Duration::from_millis(DEFAULT_REQUEST_TIMEOUT_MS),
            stop_timeout: Duration::from_millis(DEFAULT_STOP_TIMEOUT_MS),
            stream_window: Duration::from_millis(DEFAULT_STREAM_WINDOW_MS),
        }
    }

    fn ingest_url(&self) -> (String, bool) {
        let using_proxy = self.event_ingest_base_url.is_some();
        let base = self
            .event_ingest_base_url
            .as_deref()
            .unwrap_or(&self.api_url)
            .trim_end_matches('/')
            .to_string();
        let url = if using_proxy {
            format!("{base}/v1/runs/{}/ingest", urlencode(&self.run_id))
        } else {
            format!(
                "{base}/api/projects/{}/tasks/{}/runs/{}/event_stream/",
                self.project_id,
                urlencode(&self.task_id),
                urlencode(&self.run_id)
            )
        };
        (url, using_proxy)
    }
}

fn urlencode(s: &str) -> String {
    // encodeURIComponent-alike for path segments; ids are uuid-ish so this
    // only defends against separators.
    s.replace('%', "%25").replace('/', "%2F")
}

enum Msg {
    Enqueue(Arc<str>),
    Stop(oneshot::Sender<()>),
}

/// Handle to the ingest actor. Cheap to clone; `enqueue` never blocks.
#[derive(Clone)]
pub struct EventStreamSender {
    tx: mpsc::UnboundedSender<Msg>,
}

impl EventStreamSender {
    pub fn spawn(config: IngestConfig) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(run_actor(config, rx));
        Self { tx }
    }

    /// Enqueue a serialized event envelope (a JSON object, no newline).
    pub fn enqueue(&self, event: Arc<str>) {
        let _ = self.tx.send(Msg::Enqueue(event));
    }

    /// Flush remaining events, write the completion sentinel, and close the
    /// stream — bounded by the configured stop timeout.
    pub async fn stop(&self) {
        let (ack_tx, ack_rx) = oneshot::channel();
        if self.tx.send(Msg::Stop(ack_tx)).is_ok() {
            let _ = ack_rx.await;
        }
    }
}

struct BufferedEvent {
    seq: u64,
    event: Arc<str>,
}

struct ActiveStream {
    line_tx: Option<mpsc::Sender<Result<Bytes, std::io::Error>>>,
    response: tokio::task::JoinHandle<Result<reqwest::Response, reqwest::Error>>,
    started_at: Instant,
    sent_through_seq: u64,
    sent_events: u64,
    sent_bytes: u64,
}

struct Actor {
    config: IngestConfig,
    url: String,
    using_proxy: bool,
    client: reqwest::Client,
    buffered: VecDeque<BufferedEvent>,
    sequence: u64,
    last_known_accepted_seq: u64,
    sequence_synced: bool,
    sequence_initialized: bool,
    active: Option<ActiveStream>,
    stopped: bool,
    dropped_before_sequence: u64,
}

async fn run_actor(config: IngestConfig, mut rx: mpsc::UnboundedReceiver<Msg>) {
    let (url, using_proxy) = config.ingest_url();
    tracing::info!(ingest_url = %url, routed_to_proxy = using_proxy, "Event ingest target resolved");
    let mut actor = Actor {
        client: reqwest::Client::new(),
        url,
        using_proxy,
        buffered: VecDeque::new(),
        sequence: 0,
        last_known_accepted_seq: 0,
        sequence_synced: false,
        sequence_initialized: false,
        active: None,
        stopped: false,
        dropped_before_sequence: 0,
        config,
    };

    let mut retry_at: Option<Instant> = None;

    loop {
        let window_deadline = actor
            .active
            .as_ref()
            .map(|s| s.started_at + actor.config.stream_window);

        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(Msg::Enqueue(event)) => {
                        actor.accept(event);
                        // Coalesce a burst of enqueues before flushing (the TS
                        // setTimeout(0) flush delay batches the same way).
                        while let Ok(Msg::Enqueue(event)) = rx.try_recv() {
                            actor.accept(event);
                        }
                        if retry_at.is_none() && actor.flush().await.is_err() {
                            retry_at = Some(Instant::now() + actor.config.retry_delay);
                        }
                    }
                    Some(Msg::Stop(ack)) => {
                        actor.stopped = true;
                        actor.drain_for_stop().await;
                        let _ = ack.send(());
                        return;
                    }
                    None => return,
                }
            }
            _ = async {
                match retry_at {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending().await,
                }
            } => {
                retry_at = None;
                if actor.flush().await.is_err() {
                    retry_at = Some(Instant::now() + actor.config.retry_delay);
                }
            }
            _ = async {
                match window_deadline {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending().await,
                }
            } => {
                // Rotate long-lived uploads even when idle: a transport
                // boundary, not a batching window.
                if let Err(err) = actor.close_active().await {
                    tracing::warn!(error = %err, "Task run event ingest stream window close failed");
                    if !actor.buffered.is_empty() {
                        retry_at = Some(Instant::now() + actor.config.retry_delay);
                    }
                }
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct IngestError(String);

impl Actor {
    fn accept(&mut self, event: Arc<str>) {
        if self.stopped {
            return;
        }

        let envelope_len = envelope_line(self.sequence + 1, &event).len() - 1; // exclude newline
        if envelope_len > self.config.max_event_bytes {
            tracing::warn!(
                event_bytes = envelope_len,
                max_event_bytes = self.config.max_event_bytes,
                "Dropped oversized task run event"
            );
            return;
        }

        if self.buffered.len() >= self.config.max_buffered_events {
            self.dropped_before_sequence += 1;
            if self.dropped_before_sequence == 1 || self.dropped_before_sequence.is_multiple_of(100)
            {
                tracing::warn!(
                    dropped = self.dropped_before_sequence,
                    max_buffered_events = self.config.max_buffered_events,
                    "Dropped task run event before assigning sequence due to backpressure"
                );
            }
            return;
        }

        if self.dropped_before_sequence > 0 {
            tracing::info!(
                dropped = self.dropped_before_sequence,
                "Task run event ingest recovered after drops"
            );
            self.dropped_before_sequence = 0;
        }

        self.sequence += 1;
        self.buffered.push_back(BufferedEvent {
            seq: self.sequence,
            event,
        });
    }

    async fn flush(&mut self) -> Result<(), IngestError> {
        if self.buffered.is_empty() {
            return Ok(());
        }
        let result = self.flush_buffered_events().await;
        match result {
            Ok(()) => {
                // The ingress ahead of the agent-proxy only forwards the
                // request body once the upload closes, so close per drained
                // batch to avoid stranding buffered events.
                if !self.stopped && self.using_proxy && !self.config.keep_proxy_stream_open {
                    self.close_active().await?;
                }
                Ok(())
            }
            Err(err) => {
                tracing::warn!(error = %err, "Task run event ingest stream write failed");
                self.abort_active();
                Err(err)
            }
        }
    }

    async fn flush_buffered_events(&mut self) -> Result<(), IngestError> {
        loop {
            self.ensure_active_stream().await?;
            let stream = self.active.as_ref().expect("stream just ensured");
            let Some(next) = self
                .buffered
                .iter()
                .find(|e| e.seq > stream.sent_through_seq)
            else {
                return Ok(());
            };

            let line = envelope_line(next.seq, &next.event);
            let line_bytes = line.len() as u64;
            if self.should_roll_before_writing(line_bytes, false) {
                self.close_active().await?;
                continue;
            }

            let seq = next.seq;
            self.write_line(line).await?;
            let stream = self.active.as_mut().expect("active stream");
            stream.sent_through_seq = seq;
            stream.sent_events += 1;
            stream.sent_bytes += line_bytes;
        }
    }

    async fn write_completion_line(&mut self) -> Result<(), IngestError> {
        self.sync_sequence_with_server().await?;

        loop {
            self.ensure_active_stream().await?;
            let stream = self.active.as_ref().expect("stream just ensured");
            let has_unwritten = self
                .buffered
                .iter()
                .any(|e| e.seq > stream.sent_through_seq);
            if has_unwritten {
                self.flush_buffered_events().await?;
                continue;
            }

            let line = format!(
                "{{\"type\":\"{STREAM_COMPLETE_CONTROL_TYPE}\",\"final_seq\":{}}}\n",
                self.sequence
            );
            let line_bytes = line.len() as u64;
            if self.should_roll_before_writing(line_bytes, true) {
                self.close_active().await?;
                continue;
            }

            self.write_line(line).await?;
            let stream = self.active.as_mut().expect("active stream");
            stream.sent_bytes += line_bytes;
            return Ok(());
        }
    }

    fn should_roll_before_writing(&self, line_bytes: u64, ignore_event_count: bool) -> bool {
        let Some(stream) = self.active.as_ref() else {
            return false;
        };
        if !ignore_event_count
            && stream.sent_events > 0
            && stream.sent_events >= self.config.max_stream_events
        {
            return true;
        }
        if stream.sent_bytes > 0 && stream.sent_bytes + line_bytes > self.config.max_stream_bytes {
            return true;
        }
        stream.started_at.elapsed() >= self.config.stream_window
    }

    async fn write_line(&mut self, line: String) -> Result<(), IngestError> {
        let stream = self.active.as_mut().expect("active stream");
        let tx = stream
            .line_tx
            .as_ref()
            .ok_or_else(|| IngestError("stream already closing".to_string()))?;
        tx.send(Ok(Bytes::from(line)))
            .await
            .map_err(|_| IngestError("event ingest upload connection closed".to_string()))
    }

    async fn ensure_active_stream(&mut self) -> Result<(), IngestError> {
        if self.active.is_some() {
            return Ok(());
        }

        self.sync_sequence_with_server().await?;

        let (line_tx, line_rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(256);
        let body = reqwest::Body::wrap_stream(ReceiverStream::new(line_rx));
        let request = self
            .client
            .post(&self.url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .header("Content-Type", "application/x-ndjson")
            .body(body);
        let response = tokio::spawn(request.send());

        self.active = Some(ActiveStream {
            line_tx: Some(line_tx),
            response,
            started_at: Instant::now(),
            sent_through_seq: self.last_known_accepted_seq,
            sent_events: 0,
            sent_bytes: 0,
        });
        Ok(())
    }

    async fn close_active(&mut self) -> Result<(), IngestError> {
        let Some(mut stream) = self.active.take() else {
            return Ok(());
        };

        // Dropping the sender ends the chunked body; the server then responds.
        stream.line_tx = None;

        let response = tokio::time::timeout(self.config.request_timeout, stream.response).await;
        let response = match response {
            Ok(Ok(Ok(response))) => response,
            Ok(Ok(Err(err))) => {
                self.sequence_synced = false;
                return Err(IngestError(format!("event ingest request failed: {err}")));
            }
            Ok(Err(join_err)) => {
                self.sequence_synced = false;
                return Err(IngestError(format!(
                    "event ingest request panicked: {join_err}"
                )));
            }
            Err(_) => {
                self.sequence_synced = false;
                return Err(IngestError("event ingest response timed out".to_string()));
            }
        };

        self.apply_ingest_response(response, "Event ingest stream")
            .await?;
        self.sequence_synced = true;
        Ok(())
    }

    fn abort_active(&mut self) {
        if let Some(stream) = self.active.take() {
            stream.response.abort();
            self.sequence_synced = false;
        }
    }

    async fn drain_for_stop(&mut self) {
        let started = Instant::now();
        let deadline = started + self.config.stop_timeout;

        loop {
            let before_len = self.buffered.len();
            let result: Result<(), IngestError> = async {
                self.flush().await?;
                self.write_completion_line().await?;
                self.close_active().await?;
                Ok(())
            }
            .await;

            match result {
                Ok(()) => return,
                Err(err) => {
                    tracing::warn!(error = %err, "Task run event ingest stop request failed");
                    self.abort_active();
                }
            }

            let made_progress = self.buffered.len() < before_len;
            let now = Instant::now();
            if now >= deadline {
                self.warn_stop_deadline(started);
                return;
            }
            if !made_progress {
                let wait = self.config.retry_delay.min(deadline - now);
                tokio::time::sleep(wait).await;
                if Instant::now() >= deadline {
                    self.warn_stop_deadline(started);
                    return;
                }
            }
        }
    }

    fn warn_stop_deadline(&self, started: Instant) {
        tracing::warn!(
            remaining = self.buffered.len(),
            stop_timeout_ms = self.config.stop_timeout.as_millis() as u64,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "Task run event ingest stop deadline reached before fully completing transport"
        );
    }

    async fn sync_sequence_with_server(&mut self) -> Result<(), IngestError> {
        if self.sequence_synced {
            return Ok(());
        }

        let response = self
            .client
            .post(&self.url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .header("Content-Type", "application/x-ndjson")
            .body("")
            .timeout(self.config.request_timeout)
            .send()
            .await
            .map_err(|err| IngestError(format!("event ingest sequence sync failed: {err}")))?;

        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(IngestError(format!(
                "Event ingest sequence sync returned HTTP {}: {}",
                status.as_u16(),
                text.chars().take(300).collect::<String>()
            )));
        }

        if let Some(last_accepted) = parse_last_accepted_seq(&text) {
            if last_accepted > 0 {
                if !self.sequence_initialized {
                    for event in &mut self.buffered {
                        event.seq += last_accepted;
                    }
                    self.sequence += last_accepted;
                } else {
                    self.accept_through(last_accepted);
                    if last_accepted > self.sequence {
                        self.sequence = last_accepted;
                    }
                }
                self.last_known_accepted_seq = last_accepted;
            }
        }

        self.sequence_synced = true;
        self.sequence_initialized = true;
        Ok(())
    }

    async fn apply_ingest_response(
        &mut self,
        response: reqwest::Response,
        label: &str,
    ) -> Result<(), IngestError> {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();

        if let Some(last_accepted) = parse_last_accepted_seq(&text) {
            self.accept_through(last_accepted);
            if last_accepted > self.sequence {
                self.sequence = last_accepted;
            }
            self.last_known_accepted_seq = last_accepted;
            if status.as_u16() == 409 {
                self.rebase_buffered_events(last_accepted);
            }
        }

        if !status.is_success() {
            return Err(IngestError(format!(
                "{label} returned HTTP {}: {}",
                status.as_u16(),
                text.chars().take(300).collect::<String>()
            )));
        }
        Ok(())
    }

    fn accept_through(&mut self, last_accepted_seq: u64) {
        self.buffered.retain(|event| event.seq > last_accepted_seq);
    }

    fn rebase_buffered_events(&mut self, last_accepted_seq: u64) {
        let mut next_seq = last_accepted_seq + 1;
        for event in &mut self.buffered {
            event.seq = next_seq;
            next_seq += 1;
        }
        self.sequence = next_seq - 1;
        self.sequence_synced = true;
        self.sequence_initialized = true;
        self.last_known_accepted_seq = last_accepted_seq;
    }
}

fn envelope_line(seq: u64, event: &str) -> String {
    format!("{{\"seq\":{seq},\"event\":{event}}}\n")
}

fn parse_last_accepted_seq(body: &str) -> Option<u64> {
    if body.is_empty() {
        return None;
    }
    let parsed: Value = serde_json::from_str(body).ok()?;
    parsed.get("last_accepted_seq")?.as_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_line_shape_matches_ts() {
        let line = envelope_line(
            7,
            r#"{"type":"notification","notification":{"method":"m"}}"#,
        );
        assert_eq!(
            line,
            "{\"seq\":7,\"event\":{\"type\":\"notification\",\"notification\":{\"method\":\"m\"}}}\n"
        );
    }

    #[test]
    fn ingest_url_django_and_proxy_shapes() {
        let config = IngestConfig::new("https://us.posthog.com/", 2, "task_1", "run_1", "tok");
        let (url, proxy) = config.ingest_url();
        assert_eq!(
            url,
            "https://us.posthog.com/api/projects/2/tasks/task_1/runs/run_1/event_stream/"
        );
        assert!(!proxy);

        let mut config = IngestConfig::new("https://us.posthog.com", 2, "task_1", "run_1", "tok");
        config.event_ingest_base_url = Some("https://proxy.example/".to_string());
        let (url, proxy) = config.ingest_url();
        assert_eq!(url, "https://proxy.example/v1/runs/run_1/ingest");
        assert!(proxy);
    }
}
