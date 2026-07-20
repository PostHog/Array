//! Event fan-out: one serialized envelope per event, shared by every sink.
//!
//! Mirrors `AgentServer.broadcastEvent` / `replayPendingEvents` /
//! `sendSseEvent` in `agent-server.ts`, with the Rust twist that the envelope
//! is serialized exactly once (`Arc<str>`) and every consumer — the live SSE
//! stream, the durable ingest sender, replay buffering — reuses those bytes.
//! The TS implementation re-parses and re-stringifies each message up to four
//! times per hop; not doing that is the point of the rewrite.

use std::sync::{Arc, Mutex};

use serde_json::value::RawValue;
use tokio::sync::mpsc;

use crate::ingest::EventStreamSender;
use crate::iso_now;

/// A single serialized event envelope (JSON object, no trailing newline).
pub type Envelope = Arc<str>;

/// Envelope for an ACP notification line: `{"type":"notification",
/// "timestamp":..., "notification":<raw line>}`. `raw_notification` must be a
/// valid JSON document (it comes straight off the ACP wire or from
/// `serde_json` — never from user input).
pub fn notification_envelope(raw_notification: &str) -> Envelope {
    Arc::from(format!(
        r#"{{"type":"notification","timestamp":"{}","notification":{}}}"#,
        iso_now(),
        raw_notification
    ))
}

/// Envelope for non-notification event frames (`connected`,
/// `permission_request`, ...). Serialized through serde since callers build
/// these from structured data.
pub fn value_envelope(value: &serde_json::Value) -> Envelope {
    Arc::from(value.to_string())
}

/// SSE frame for an envelope: `data: <json>\n\n`.
pub fn sse_data_frame(envelope: &str) -> String {
    format!("data: {envelope}\n\n")
}

pub const SSE_KEEPALIVE_FRAME: &str = ": keepalive\n\n";

/// The single live SSE subscriber (the server manages at most one, matching
/// `ActiveSession.sseController`). Frames are pre-rendered SSE strings.
pub type SseSink = mpsc::UnboundedSender<String>;

#[derive(Default)]
struct BusState {
    sse: Option<SseSink>,
    /// Events broadcast before any SSE client attached; replayed on attach.
    pending: Vec<Envelope>,
}

/// Fan-out hub for a session's event envelopes.
#[derive(Clone, Default)]
pub struct EventBus {
    state: Arc<Mutex<BusState>>,
    ingest: Arc<Mutex<Option<EventStreamSender>>>,
}

impl EventBus {
    pub fn new(ingest: Option<EventStreamSender>) -> Self {
        Self {
            state: Arc::new(Mutex::new(BusState::default())),
            ingest: Arc::new(Mutex::new(ingest)),
        }
    }

    /// Broadcast an envelope: enqueue on the durable ingest stream and send to
    /// the live SSE client (or buffer for replay if none is attached yet).
    pub fn broadcast(&self, envelope: Envelope) {
        if let Some(ingest) = self.ingest.lock().expect("ingest lock").as_ref() {
            ingest.enqueue(Arc::clone(&envelope));
        }

        let mut state = self.state.lock().expect("bus lock");
        match &state.sse {
            Some(sink) => {
                if sink.send(sse_data_frame(&envelope)).is_err() {
                    state.sse = None;
                    state.pending.push(envelope);
                }
            }
            None => state.pending.push(envelope),
        }
    }

    /// Convenience: wrap a raw ACP notification line and broadcast it.
    pub fn broadcast_notification_line(&self, raw_notification: &str) {
        self.broadcast(notification_envelope(raw_notification));
    }

    /// Attach the (single) SSE client and replay any buffered events, in order.
    pub fn attach_sse(&self, sink: SseSink) {
        let mut state = self.state.lock().expect("bus lock");
        for envelope in state.pending.drain(..) {
            let _ = sink.send(sse_data_frame(&envelope));
        }
        state.sse = Some(sink);
    }

