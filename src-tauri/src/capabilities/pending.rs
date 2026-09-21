//! One pending action, one authority, one answer.
//!
//! `confirmation.rs` holds a token and `approval.rs` holds a request grant, but
//! neither knows that a question is currently *on screen*. That knowledge lived
//! in `pendingByRun`, a module-level `Map` in the capability engine — and the
//! main window and `sonare-overlay` are separate WebView2 heaps, so there were
//! always two of those maps and they never agreed. A confirmation raised while
//! the overlay was listening could not be answered from chat, and a question
//! already being asked in one window was asked again in the other.
//!
//! What this adds is the missing middle: the *state of the ask*. A pending
//! action is created once, is visible to every window, is approved once, and is
//! consumed exactly once. The two existing stores keep their jobs — this one
//! decides whether to ask at all.
//!
//! The rule that makes it safe rather than merely quiet:
//!
//!   suppression is keyed on the plan fingerprint, not on the capability id.
//!
//! Two deletes of two different files are two questions. The same delete of the
//! same file arriving twice — because the model re-issued it, because the user
//! said yes twice, because a call was redelivered — is one.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::approval::RiskLevel;

/// Long enough for the user to read a sentence and answer it out loud, short
/// enough that an abandoned question authorises nothing later.
const PENDING_TTL: Duration = Duration::from_secs(180);

/// How risky an action is, in the vocabulary the permission policy speaks.
///
/// Wider than `approval::RiskLevel` at both ends on purpose. `Routine` names
/// the things a user request is *itself* authorisation for — opening an app,
/// reading a file, downloading to Downloads — which `ReadOnly` did not, because
/// they do change something. `Elevated` names the UAC boundary, which nothing
/// modelled before and which is the only place an installer should stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActionRisk {
    /// The request is the authorisation. Open, focus, read, search, navigate,
    /// screenshot, download to Downloads, edit a file the user pointed at.
    Routine,
    /// Changes something, and the change can be undone or is plainly visible.
    Reversible,
    /// Leaves the machine, touches credentials, or accepts terms. Asks once,
    /// covering the whole described plan.
    Sensitive,
    /// Cannot be taken back. Asks per action, every time.
    Destructive,
    /// Crosses the administrator boundary. Asks immediately before, never
    /// earlier, and never in advance of the step that actually needs it.
    Elevated,
}

impl ActionRisk {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "routine" | "read-only" | "readonly" => Some(Self::Routine),
            "reversible" => Some(Self::Reversible),
            "sensitive" | "moderate" => Some(Self::Sensitive),
            "destructive" => Some(Self::Destructive),
            "elevated" => Some(Self::Elevated),
            _ => None,
        }
    }

    /// Whether this level ever asks.
    ///
    /// Routine and Reversible do not: the user asked for the thing, and the
    /// whole point of the permission rework is that "yes, do what I just said"
    /// is not a question worth spending a sentence on.
    pub fn requires_approval(self) -> bool {
        self >= Self::Sensitive
    }

    /// Whether one approval may cover several steps.
    ///
    /// Sensitive plans may: the user saw the plan. Destructive and Elevated may
    /// not — those are confirmed at the boundary, per action, however clearly
    /// the plan described them.
    pub fn coverable_by_plan(self) -> bool {
        self <= Self::Sensitive
    }

    /// Translate the grant store's vocabulary into this one.
    pub fn from_risk_level(level: RiskLevel) -> Self {
        match level {
            RiskLevel::ReadOnly => Self::Routine,
            RiskLevel::Reversible => Self::Reversible,
            RiskLevel::Moderate => Self::Sensitive,
            RiskLevel::Destructive => Self::Destructive,
        }
    }
}

/// How far one answer reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalScope {
    /// This capability, these arguments, once.
    ExactAction,
    /// Every step of the plan the user was shown, at or below its risk.
    ActionPlan,
    /// Everything this request does until it finishes.
    CurrentTask,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PendingActionState {
    AwaitingApproval,
    Approved,
    Executing,
    Completed,
    Failed,
    Cancelled,
}

