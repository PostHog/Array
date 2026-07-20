use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

/// Direction of a raw line crossing the peer, from the host's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Agent → client (a line read from the agent process).
    Incoming,
    /// Client → agent (a line written to the agent process).
    Outgoing,
}

/// JSON-RPC error object (also used for transport-level failures).
#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[error("RPC error {code}: {message}")]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    pub fn method_not_found(method: &str) -> Self {
        Self::new(-32601, format!("Method not found: {method}"))
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(-32603, message)
    }

    /// The peer's read loop ended (agent exited or closed stdio) while a
    /// request was in flight.
    pub fn connection_closed() -> Self {
        Self::new(-32000, "ACP connection closed")
    }
}

/// Handler for traffic initiated by the agent.
#[async_trait::async_trait]
pub trait IncomingHandler: Send + Sync + 'static {
    /// Handle an agent → client request; the returned value (or error) is
    /// sent back as the JSON-RPC response.
    async fn handle_request(&self, method: &str, params: Value) -> Result<Value, RpcError>;

    /// Handle an agent → client notification.
    async fn handle_notification(&self, method: &str, params: Value);
}

/// Callback invoked with every raw NDJSON line crossing the peer, in both
/// directions. The line is guaranteed to be a single JSON document without a
/// trailing newline. `parsed` is the already-parsed value for incoming lines
/// (parse-once: hosts must not re-parse); `None` for outgoing lines, whose
/// producers already hold the structured form.
pub type LineTap = Arc<dyn Fn(Direction, &str, Option<&Value>) + Send + Sync>;

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>>;

enum Outgoing {
    Line(String),
    /// Ends the writer task, dropping the write half (closing the agent's
    /// stdin) even while reader-side clones of the peer are still alive.
    Shutdown,
}

/// Client-side ACP peer over ndjson streams.
#[derive(Clone)]
pub struct Peer {
    outgoing: mpsc::UnboundedSender<Outgoing>,
    pending: PendingMap,
    next_id: Arc<AtomicU64>,
    tap: Option<LineTap>,
}

/// Join handles for the peer's IO tasks; abort or await on shutdown.
pub struct PeerHandle {
    pub reader: JoinHandle<()>,
    pub writer: JoinHandle<()>,
}