    /// Detach the SSE client if `sink` is still the attached one.
    pub fn detach_sse(&self, sink: &SseSink) {
        let mut state = self.state.lock().expect("bus lock");
        if let Some(current) = &state.sse {
            if current.same_channel(sink) {
                state.sse = None;
            }
        }
    }

    pub fn has_sse(&self) -> bool {
        self.state.lock().expect("bus lock").sse.is_some()
    }

    /// Send a frame only to the live SSE client (not ingested, not buffered) —
    /// used for the `connected` handshake frame.
    pub fn send_sse_only(&self, value: &serde_json::Value) {
        let mut state = self.state.lock().expect("bus lock");
        if let Some(sink) = &state.sse {
            if sink.send(sse_data_frame(&value.to_string())).is_err() {
                state.sse = None;
            }
        }
    }

    /// Enqueue an event only on the durable ingest stream (terminal events
    /// use this via `enqueueTaskTerminalEvent` semantics).
    pub fn enqueue_ingest_only(&self, envelope: Envelope) {
        if let Some(ingest) = self.ingest.lock().expect("ingest lock").as_ref() {
            ingest.enqueue(envelope);
        }
    }

    /// Stop the ingest stream, draining buffered events (with its internal
    /// deadline). No-op when ingest is not configured.
    pub async fn stop_ingest(&self) {
        let sender = self.ingest.lock().expect("ingest lock").clone();
        if let Some(sender) = sender {
            sender.stop().await;
        }
    }
}

/// Borrow a str as `&RawValue` for zero-copy embedding in serde structures.
pub fn raw_json(s: &str) -> Result<&RawValue, serde_json::Error> {
    serde_json::from_str::<&RawValue>(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_envelope_embeds_raw_json() {
        let envelope = notification_envelope(
            r#"{"jsonrpc":"2.0","method":"session/update","params":{"x":1}}"#,
        );
        let parsed: serde_json::Value = serde_json::from_str(&envelope).unwrap();
        assert_eq!(parsed["type"], "notification");
        assert_eq!(parsed["notification"]["method"], "session/update");
        assert_eq!(parsed["notification"]["params"]["x"], 1);
        // Timestamp must look like new Date().toISOString().
        let ts = parsed["timestamp"].as_str().unwrap();
        assert!(ts.ends_with('Z') && ts.len() == 24, "bad timestamp: {ts}");
    }

    #[tokio::test]
    async fn buffers_until_sse_attaches_then_replays_in_order() {
        let bus = EventBus::new(None);
        bus.broadcast_notification_line(r#"{"jsonrpc":"2.0","method":"a"}"#);
        bus.broadcast_notification_line(r#"{"jsonrpc":"2.0","method":"b"}"#);

        let (tx, mut rx) = mpsc::unbounded_channel();
        bus.attach_sse(tx);

        let first = rx.recv().await.unwrap();
        let second = rx.recv().await.unwrap();
        assert!(first.starts_with("data: ") && first.ends_with("\n\n"));
        assert!(first.contains(r#""method":"a""#));
        assert!(second.contains(r#""method":"b""#));

        bus.broadcast_notification_line(r#"{"jsonrpc":"2.0","method":"c"}"#);
        let third = rx.recv().await.unwrap();
        assert!(third.contains(r#""method":"c""#));
    }

    #[tokio::test]
    async fn dropped_sse_rebuffers_events() {
        let bus = EventBus::new(None);
        let (tx, rx) = mpsc::unbounded_channel();
        bus.attach_sse(tx);
        drop(rx);

        bus.broadcast_notification_line(r#"{"jsonrpc":"2.0","method":"after-drop"}"#);
        assert!(!bus.has_sse());

        let (tx2, mut rx2) = mpsc::unbounded_channel();
        bus.attach_sse(tx2);
        let replayed = rx2.recv().await.unwrap();
        assert!(replayed.contains("after-drop"));
    }
}
