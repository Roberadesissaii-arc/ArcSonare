//! One enumerated plan, one question.
//!
//! `approval.rs` covers the *shape* of a request: steps at or below an approved
//! risk, inside an approved scope. That deliberately excludes anything
//! destructive, because a risk-and-scope grant is too loose to authorise
//! deletion — "reversible things in Pictures" is a description, and a deletion
//! needs an enumeration.
//!
//! So deletions kept asking once each: "delete these three test tasks" became
//! three prompts. The missing piece is not a wider grant, it is a *narrower*
//! one — a plan that names exactly which three, and authorises those three and
//! nothing else, exactly once each.
//!
//! The distinction that makes this safe:
//!
//!   grant  →  "anything reversible in this folder, for this request"
//!   plan   →  "these three rows, by id, once each, and nothing else"
//!
//! A plan can therefore hold destructive steps where a grant cannot, because
//! the user saw the list.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::approval::RiskLevel;

/// A plan is approved and then executed immediately; it is not a standing
/// permission. Shorter than the request grant for that reason.
const PLAN_TTL: Duration = Duration::from_secs(120);

/// One thing the user was shown and agreed to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub capability_id: String,
    /// Canonical form of the arguments, so a substituted argument is a
    /// different step rather than the same one with new contents.
    pub arguments: serde_json::Value,
    /// What this acts on — a task id, a path, a window. The identity the user
    /// actually saw in the confirmation list.
    pub resource: String,
    /// What the user was shown for this row. Kept so the result can name it.
    pub label: String,
    pub risk: RiskLevel,
}

/// Where a step got to. A plan that half-succeeded must say so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StepStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepState {
    pub ordinal: usize,
    pub capability_id: String,
    pub resource: String,
    pub label: String,
    pub risk: RiskLevel,
    pub status: StepStatus,
    /// Category only — never the provider's or filesystem's raw message, which
    /// can quote paths and contents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlanStatus {
    /// Described, waiting for the user.
    Proposed,
    Approved,
    Executing,
    /// Every step reached a terminal state. Not necessarily every one succeeded.
    Finished,
    Rejected,
    Expired,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRequest {
    pub request_id: String,
    pub account_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub origin: String,
    /// The sentence the user is shown above the list.
    pub summary: String,
    pub steps: Vec<PlanStep>,
}

/// What a caller must present to run one step of an approved plan.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepClaim {
    pub plan_id: String,
    pub account_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub origin: String,
    pub capability_id: String,
    pub arguments: serde_json::Value,
    pub resource: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlanError {
    UnknownPlan,
    Expired,
    NotApproved,
    DifferentAccount,
    DifferentConversation,
    DifferentOrigin,
    /// The step is not in the list the user saw.
    StepNotInPlan,
    /// The step is in the list, but its arguments are not the ones approved.
    ArgumentsChanged,
    /// Already run. A redelivered call must not delete a second time.
    AlreadyExecuted,
}

impl PlanError {
    pub fn message(self) -> &'static str {
        match self {
            Self::UnknownPlan => "That plan is not on record.",
            Self::Expired => "That plan expired before it ran.",
            Self::NotApproved => "That plan has not been approved.",
            Self::DifferentAccount => "That plan belongs to a different account.",
            Self::DifferentConversation => "That plan belongs to a different conversation.",
            Self::DifferentOrigin => "That plan was approved somewhere else.",
            Self::StepNotInPlan => "That is not one of the items you approved.",
            Self::ArgumentsChanged => "That item changed after you approved it.",
            Self::AlreadyExecuted => "That item has already been done.",
        }
    }
}

/// Canonical JSON, so key order and whitespace cannot make two identical
/// argument sets look different. Same rule as `confirmation::fingerprint`.
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

struct StoredStep {
    step: PlanStep,
    fingerprint: String,
    status: StepStatus,
    error: Option<String>,
}

struct Plan {
    request_id: String,
    account_id: String,
    conversation_id: Option<String>,
    origin: String,
    summary: String,
    steps: Vec<StoredStep>,
    max_risk: RiskLevel,
    status: PlanStatus,
    created: Instant,
}

#[derive(Default)]
pub struct PlanStore(Mutex<HashMap<String, Plan>>);

fn new_plan_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    format!(
        "plan-{}-{:x}",
        chrono::Local::now().timestamp_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// What the user is asked, and what a caller needs to run it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedPlan {
    pub plan_id: String,
    pub request_id: String,
    pub summary: String,
    pub max_risk: RiskLevel,
    pub steps: Vec<StepState>,
    pub expires_at: String,
}