impl Peer {
    /// Spawn a peer over the given read/write halves (typically the agent
    /// subprocess's stdout/stdin).
    pub fn spawn<R, W>(
        read: R,
        write: W,
        handler: Arc<dyn IncomingHandler>,
        tap: Option<LineTap>,
    ) -> (Self, PeerHandle)
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Outgoing>();
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));

        let peer = Peer {
            outgoing: out_tx,
            pending: Arc::clone(&pending),
            next_id: Arc::new(AtomicU64::new(0)),
            tap: tap.clone(),
        };

        let writer = tokio::spawn(async move {
            let mut write = write;
            while let Some(outgoing) = out_rx.recv().await {
                let line = match outgoing {
                    Outgoing::Line(line) => line,
                    Outgoing::Shutdown => break,
                };
                if write.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if write.write_all(b"\n").await.is_err() {
                    break;
                }
                if write.flush().await.is_err() {
                    break;
                }
            }
        });

        let read_peer = peer.clone();
        let reader = tokio::spawn(async move {
            let mut lines = BufReader::new(read).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        read_peer.dispatch_incoming(&line, &handler);
                    }
                    Ok(None) => break,
                    Err(err) => {
                        tracing::debug!(error = %err, "ACP read failed; closing peer");
                        break;
                    }
                }
            }
            // Fail all in-flight requests so callers don't hang on a dead agent.
            let mut pending = pending.lock().expect("pending lock poisoned");
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err(RpcError::connection_closed()));
            }
        });

        (peer, PeerHandle { reader, writer })
    }

    fn dispatch_incoming(&self, line: &str, handler: &Arc<dyn IncomingHandler>) {
        let parsed: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => {
                tracing::debug!("Skipping non-JSON ACP line");
                return;
            }
        };

        if let Some(tap) = &self.tap {
            tap(Direction::Incoming, line, Some(&parsed));
        }

        let id = parsed.get("id");
        let method = parsed.get("method").and_then(Value::as_str);

        match (id, method) {
            // Response to one of our requests.
            (Some(id), None) => {
                let Some(id) = id.as_u64() else {
                    return;
                };
                let tx = {
                    let mut pending = self.pending.lock().expect("pending lock poisoned");
                    pending.remove(&id)
                };
                let Some(tx) = tx else {
                    tracing::debug!(id, "Response for unknown request id");
                    return;
                };
                let result = if let Some(error) = parsed.get("error") {
                    Err(RpcError {
                        code: error.get("code").and_then(Value::as_i64).unwrap_or(-32603),
                        message: error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("Unknown error")
                            .to_string(),
                        data: error.get("data").cloned(),
                    })
                } else {
                    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(result);
            }
            // Agent → client request: compute the response concurrently so a
            // slow handler (e.g. a relayed permission prompt) doesn't block
            // the stream of session updates behind it.
            (Some(id), Some(method)) => {
                let id = id.clone();
                let method = method.to_string();
                let params = parsed.get("params").cloned().unwrap_or(Value::Null);
                let peer = self.clone();
                let handler = Arc::clone(handler);
                tokio::spawn(async move {
                    let response = match handler.handle_request(&method, params).await {
                        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                        Err(err) => json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": err.code, "message": err.message, "data": err.data },
                        }),
                    };
                    peer.send_raw(response);
                });
            }
            // Agent → client notification.
            (None, Some(method)) => {
                let method = method.to_string();
                let params = parsed.get("params").cloned().unwrap_or(Value::Null);
                let handler = Arc::clone(handler);
                tokio::spawn(async move {
                    handler.handle_notification(&method, params).await;
                });
            }
            (None, None) => {
                tracing::debug!("ACP line is neither request, response, nor notification");
            }
        }
    }

    fn send_raw(&self, message: Value) {
        let line = message.to_string();
        if let Some(tap) = &self.tap {
            tap(Direction::Outgoing, &line, Some(&message));
        }
        // A send failure means the writer task is gone (agent exited); the
        // in-flight request map is drained by the reader task in that case.
        let _ = self.outgoing.send(Outgoing::Line(line));
    }

    /// Close the write half (the agent's stdin), signalling shutdown. Reads
    /// continue until the agent exits.
    pub fn close(&self) {
        let _ = self.outgoing.send(Outgoing::Shutdown);
    }

    /// Send a request and await its response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .expect("pending lock poisoned")
            .insert(id, tx);

        self.send_raw(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }));

        match rx.await {
            Ok(result) => result,
            Err(_) => Err(RpcError::connection_closed()),
        }
    }

    /// Send a fire-and-forget notification.
    pub fn notify(&self, method: &str, params: Value) {
        self.send_raw(json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use tokio::io::AsyncWriteExt;

    struct EchoHandler {
        notifications: Arc<Mutex<Vec<(String, Value)>>>,
    }

    #[async_trait::async_trait]
    impl IncomingHandler for EchoHandler {
        async fn handle_request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
            if method == "boom" {
                return Err(RpcError::new(-32050, "boom failed"));
            }
            Ok(json!({ "echo": method, "params": params }))
        }

        async fn handle_notification(&self, method: &str, params: Value) {
            self.notifications
                .lock()
                .unwrap()
                .push((method.to_string(), params));
        }
    }

    type AgentSide = (
        Peer,
        tokio::io::WriteHalf<tokio::io::DuplexStream>,
        tokio::io::BufReader<tokio::io::ReadHalf<tokio::io::DuplexStream>>,
        Arc<Mutex<Vec<(String, Value)>>>,
    );

    /// Wire two duplex pipes so the test acts as the "agent" on the far end.
    fn setup(tap: Option<LineTap>) -> AgentSide {
        let (client_side, agent_side) = tokio::io::duplex(64 * 1024);
        let (client_read, client_write) = tokio::io::split(client_side);
        let (agent_read, agent_write) = tokio::io::split(agent_side);
        let notifications = Arc::new(Mutex::new(Vec::new()));
        let handler = Arc::new(EchoHandler {
            notifications: Arc::clone(&notifications),
        });
        let (peer, _handle) = Peer::spawn(client_read, client_write, handler, tap);
        (peer, agent_write, BufReader::new(agent_read), notifications)
    }

    async fn read_json(
        reader: &mut tokio::io::BufReader<tokio::io::ReadHalf<tokio::io::DuplexStream>>,
    ) -> Value {
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        serde_json::from_str(&line).unwrap()
    }

    #[tokio::test]
    async fn request_response_roundtrip() {
        let (peer, mut agent_write, mut agent_read, _) = setup(None);

        let request_task = tokio::spawn(async move {
            peer.request("initialize", json!({"protocolVersion": 1}))
                .await
        });

        let request = read_json(&mut agent_read).await;
        assert_eq!(request["method"], "initialize");
        assert_eq!(request["params"]["protocolVersion"], 1);
        let id = request["id"].clone();

        let response = json!({ "jsonrpc": "2.0", "id": id, "result": { "protocolVersion": 1 } });
        agent_write
            .write_all(format!("{response}\n").as_bytes())
            .await
            .unwrap();

        let result = request_task.await.unwrap().unwrap();
        assert_eq!(result["protocolVersion"], 1);
    }

    #[tokio::test]
    async fn error_response_surfaces_code_and_message() {
        let (peer, mut agent_write, mut agent_read, _) = setup(None);

        let request_task =
            tokio::spawn(async move { peer.request("session/prompt", json!({})).await });
        let request = read_json(&mut agent_read).await;
        let response = json!({
            "jsonrpc": "2.0",
            "id": request["id"],
            "error": { "code": -32000, "message": "prompt failed" },
        });
        agent_write
            .write_all(format!("{response}\n").as_bytes())
            .await
            .unwrap();

        let err = request_task.await.unwrap().unwrap_err();
        assert_eq!(err.code, -32000);
        assert_eq!(err.message, "prompt failed");
    }

    #[tokio::test]
    async fn incoming_request_is_answered() {
        let (_peer, mut agent_write, mut agent_read, _) = setup(None);

        let request = json!({ "jsonrpc": "2.0", "id": 7, "method": "session/request_permission", "params": { "x": 1 } });
        agent_write
            .write_all(format!("{request}\n").as_bytes())
            .await
            .unwrap();

        let response = read_json(&mut agent_read).await;
        assert_eq!(response["id"], 7);
        assert_eq!(response["result"]["echo"], "session/request_permission");
        assert_eq!(response["result"]["params"]["x"], 1);
    }

    #[tokio::test]
    async fn incoming_request_error_is_answered_with_error() {
        let (_peer, mut agent_write, mut agent_read, _) = setup(None);

        let request = json!({ "jsonrpc": "2.0", "id": 9, "method": "boom", "params": {} });
        agent_write
            .write_all(format!("{request}\n").as_bytes())
            .await
            .unwrap();

        let response = read_json(&mut agent_read).await;
        assert_eq!(response["id"], 9);
        assert_eq!(response["error"]["code"], -32050);
        assert_eq!(response["error"]["message"], "boom failed");
    }

    #[tokio::test]
    async fn notifications_reach_handler() {
        let (_peer, mut agent_write, _agent_read, notifications) = setup(None);

        let notification =
            json!({ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "s" } });
        agent_write
            .write_all(format!("{notification}\n").as_bytes())
            .await
            .unwrap();

        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if !notifications.lock().unwrap().is_empty() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("notification not dispatched");

        let seen = notifications.lock().unwrap();
        assert_eq!(seen[0].0, "session/update");
        assert_eq!(seen[0].1["sessionId"], "s");
    }

    #[tokio::test]
    async fn tap_sees_both_directions() {
        let incoming = Arc::new(AtomicUsize::new(0));
        let outgoing = Arc::new(AtomicUsize::new(0));
        let (in_count, out_count) = (Arc::clone(&incoming), Arc::clone(&outgoing));
        let tap: LineTap = Arc::new(move |direction, line, parsed| {
            assert!(serde_json::from_str::<Value>(line).is_ok());
            match direction {
                Direction::Incoming => {
                    assert!(parsed.is_some());
                    in_count.fetch_add(1, Ordering::SeqCst);
                }
                Direction::Outgoing => {
                    out_count.fetch_add(1, Ordering::SeqCst);
                }
            }
        });

        let (peer, mut agent_write, mut agent_read, _) = setup(Some(tap));
        peer.notify("session/cancel", json!({"sessionId": "s"}));
        let sent = read_json(&mut agent_read).await;
        assert_eq!(sent["method"], "session/cancel");

        let notification = json!({ "jsonrpc": "2.0", "method": "session/update", "params": {} });
        agent_write
            .write_all(format!("{notification}\n").as_bytes())
            .await
            .unwrap();

        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while incoming.load(Ordering::SeqCst) == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("tap did not observe incoming line");
        assert_eq!(outgoing.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn agent_exit_fails_inflight_requests() {
        let (peer, agent_write, _agent_read, _) = setup(None);

        let request_task =
            tokio::spawn(async move { peer.request("session/prompt", json!({})).await });
        // Give the request time to be registered, then hang up.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        drop(agent_write);
        drop(_agent_read);

        let err = request_task.await.unwrap().unwrap_err();
        assert_eq!(err.message, "ACP connection closed");
    }
}
