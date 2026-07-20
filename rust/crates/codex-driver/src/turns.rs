//! The turn state machine for one codex thread. Port of `turn-controller.ts`:
//! a turn is async — `prompt()` starts it and awaits completion, which
//! `turn/completed` (or interrupt/error) resolves. Owns the in-flight
//! `turnId`, the pending completion waiters, and the ids of interrupted turns
//! whose late completions must be dropped.
//!
//! Unlike the TS promise (shareable), a oneshot has a single consumer — so a
//! steer that joins the running turn registers an additional waiter and the
//! finalize path resolves them all.

use std::collections::HashSet;

use tokio::sync::oneshot;

pub type TurnResult = Result<String, String>;

#[derive(Default)]
pub struct TurnController {
    turn_id: Option<String>,
    waiters: Vec<oneshot::Sender<TurnResult>>,
    generation: u64,
    cancelled: HashSet<String>,
}

impl TurnController {
    /// Begin a turn: registers the prompt's completion waiter.
    pub fn begin(&mut self) -> (oneshot::Receiver<TurnResult>, u64) {
        self.generation += 1;
        let (tx, rx) = oneshot::channel();
        self.waiters.push(tx);
        (rx, self.generation)
    }

    /// The live turn id (steer precondition / interrupt target).
    pub fn active_turn_id(&self) -> Option<&str> {
        self.turn_id.as_deref()
    }

    pub fn is_pending(&self) -> bool {
        !self.waiters.is_empty()
    }

    /// A turn is running AND has a turnId — i.e. it can be steered.
    pub fn is_running(&self) -> bool {
        !self.waiters.is_empty() && self.turn_id.is_some()
    }

    /// Capture the turn id from turn/started (only while a turn is pending).
    pub fn on_started(&mut self, id: Option<&str>) {
        if !self.waiters.is_empty() {
            if let Some(id) = id {
                self.turn_id = Some(id.to_string());
            }
        }
    }

    /// codex rotates the turn id on steer; adopt it or later interrupts/steers
    /// target a dead turn.
    pub fn on_steered(&mut self, id: Option<&str>) {
        if let Some(id) = id {
            self.turn_id = Some(id.to_string());
        }
    }

    /// Register an additional completion waiter (the steer path joins the
    /// running turn's completion).
    pub fn join(&mut self) -> oneshot::Receiver<TurnResult> {
        let (tx, rx) = oneshot::channel();
        self.waiters.push(tx);
        rx
    }

    /// Atomically claim the pending waiters (clears the slot + turnId), or an
    /// empty vec when already claimed — makes finalize idempotent.
    pub fn claim(&mut self) -> Vec<oneshot::Sender<TurnResult>> {
        self.turn_id = None;
        std::mem::take(&mut self.waiters)
    }

    /// Mark the live turn interrupted (so its late completion is dropped)
    /// and return its id.
    pub fn mark_interrupted(&mut self) -> Option<String> {
        let id = self.turn_id.clone()?;
        self.cancelled.insert(id.clone());
        Some(id)
    }

    /// True (once) if this completion is for an interrupted turn to drop.
    pub fn should_drop_completion(&mut self, id: Option<&str>) -> bool {
        match id {
            Some(id) => self.cancelled.remove(id),
            None => false,
        }
    }

    /// Clear the pending slot after prompt() returns (covers a turn/start
    /// throw). Guarded by the caller's turn token so an older prompt's
    /// cleanup can't wipe a newer turn.
    pub fn finish_prompt(&mut self, turn: u64) {
        if turn != self.generation {
            return;
        }
        self.waiters.clear();
    }

    /// Reject the in-flight turn (the server exited before it completed).
    pub fn fail(&mut self, error: &str) {
        self.turn_id = None;
        for waiter in std::mem::take(&mut self.waiters) {
            let _ = waiter.send(Err(error.to_string()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn steer_waiters_all_resolve_on_claim() {
        let mut turns = TurnController::default();
        let (rx1, _gen) = turns.begin();
        turns.on_started(Some("t1"));
        assert!(turns.is_running());
        let rx2 = turns.join();
        for waiter in turns.claim() {
            let _ = waiter.send(Ok("end_turn".to_string()));
        }
        assert_eq!(rx1.await.unwrap().unwrap(), "end_turn");
        assert_eq!(rx2.await.unwrap().unwrap(), "end_turn");
        assert!(!turns.is_pending());
        assert!(turns.claim().is_empty());
    }

    #[tokio::test]
    async fn interrupted_turns_drop_their_late_completion_once() {
        let mut turns = TurnController::default();
        let (_rx, _gen) = turns.begin();
        turns.on_started(Some("t1"));
        assert_eq!(turns.mark_interrupted().as_deref(), Some("t1"));
        assert!(turns.should_drop_completion(Some("t1")));
        assert!(!turns.should_drop_completion(Some("t1")));
        assert!(!turns.should_drop_completion(None));
    }
}