/// How a plan finished. Reported per step, because "three deleted" and "two
/// deleted, one gone already" are different sentences.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanOutcome {
    pub plan_id: String,
    pub status: PlanStatus,
    pub succeeded: usize,
    pub failed: usize,
    pub pending: usize,
    pub steps: Vec<StepState>,
}

impl PlanStore {
    /// Describe a batch. Nothing runs until `approve`.
    pub fn propose(&self, request: PlanRequest) -> Option<ProposedPlan> {
        if request.steps.is_empty() {
            return None;
        }
        let plan_id = new_plan_id();
        let max_risk = request
            .steps
            .iter()
            .map(|s| s.risk)
            .max()
            .unwrap_or(RiskLevel::ReadOnly);

        let steps: Vec<StoredStep> = request
            .steps
            .into_iter()
            .map(|step| StoredStep {
                fingerprint: format!("{}::{}", step.capability_id, canonical(&step.arguments)),
                step,
                status: StepStatus::Pending,
                error: None,
            })
            .collect();

        let expires_at = chrono::Local::now() + chrono::Duration::seconds(PLAN_TTL.as_secs() as i64);
        let plan = Plan {
            request_id: request.request_id.clone(),
            account_id: request.account_id,
            conversation_id: request.conversation_id,
            origin: request.origin,
            summary: request.summary.clone(),
            steps,
            max_risk,
            status: PlanStatus::Proposed,
            created: Instant::now(),
        };
        let view = ProposedPlan {
            plan_id: plan_id.clone(),
            request_id: request.request_id,
            summary: request.summary,
            max_risk,
            steps: describe(&plan),
            expires_at: expires_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        };

        let mut map = self.0.lock().unwrap();
        map.retain(|_, p| p.created.elapsed() < PLAN_TTL);
        map.insert(plan_id, plan);
        Some(view)
    }

    /// The user said yes to the list they were shown.
    pub fn approve(&self, plan_id: &str) -> Result<(), PlanError> {
        let mut map = self.0.lock().unwrap();
        let plan = map.get_mut(plan_id).ok_or(PlanError::UnknownPlan)?;
        if plan.created.elapsed() >= PLAN_TTL {
            plan.status = PlanStatus::Expired;
            return Err(PlanError::Expired);
        }
        plan.status = PlanStatus::Approved;
        Ok(())
    }

    pub fn reject(&self, plan_id: &str) {
        if let Some(plan) = self.0.lock().unwrap().get_mut(plan_id) {
            plan.status = PlanStatus::Rejected;
        }
    }

    /// Claim one step for execution.
    ///
    /// Marks it `Running` and returns its ordinal. A second claim for the same
    /// step fails with `AlreadyExecuted` — that is the duplicate-execution
    /// guard, and it is here rather than at the call site because the call site
    /// is what gets redelivered.
    pub fn claim(&self, claim: &StepClaim) -> Result<usize, PlanError> {
        let mut map = self.0.lock().unwrap();
        let plan = map.get_mut(&claim.plan_id).ok_or(PlanError::UnknownPlan)?;

        if plan.created.elapsed() >= PLAN_TTL {
            plan.status = PlanStatus::Expired;
            return Err(PlanError::Expired);
        }
        if !matches!(plan.status, PlanStatus::Approved | PlanStatus::Executing) {
            return Err(PlanError::NotApproved);
        }
        if plan.account_id != claim.account_id {
            return Err(PlanError::DifferentAccount);
        }
        if let (Some(a), Some(b)) = (
            plan.conversation_id.as_deref(),
            claim.conversation_id.as_deref(),
        ) {
            if a != b {
                return Err(PlanError::DifferentConversation);
            }
        }
        if plan.origin != claim.origin {
            return Err(PlanError::DifferentOrigin);
        }

        let fingerprint = format!(
            "{}::{}",
            claim.capability_id,
            canonical(&claim.arguments)
        );

        // Resource first: a claim naming a resource nobody approved is a fourth
        // task, and must not be reported as merely "arguments changed".
        let Some(index) = plan.steps.iter().position(|s| {
            s.step.capability_id == claim.capability_id && s.step.resource == claim.resource
        }) else {
            return Err(PlanError::StepNotInPlan);
        };
        if plan.steps[index].fingerprint != fingerprint {
            return Err(PlanError::ArgumentsChanged);
        }
        if plan.steps[index].status != StepStatus::Pending {
            return Err(PlanError::AlreadyExecuted);
        }

        plan.steps[index].status = StepStatus::Running;
        plan.status = PlanStatus::Executing;
        Ok(index)
    }