impl PendingActionState {
    /// Whether the action is finished with, one way or another.
    fn terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAction {
    pub action_id: String,
    pub run_id: String,
    pub conversation_id: String,
    /// Canonical identity of *what was approved*: capability plus arguments.
    /// Stored separately from the live arguments so a resumed call that adds a
    /// field the user never saw is a different action, not the same one.
    pub plan_fingerprint: String,
    pub risk: ActionRisk,
    pub scope: ApprovalScope,
    pub state: PendingActionState,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    /// The sentence the user is shown. Kept here so both windows render the
    /// same question rather than each composing their own.
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// Set once the action has begun something the world can see. A pending
    /// action past this point is never retried automatically, because "it
    /// failed" and "it may have half-happened" are not the same thing.
    #[serde(default)]
    pub side_effect_possible: bool,
}

impl PendingAction {
    fn expired(&self, now: u64) -> bool {
        now >= self.expires_at_ms
    }
}

/// Why a resolution or a claim was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PendingError {
    Unknown,
    Expired,
    NotApproved,
    AlreadyResolved,
    AlreadyExecuting,
    AlreadyExecuted,
    ActionChanged,
    DifferentRun,
    DifferentConversation,
    SideEffectPossible,
}

impl PendingError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Unknown => "That request is not on record.",
            Self::Expired => "That request expired before it was answered.",
            Self::NotApproved => "That has not been approved yet.",
            Self::AlreadyResolved => "That was already answered.",
            Self::AlreadyExecuting => "That is already running.",
            Self::AlreadyExecuted => "That has already been done.",
            Self::ActionChanged => "That changed after you approved it.",
            Self::DifferentRun => "That approval belongs to a different request.",
            Self::DifferentConversation => {
                "That approval belongs to a different conversation."
            }
            Self::SideEffectPossible => {
                "That may already have taken effect, so I won't run it again."
            }
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Canonical JSON, so key order and whitespace cannot make two identical
/// argument sets look like different actions. Same rule as
/// `confirmation::fingerprint` and `approval_plan::canonical`.
fn canonical(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .into_iter()
                .map(|k| format!("{}:{}", k, canonical(&map[k])))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        serde_json::Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(canonical).collect();
            format!("[{}]", inner.join(","))
        }
        other => other.to_string(),
    }
}

/// What identifies an action for suppression and for approval matching.
pub fn plan_fingerprint(capability_id: &str, args: &serde_json::Value) -> String {
    format!("{capability_id}::{}", canonical(args))
}

/// What a caller presents to open a question.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub run_id: String,
    pub conversation_id: String,
    pub capability_id: String,
    pub arguments: serde_json::Value,
    pub risk: ActionRisk,
    pub scope: ApprovalScope,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
}

/// What a caller presents to run an approved action.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRequest {
    pub action_id: String,
    pub run_id: String,
    pub capability_id: String,
    pub arguments: serde_json::Value,
}

/// The result of asking to open a question.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOutcome {
    pub action: PendingAction,
    /// `false` when an identical question was already open or already answered
    /// — the caller must not ask a second time, and should wait on or reuse the
    /// action it got back.
    pub created: bool,
    /// Already approved when this returned, so the caller may proceed straight
    /// to `claim` without showing anything.
    pub already_approved: bool,
}

#[derive(Default)]
pub struct PendingActionStore(Mutex<HashMap<String, PendingAction>>);