    /// Record what actually happened to a claimed step.
    pub fn settle(&self, plan_id: &str, ordinal: usize, succeeded: bool, error: Option<String>) {
        let mut map = self.0.lock().unwrap();
        let Some(plan) = map.get_mut(plan_id) else {
            return;
        };
        if let Some(step) = plan.steps.get_mut(ordinal) {
            step.status = if succeeded {
                StepStatus::Succeeded
            } else {
                StepStatus::Failed
            };
            step.error = error;
        }
        if plan
            .steps
            .iter()
            .all(|s| matches!(s.status, StepStatus::Succeeded | StepStatus::Failed))
        {
            plan.status = PlanStatus::Finished;
        }
    }

    pub fn outcome(&self, plan_id: &str) -> Option<PlanOutcome> {
        let map = self.0.lock().unwrap();
        let plan = map.get(plan_id)?;
        let steps = describe(plan);
        Some(PlanOutcome {
            plan_id: plan_id.to_string(),
            status: plan.status,
            succeeded: steps
                .iter()
                .filter(|s| s.status == StepStatus::Succeeded)
                .count(),
            failed: steps.iter().filter(|s| s.status == StepStatus::Failed).count(),
            pending: steps
                .iter()
                .filter(|s| matches!(s.status, StepStatus::Pending | StepStatus::Running))
                .count(),
            steps,
        })
    }

    /// Backdate a plan so expiry can be tested without waiting out the TTL.
    #[cfg(test)]
    fn age_for_test(&self, plan_id: &str, by: Duration) {
        if let Some(plan) = self.0.lock().unwrap().get_mut(plan_id) {
            plan.created = Instant::now()
                .checked_sub(by)
                .expect("test clock stays positive");
        }
    }

    pub fn revoke_request(&self, request_id: &str) {
        self.0.lock().unwrap().retain(|_, p| p.request_id != request_id);
    }

    pub fn revoke_conversation(&self, conversation_id: &str) {
        self.0
            .lock()
            .unwrap()
            .retain(|_, p| p.conversation_id.as_deref() != Some(conversation_id));
    }

    pub fn active(&self) -> usize {
        let mut map = self.0.lock().unwrap();
        map.retain(|_, p| p.created.elapsed() < PLAN_TTL);
        map.len()
    }
}

fn describe(plan: &Plan) -> Vec<StepState> {
    plan.steps
        .iter()
        .enumerate()
        .map(|(ordinal, s)| StepState {
            ordinal,
            capability_id: s.step.capability_id.clone(),
            resource: s.step.resource.clone(),
            label: s.step.label.clone(),
            risk: s.step.risk,
            status: s.status,
            error: s.error.clone(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimDecision {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordinal: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<PlanError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[tauri::command]
pub fn plan_propose(store: State<PlanStore>, request: PlanRequest) -> Option<ProposedPlan> {
    store.propose(request)
}

#[tauri::command]
pub fn plan_approve(store: State<PlanStore>, plan_id: String) -> ClaimDecision {
    match store.approve(&plan_id) {
        Ok(()) => ClaimDecision {
            allowed: true,
            ordinal: None,
            error: None,
            reason: None,
        },
        Err(e) => ClaimDecision {
            allowed: false,
            ordinal: None,
            error: Some(e),
            reason: Some(e.message().to_string()),
        },
    }
}

#[tauri::command]
pub fn plan_reject(store: State<PlanStore>, plan_id: String) {
    store.reject(&plan_id);
}

#[tauri::command]
pub fn plan_claim_step(store: State<PlanStore>, claim: StepClaim) -> ClaimDecision {
    match store.claim(&claim) {
        Ok(ordinal) => ClaimDecision {
            allowed: true,
            ordinal: Some(ordinal),
            error: None,
            reason: None,
        },
        Err(e) => ClaimDecision {
            allowed: false,
            ordinal: None,
            error: Some(e),
            reason: Some(e.message().to_string()),
        },
    }
}

#[tauri::command]
pub fn plan_settle_step(
    store: State<PlanStore>,
    plan_id: String,
    ordinal: usize,
    succeeded: bool,
    error: Option<String>,
) {
    store.settle(&plan_id, ordinal, succeeded, error);
}

#[tauri::command]
pub fn plan_outcome(store: State<PlanStore>, plan_id: String) -> Option<PlanOutcome> {
    store.outcome(&plan_id)
}

#[tauri::command]
pub fn plan_revoke_conversation(store: State<PlanStore>, conversation_id: String) {
    store.revoke_conversation(&conversation_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn delete_step(task_id: &str, label: &str) -> PlanStep {
        PlanStep {
            capability_id: "tasks.delete".into(),
            arguments: json!({ "task_id": task_id }),
            resource: task_id.into(),
            label: label.into(),
            risk: RiskLevel::Destructive,
        }
    }

    fn three_task_plan() -> PlanRequest {
        PlanRequest {
            request_id: "req-1".into(),
            account_id: "acct-A".into(),
            conversation_id: Some("conv-1".into()),
            origin: "chat".into(),
            summary: "Delete these three test tasks?".into(),
            steps: vec![
                delete_step("task-a", "Task A"),
                delete_step("task-b", "Task B"),
                delete_step("task-c", "Task C"),
            ],
        }
    }

    fn claim_for(plan_id: &str, task_id: &str) -> StepClaim {
        StepClaim {
            plan_id: plan_id.into(),
            account_id: "acct-A".into(),
            conversation_id: Some("conv-1".into()),
            origin: "chat".into(),
            capability_id: "tasks.delete".into(),
            arguments: json!({ "task_id": task_id }),
            resource: task_id.into(),
        }
    }

    /// The requirement, stated as a test: three named deletions, one question.
    #[test]
    fn three_deletions_are_one_approval() {
        let store = PlanStore::default();
        let proposed = store.propose(three_task_plan()).expect("plan");

        assert_eq!(proposed.steps.len(), 3);
        assert_eq!(proposed.max_risk, RiskLevel::Destructive);
        // The user sees each row named, which is what makes one question honest.
        let labels: Vec<&str> = proposed.steps.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, ["Task A", "Task B", "Task C"]);

        // One approval.
        store.approve(&proposed.plan_id).unwrap();

        // Three executions, no further approval anywhere.
        for task in ["task-a", "task-b", "task-c"] {
            let ordinal = store
                .claim(&claim_for(&proposed.plan_id, task))
                .unwrap_or_else(|e| panic!("{task} should be covered: {:?}", e));
            store.settle(&proposed.plan_id, ordinal, true, None);
        }

        let outcome = store.outcome(&proposed.plan_id).unwrap();
        assert_eq!(outcome.succeeded, 3);
        assert_eq!(outcome.failed, 0);
        assert_eq!(outcome.status, PlanStatus::Finished);
    }

    #[test]
    fn a_replayed_claim_does_not_delete_twice() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();

        let ordinal = store.claim(&claim_for(&plan.plan_id, "task-a")).unwrap();
        store.settle(&plan.plan_id, ordinal, true, None);

        assert_eq!(
            store.claim(&claim_for(&plan.plan_id, "task-a")),
            Err(PlanError::AlreadyExecuted),
        );
        // Even a redelivery that arrives before the first one settled.
        let plan2 = store.propose(three_task_plan()).unwrap();
        store.approve(&plan2.plan_id).unwrap();
        store.claim(&claim_for(&plan2.plan_id, "task-b")).unwrap();
        assert_eq!(
            store.claim(&claim_for(&plan2.plan_id, "task-b")),
            Err(PlanError::AlreadyExecuted),
        );
    }

    #[test]
    fn a_fourth_task_is_not_covered() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();
        assert_eq!(
            store.claim(&claim_for(&plan.plan_id, "task-d")),
            Err(PlanError::StepNotInPlan),
        );
    }

    /// Same task, different arguments: the id the user saw with a `permanent`
    /// flag bolted on is not the step they approved.
    #[test]
    fn arguments_cannot_be_substituted() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();

        let mut swapped = claim_for(&plan.plan_id, "task-a");
        swapped.arguments = json!({ "task_id": "task-a", "permanent": true });
        assert_eq!(store.claim(&swapped), Err(PlanError::ArgumentsChanged));
    }

    #[test]
    fn a_plan_does_not_cross_account_conversation_or_origin() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();

        let mut other = claim_for(&plan.plan_id, "task-a");
        other.account_id = "acct-B".into();
        assert_eq!(store.claim(&other), Err(PlanError::DifferentAccount));

        let mut conv = claim_for(&plan.plan_id, "task-a");
        conv.conversation_id = Some("conv-2".into());
        assert_eq!(store.claim(&conv), Err(PlanError::DifferentConversation));

        let mut origin = claim_for(&plan.plan_id, "task-a");
        origin.origin = "voice".into();
        assert_eq!(store.claim(&origin), Err(PlanError::DifferentOrigin));
    }

    #[test]
    fn an_unapproved_plan_executes_nothing() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        assert_eq!(
            store.claim(&claim_for(&plan.plan_id, "task-a")),
            Err(PlanError::NotApproved),
        );
    }

    #[test]
    fn a_rejected_plan_executes_nothing() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();
        store.reject(&plan.plan_id);
        assert_eq!(
            store.claim(&claim_for(&plan.plan_id, "task-a")),
            Err(PlanError::NotApproved),
        );
    }

    #[test]
    fn an_unknown_plan_is_refused() {
        let store = PlanStore::default();
        assert_eq!(
            store.claim(&claim_for("plan-does-not-exist", "task-a")),
            Err(PlanError::UnknownPlan),
        );
        assert_eq!(store.approve("plan-does-not-exist"), Err(PlanError::UnknownPlan));
    }

    /// One item failing must not be reported as all three succeeding, and must
    /// not stop the other two from being attempted.
    #[test]
    fn one_failure_does_not_become_three_successes() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();

        let a = store.claim(&claim_for(&plan.plan_id, "task-a")).unwrap();
        store.settle(&plan.plan_id, a, true, None);
        let b = store.claim(&claim_for(&plan.plan_id, "task-b")).unwrap();
        store.settle(&plan.plan_id, b, false, Some("persistence-failed".into()));
        let c = store.claim(&claim_for(&plan.plan_id, "task-c")).unwrap();
        store.settle(&plan.plan_id, c, true, None);

        let outcome = store.outcome(&plan.plan_id).unwrap();
        assert_eq!(outcome.succeeded, 2);
        assert_eq!(outcome.failed, 1);
        assert_eq!(outcome.status, PlanStatus::Finished);

        let failed: Vec<&StepState> = outcome
            .steps
            .iter()
            .filter(|s| s.status == StepStatus::Failed)
            .collect();
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].label, "Task B");
        assert_eq!(failed[0].error.as_deref(), Some("persistence-failed"));
    }

    /// A plan abandoned midway reports what is still outstanding rather than
    /// rounding it to done.
    #[test]
    fn an_unfinished_plan_reports_what_is_outstanding() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();
        let a = store.claim(&claim_for(&plan.plan_id, "task-a")).unwrap();
        store.settle(&plan.plan_id, a, true, None);

        let outcome = store.outcome(&plan.plan_id).unwrap();
        assert_eq!(outcome.succeeded, 1);
        assert_eq!(outcome.pending, 2);
        assert_ne!(outcome.status, PlanStatus::Finished);
    }

    #[test]
    fn closing_the_conversation_drops_its_plans() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();
        store.revoke_conversation("conv-1");
        assert_eq!(store.active(), 0);
        assert_eq!(
            store.claim(&claim_for(&plan.plan_id, "task-a")),
            Err(PlanError::UnknownPlan),
        );
    }

    /// Approval does not keep. A plan the user agreed to and then walked away
    /// from must not still be able to delete three things minutes later.
    #[test]
    fn an_expired_plan_executes_nothing() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.approve(&plan.plan_id).unwrap();
        store.age_for_test(&plan.plan_id, PLAN_TTL + Duration::from_secs(1));

        assert_eq!(
            store.claim(&claim_for(&plan.plan_id, "task-a")),
            Err(PlanError::Expired),
        );
        assert_eq!(store.outcome(&plan.plan_id).unwrap().status, PlanStatus::Expired);
    }

    /// And an expired plan cannot be approved into life either.
    #[test]
    fn an_expired_plan_cannot_be_approved() {
        let store = PlanStore::default();
        let plan = store.propose(three_task_plan()).unwrap();
        store.age_for_test(&plan.plan_id, PLAN_TTL + Duration::from_secs(1));
        assert_eq!(store.approve(&plan.plan_id), Err(PlanError::Expired));
    }

    #[test]
    fn an_empty_plan_is_not_a_plan() {
        let store = PlanStore::default();
        let mut request = three_task_plan();
        request.steps.clear();
        assert!(store.propose(request).is_none());
    }
}