fn new_action_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!(
        "pending-{}-{:x}",
        now_ms(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

impl PendingActionStore {
    fn sweep(map: &mut HashMap<String, PendingAction>, now: u64) {
        map.retain(|_, a| {
            // Terminal actions are kept for the TTL so a redelivered claim gets
            // "already done" rather than "never heard of it" — those are
            // different sentences, and the second one invites a retry.
            !a.expired(now)
        });
    }

    /// Open a question, or return the one already open for this exact action.
    ///
    /// This is the whole anti-loop rule in one place. A second identical ask,
    /// from either window, from the model re-issuing its call, or from the
    /// engine re-entering after a resume, finds the existing action instead of
    /// creating a rival one.
    pub fn open(&self, request: OpenRequest) -> OpenOutcome {
        let now = now_ms();
        let fingerprint = plan_fingerprint(&request.capability_id, &request.arguments);
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);

        // An identical, still-live action in the same run and conversation is
        // the same question. Matching on run and conversation as well as the
        // fingerprint keeps "delete report.pdf" asked once per request rather
        // than once ever.
        if let Some(existing) = map.values().find(|a| {
            a.plan_fingerprint == fingerprint
                && a.run_id == request.run_id
                && a.conversation_id == request.conversation_id
                && !a.state.terminal()
        }) {
            let already_approved = matches!(
                existing.state,
                PendingActionState::Approved | PendingActionState::Executing
            );
            return OpenOutcome {
                action: existing.clone(),
                created: false,
                already_approved,
            };
        }

        let action = PendingAction {
            action_id: new_action_id(),
            run_id: request.run_id,
            conversation_id: request.conversation_id,
            plan_fingerprint: fingerprint,
            risk: request.risk,
            scope: request.scope,
            state: PendingActionState::AwaitingApproval,
            created_at_ms: now,
            expires_at_ms: now + PENDING_TTL.as_millis() as u64,
            title: request.title,
            description: request.description,
            side_effect_possible: false,
        };
        map.insert(action.action_id.clone(), action.clone());
        OpenOutcome {
            action,
            created: true,
            already_approved: false,
        }
    }

    /// Record the user's yes.
    ///
    /// Idempotent on purpose: a user who says "yes" twice, or says it in the
    /// overlay while chat also sends one, must not produce two approvals and
    /// therefore two executions. The second call sees `Approved` and returns
    /// the same action unchanged.
    pub fn approve(&self, action_id: &str) -> Result<PendingAction, PendingError> {
        let now = now_ms();
        let mut map = self.0.lock().unwrap();
        let action = map.get_mut(action_id).ok_or(PendingError::Unknown)?;
        if action.expired(now) {
            return Err(PendingError::Expired);
        }
        match action.state {
            PendingActionState::AwaitingApproval => {
                action.state = PendingActionState::Approved;
                Ok(action.clone())
            }
            // Already yes. Saying yes again changes nothing and runs nothing.
            PendingActionState::Approved => Ok(action.clone()),
            PendingActionState::Executing => Err(PendingError::AlreadyExecuting),
            PendingActionState::Completed | PendingActionState::Failed => {
                Err(PendingError::AlreadyExecuted)
            }
            PendingActionState::Cancelled => Err(PendingError::AlreadyResolved),
        }
    }

    pub fn cancel(&self, action_id: &str) -> Result<PendingAction, PendingError> {
        let mut map = self.0.lock().unwrap();
        let action = map.get_mut(action_id).ok_or(PendingError::Unknown)?;
        if action.state.terminal() {
            return Err(PendingError::AlreadyResolved);
        }
        action.state = PendingActionState::Cancelled;
        Ok(action.clone())
    }

    /// Take the approved action for execution, exactly once.
    ///
    /// The arguments are re-fingerprinted here rather than trusted, so a
    /// resumed call carrying a field the user never saw is refused. That check
    /// is the reason approval is stored apart from the live arguments.
    pub fn claim(&self, claim: &ClaimRequest) -> Result<PendingAction, PendingError> {
        let now = now_ms();
        let mut map = self.0.lock().unwrap();
        let action = map.get_mut(&claim.action_id).ok_or(PendingError::Unknown)?;
        if action.expired(now) {
            return Err(PendingError::Expired);
        }
        if action.run_id != claim.run_id {
            return Err(PendingError::DifferentRun);
        }
        if action.plan_fingerprint != plan_fingerprint(&claim.capability_id, &claim.arguments) {
            return Err(PendingError::ActionChanged);
        }
        match action.state {
            PendingActionState::AwaitingApproval => Err(PendingError::NotApproved),
            PendingActionState::Approved => {
                action.state = PendingActionState::Executing;
                Ok(action.clone())
            }
            PendingActionState::Executing => Err(PendingError::AlreadyExecuting),
            PendingActionState::Completed => Err(PendingError::AlreadyExecuted),
            // A failed step may be retried only when nothing can have happened.
            // Past the side-effect line, a failure is an unknown, not a no.
            PendingActionState::Failed if !action.side_effect_possible => {
                action.state = PendingActionState::Executing;
                Ok(action.clone())
            }
            PendingActionState::Failed => Err(PendingError::SideEffectPossible),
            PendingActionState::Cancelled => Err(PendingError::AlreadyResolved),
        }
    }

    /// Mark that the action has begun something the world can observe.
    ///
    /// Called by an executor at the moment it stops being safe to retry — after
    /// the click is sent, after the request leaves, after the write starts.
    pub fn mark_side_effect(&self, action_id: &str) {
        if let Some(action) = self.0.lock().unwrap().get_mut(action_id) {
            action.side_effect_possible = true;
        }
    }

    pub fn settle(&self, action_id: &str, succeeded: bool) -> Option<PendingAction> {
        let mut map = self.0.lock().unwrap();
        let action = map.get_mut(action_id)?;
        action.state = if succeeded {
            PendingActionState::Completed
        } else {
            PendingActionState::Failed
        };
        Some(action.clone())
    }

    /// The question currently on screen for a conversation, if any.
    ///
    /// This is what makes the overlay and the main window agree: both ask Rust
    /// what is pending rather than consulting their own heap.
    pub fn awaiting(&self, conversation_id: &str) -> Option<PendingAction> {
        let now = now_ms();
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);
        map.values()
            .filter(|a| {
                a.conversation_id == conversation_id
                    && a.state == PendingActionState::AwaitingApproval
            })
            .min_by_key(|a| a.created_at_ms)
            .cloned()
    }

    pub fn get(&self, action_id: &str) -> Option<PendingAction> {
        self.0.lock().unwrap().get(action_id).cloned()
    }

    /// Drop everything for a conversation: it closed, or the voice session
    /// ended. An unanswered question must not outlive the thing it was about.
    pub fn revoke_conversation(&self, conversation_id: &str) {
        self.0
            .lock()
            .unwrap()
            .retain(|_, a| a.conversation_id != conversation_id);
    }

    pub fn revoke_run(&self, run_id: &str) {
        self.0.lock().unwrap().retain(|_, a| a.run_id != run_id);
    }

    pub fn active(&self) -> usize {
        let now = now_ms();
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);
        map.values().filter(|a| !a.state.terminal()).count()
    }

    #[cfg(test)]
    fn expire_for_test(&self, action_id: &str) {
        if let Some(a) = self.0.lock().unwrap().get_mut(action_id) {
            a.expires_at_ms = now_ms().saturating_sub(1);
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
//
// Every one of these is reachable from both webviews, which is the point: the
// overlay and the main window resolve the same pending action through Rust
// instead of each keeping a map the other cannot see.
// ---------------------------------------------------------------------------

use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDecision {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<PendingAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<PendingError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

fn decide(result: Result<PendingAction, PendingError>) -> PendingDecision {
    match result {
        Ok(action) => PendingDecision {
            allowed: true,
            action: Some(action),
            error: None,
            reason: None,
        },
        Err(e) => PendingDecision {
            allowed: false,
            action: None,
            error: Some(e),
            reason: Some(e.message().to_string()),
        },
    }
}

#[tauri::command]
pub fn pending_open(store: State<PendingActionStore>, request: OpenRequest) -> OpenOutcome {
    store.open(request)
}

#[tauri::command]
pub fn pending_approve(store: State<PendingActionStore>, action_id: String) -> PendingDecision {
    decide(store.approve(&action_id))
}

#[tauri::command]
pub fn pending_cancel(store: State<PendingActionStore>, action_id: String) -> PendingDecision {
    decide(store.cancel(&action_id))
}

#[tauri::command]
pub fn pending_claim(store: State<PendingActionStore>, claim: ClaimRequest) -> PendingDecision {
    decide(store.claim(&claim))
}

#[tauri::command]
pub fn pending_mark_side_effect(store: State<PendingActionStore>, action_id: String) {
    store.mark_side_effect(&action_id);
}

#[tauri::command]
pub fn pending_settle(
    store: State<PendingActionStore>,
    action_id: String,
    succeeded: bool,
) -> Option<PendingAction> {
    store.settle(&action_id, succeeded)
}

#[tauri::command]
pub fn pending_awaiting(
    store: State<PendingActionStore>,
    conversation_id: String,
) -> Option<PendingAction> {
    store.awaiting(&conversation_id)
}

#[tauri::command]
pub fn pending_get(store: State<PendingActionStore>, action_id: String) -> Option<PendingAction> {
    store.get(&action_id)
}

#[tauri::command]
pub fn pending_revoke_conversation(
    store: State<PendingActionStore>,
    conversation_id: String,
) {
    store.revoke_conversation(&conversation_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn delete_request() -> OpenRequest {
        OpenRequest {
            run_id: "run-1".into(),
            conversation_id: "conv-1".into(),
            capability_id: "filesystem.delete".into(),
            arguments: json!({ "paths": ["C:\\a\\report.pdf"] }),
            risk: ActionRisk::Destructive,
            scope: ApprovalScope::ExactAction,
            title: "Move report.pdf to the Recycle Bin?".into(),
            description: String::new(),
        }
    }

    fn claim_for(action_id: &str) -> ClaimRequest {
        ClaimRequest {
            action_id: action_id.into(),
            run_id: "run-1".into(),
            capability_id: "filesystem.delete".into(),
            arguments: json!({ "paths": ["C:\\a\\report.pdf"] }),
        }
    }

    /// The reported failure, as a test: asking the same thing twice is one
    /// question, not two.
    #[test]
    fn an_identical_second_ask_reuses_the_open_question() {
        let store = PendingActionStore::default();
        let first = store.open(delete_request());
        assert!(first.created);

        let second = store.open(delete_request());
        assert!(!second.created, "the same action must not ask again");
        assert_eq!(second.action.action_id, first.action.action_id);
        assert_eq!(store.active(), 1);
    }

    /// The cross-window case stated directly: the overlay opens the question,
    /// chat answers it, and the same action is the one that runs.
    #[test]
    fn the_overlay_and_the_main_window_resolve_one_action() {
        let store = PendingActionStore::default();
        // Overlay asks.
        let opened = store.open(delete_request());
        // Main window looks for what is pending and finds the same thing.
        let seen = store.awaiting("conv-1").expect("both windows see one question");
        assert_eq!(seen.action_id, opened.action.action_id);
        // Main window approves it.
        store.approve(&seen.action_id).unwrap();
        // Overlay claims it.
        let claimed = store.claim(&claim_for(&opened.action.action_id)).unwrap();
        assert_eq!(claimed.state, PendingActionState::Executing);
    }

    #[test]
    fn saying_yes_twice_does_not_execute_twice() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        let id = &opened.action.action_id;

        store.approve(id).unwrap();
        // A second yes is accepted and changes nothing.
        store.approve(id).unwrap();

        assert!(store.claim(&claim_for(id)).is_ok());
        assert_eq!(
            store.claim(&claim_for(id)),
            Err(PendingError::AlreadyExecuting),
            "the approved action is consumed exactly once",
        );
    }

    #[test]
    fn nothing_runs_before_the_user_answers() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        assert_eq!(
            store.claim(&claim_for(&opened.action.action_id)),
            Err(PendingError::NotApproved),
        );
    }

    /// The approved decision is stored apart from the live arguments, so a
    /// resumed call carrying something the user never saw is a different action.
    #[test]
    fn arguments_cannot_be_substituted_after_approval() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        store.approve(&opened.action.action_id).unwrap();

        let mut swapped = claim_for(&opened.action.action_id);
        swapped.arguments = json!({ "paths": ["C:\\a\\report.pdf"], "mode": "permanent" });
        assert_eq!(store.claim(&swapped), Err(PendingError::ActionChanged));
    }

    #[test]
    fn an_approval_does_not_cross_runs() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        store.approve(&opened.action.action_id).unwrap();

        let mut other = claim_for(&opened.action.action_id);
        other.run_id = "run-2".into();
        assert_eq!(store.claim(&other), Err(PendingError::DifferentRun));
    }

    /// A step that may already have half-happened is not retried on its own.
    #[test]
    fn a_possible_side_effect_blocks_automatic_retry() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        let id = &opened.action.action_id;
        store.approve(id).unwrap();
        store.claim(&claim_for(id)).unwrap();
        store.mark_side_effect(id);
        store.settle(id, false);

        assert_eq!(
            store.claim(&claim_for(id)),
            Err(PendingError::SideEffectPossible),
        );
    }

    /// A failure that happened before anything could have escaped may retry.
    #[test]
    fn a_clean_failure_may_retry() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        let id = &opened.action.action_id;
        store.approve(id).unwrap();
        store.claim(&claim_for(id)).unwrap();
        store.settle(id, false);

        assert!(
            store.claim(&claim_for(id)).is_ok(),
            "nothing happened yet, so trying again is safe",
        );
    }

    #[test]
    fn a_completed_action_never_runs_again() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        let id = &opened.action.action_id;
        store.approve(id).unwrap();
        store.claim(&claim_for(id)).unwrap();
        store.settle(id, true);
        assert_eq!(store.claim(&claim_for(id)), Err(PendingError::AlreadyExecuted));
    }

    /// Two different files are two questions — suppression is by fingerprint,
    /// not by capability.
    #[test]
    fn a_different_target_is_a_different_question() {
        let store = PendingActionStore::default();
        store.open(delete_request());
        let mut other = delete_request();
        other.arguments = json!({ "paths": ["C:\\a\\notes.txt"] });
        assert!(store.open(other).created);
        assert_eq!(store.active(), 2);
    }

    #[test]
    fn an_expired_question_authorises_nothing() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        let id = &opened.action.action_id;
        store.approve(id).unwrap();
        store.expire_for_test(id);
        assert_eq!(store.claim(&claim_for(id)), Err(PendingError::Expired));
    }

    #[test]
    fn cancelling_runs_nothing() {
        let store = PendingActionStore::default();
        let opened = store.open(delete_request());
        let id = &opened.action.action_id;
        store.cancel(id).unwrap();
        assert_eq!(store.approve(id), Err(PendingError::AlreadyResolved));
        assert_eq!(store.claim(&claim_for(id)), Err(PendingError::AlreadyResolved));
    }

    #[test]
    fn closing_the_conversation_drops_its_questions() {
        let store = PendingActionStore::default();
        store.open(delete_request());
        store.revoke_conversation("conv-1");
        assert_eq!(store.active(), 0);
        assert!(store.awaiting("conv-1").is_none());
    }

    /// The policy, stated where it can be tested: routine and reversible work
    /// never reaches a question at all.
    #[test]
    fn routine_and_reversible_do_not_ask() {
        assert!(!ActionRisk::Routine.requires_approval());
        assert!(!ActionRisk::Reversible.requires_approval());
        assert!(ActionRisk::Sensitive.requires_approval());
        assert!(ActionRisk::Destructive.requires_approval());
        assert!(ActionRisk::Elevated.requires_approval());
    }

    /// One plan approval covers sensitive steps and nothing beyond them.
    #[test]
    fn a_plan_cannot_pre_approve_deletion_or_elevation() {
        assert!(ActionRisk::Routine.coverable_by_plan());
        assert!(ActionRisk::Sensitive.coverable_by_plan());
        assert!(!ActionRisk::Destructive.coverable_by_plan());
        assert!(
            !ActionRisk::Elevated.coverable_by_plan(),
            "UAC is asked at the boundary, never in advance",
        );
    }

    #[test]
    fn fingerprints_ignore_key_order() {
        let a = json!({ "x": 1, "y": [1, 2] });
        let b: serde_json::Value =
            serde_json::from_str(r#"{"y":[1,2],"x":1}"#).unwrap();
        assert_eq!(plan_fingerprint("c", &a), plan_fingerprint("c", &b));
    }
}
