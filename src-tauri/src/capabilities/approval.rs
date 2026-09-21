//! Request-level approval, so one question covers one request.
//!
//! `confirmation.rs` issues `ExactAction` tokens: one capability, one argument
//! fingerprint, one run, consumed once. That is the right shape for "delete this
//! folder", and the wrong shape for everything a single spoken request actually
//! expands into. "Open this image, highlight the person, and circle their face"
//! becomes several tool steps; each step asked its own question, and any step
//! that re-resolved its target changed the fingerprint and asked again. Users
//! reported five to ten prompts for one sentence.
//!
//! A grant covers a *request*: the user said yes to a described plan, and every
//! step inside it that stays within what was described proceeds. The grant is
//! owned here, in Rust, because the voice overlay and the backend are separate
//! processes-worth of state and neither can be the authority for the other.
//!
//! What it deliberately does not do is widen with use. A grant cannot be
//! stretched by a step that raises the risk, changes the target, introduces an
//! external recipient, or arrives after it expired — those re-ask, which is the
//! whole reason the narrow scope existed.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Long enough for a multi-step plan including a slow model turn, short enough
/// that an abandoned request cannot authorise anything later.
const GRANT_TTL: Duration = Duration::from_secs(180);

/// How much a step may do without asking.
///
/// Ordered: a grant covers a step whose risk is at or below the approved level.
/// Deriving the ordering rather than listing pairs means a new level cannot be
/// silently omitted from a comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RiskLevel {
    /// Looks at something. Screenshot, control list, connector status.
    ReadOnly,
    /// Changes something that can be undone or that undoes itself: a temporary
    /// overlay, opening an app, focusing a window, navigating within one.
    Reversible,
    /// A real change the user would want described first: editing their file,
    /// changing an application's settings, submitting a form.
    Moderate,
    /// Cannot be taken back, or leaves the machine: delete, send, publish, buy,
    /// log out, transfer.
    Destructive,
}

impl RiskLevel {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "read-only" | "readonly" => Some(Self::ReadOnly),
            "reversible" => Some(Self::Reversible),
            "moderate" | "sensitive" => Some(Self::Moderate),
            "destructive" => Some(Self::Destructive),
            _ => None,
        }
    }

    /// Whether an approval at this level may ever be granted up front.
    ///
    /// Destructive is excluded on purpose: it is confirmed per action, never by
    /// a standing grant, however clearly the plan described it. A batch of
    /// destructive steps is handled by describing them all in one confirmation,
    /// not by issuing a grant that authorises more of them later.
    pub fn grantable(self) -> bool {
        self < Self::Destructive
    }
}

/// What the user approved.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantRequest {
    pub request_id: String,
    #[serde(default)]
    pub plan_id: Option<String>,
    pub account_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// chat | voice | direct-ui | background.
    pub origin: String,
    pub approved_risk: RiskLevel,
    /// Capability ids the described plan covers. Empty means "any capability at
    /// or below the approved risk", which is only accepted for read-only.
    #[serde(default)]
    pub approved_capabilities: Vec<String>,
    /// Targets the plan named — a path, a window, a task id, a person label.
    /// Empty means the plan named no specific resource.
    #[serde(default)]
    pub approved_resource_scope: Vec<String>,
}

/// What a step is asking to do, checked against a grant.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRequest {
    pub request_id: String,
    pub account_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub origin: String,
    pub capability_id: String,
    pub risk: RiskLevel,
    #[serde(default)]
    pub resource: Option<String>,
    /// Set when the step would send, post, or otherwise hand something to a
    /// party outside this machine. Always re-asks.
    #[serde(default)]
    pub external_recipient: bool,
}

/// Why a step could not reuse the grant. Each is a different sentence to the
/// user, which is the point — "you already approved this" and "that is a
/// different thing" are not the same answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GrantMiss {
    NoGrant,
    Expired,
    DifferentAccount,
    DifferentConversation,
    DifferentOrigin,
    RiskIncreased,
    CapabilityOutsidePlan,
    ResourceOutsideScope,
    ExternalRecipient,
}

impl GrantMiss {
    pub fn message(self) -> &'static str {
        match self {
            Self::NoGrant => "Nothing has been approved for this request yet.",
            Self::Expired => "That approval has expired.",
            Self::DifferentAccount => "That approval belongs to a different account.",
            Self::DifferentConversation => {
                "That approval belongs to a different conversation."
            }
            Self::DifferentOrigin => "That approval was given somewhere else.",
            Self::RiskIncreased => "This step does more than what was approved.",
            Self::CapabilityOutsidePlan => "This step is not part of what was approved.",
            Self::ResourceOutsideScope => "This step targets something else.",
            Self::ExternalRecipient => "This step would send something out, so it needs its own yes.",
        }
    }
}

struct Grant {
    request: GrantRequest,
    issued: Instant,
    /// How many steps reused it. Reporting only — a grant is not spent by use,
    /// because a plan with six steps is still one approval.
    uses: u32,
}

#[derive(Default)]
pub struct ApprovalStore(Mutex<HashMap<String, Grant>>);

fn normalise_resource(raw: &str) -> String {
    raw.trim().trim_end_matches(['/', '\\']).to_lowercase().replace('/', "\\")
}

impl ApprovalStore {
    /// Record that the user approved a described plan.
    ///
    /// Returns `None` for a destructive approval: those are per action, and
    /// accepting one here would quietly turn "yes, delete that one" into a
    /// licence for the rest of the request.
    pub fn grant(&self, request: GrantRequest) -> Option<String> {
        if !request.approved_risk.grantable() {
            return None;
        }
        // A blanket grant is only safe when nothing it covers can change
        // anything. Above read-only the plan has to name its capabilities.
        if request.approved_capabilities.is_empty()
            && request.approved_risk > RiskLevel::ReadOnly
        {
            return None;
        }
        let id = request.request_id.clone();
        let mut map = self.0.lock().unwrap();
        map.retain(|_, g| g.issued.elapsed() < GRANT_TTL);
        map.insert(
            id.clone(),
            Grant {
                request,
                issued: Instant::now(),
                uses: 0,
            },
        );
        Some(id)
    }

    /// May this step run without asking again?
    pub fn covers(&self, step: &StepRequest) -> Result<(), GrantMiss> {
        // Checked before the grant is even looked up: no approval reaches
        // outside the machine, so a grant cannot be the reason this proceeds.
        if step.external_recipient {
            return Err(GrantMiss::ExternalRecipient);
        }
        if step.risk >= RiskLevel::Destructive {
            return Err(GrantMiss::RiskIncreased);
        }

        let mut map = self.0.lock().unwrap();
        let Some(grant) = map.get_mut(&step.request_id) else {
            return Err(GrantMiss::NoGrant);
        };
        if grant.issued.elapsed() >= GRANT_TTL {
            map.remove(&step.request_id);
            return Err(GrantMiss::Expired);
        }
        let approved = &grant.request;
        if approved.account_id != step.account_id {
            return Err(GrantMiss::DifferentAccount);
        }
        // Only compared when both sides name one. A grant taken before a
        // conversation existed is not thereby scoped to "no conversation".
        if let (Some(a), Some(b)) = (
            approved.conversation_id.as_deref(),
            step.conversation_id.as_deref(),
        ) {
            if a != b {
                return Err(GrantMiss::DifferentConversation);
            }
        }
        if approved.origin != step.origin {
            return Err(GrantMiss::DifferentOrigin);
        }
        if step.risk > approved.approved_risk {
            return Err(GrantMiss::RiskIncreased);
        }
        if !approved.approved_capabilities.is_empty()
            && !approved
                .approved_capabilities
                .iter()
                .any(|c| c == &step.capability_id)
        {
            return Err(GrantMiss::CapabilityOutsidePlan);
        }
        if !approved.approved_resource_scope.is_empty() {
            let within = match step.resource.as_deref() {
                // A step that names no resource is inside any scope: it is the
                // re-resolution and inspection steps that have none, and those
                // are exactly what must not re-ask.
                None => true,
                Some(r) => {
                    let r = normalise_resource(r);
                    approved
                        .approved_resource_scope
                        .iter()
                        .any(|s| {
                            let s = normalise_resource(s);
                            r == s || r.starts_with(&format!("{s}\\"))
                        })
                }
            };
            if !within {
                return Err(GrantMiss::ResourceOutsideScope);
            }
        }
        grant.uses += 1;
        Ok(())
    }

    /// Drop a grant: the request finished, the conversation closed, or the voice
    /// session ended. Called on all three, so an approval cannot outlive what it
    /// was given for.
    pub fn revoke(&self, request_id: &str) {
        self.0.lock().unwrap().remove(request_id);
    }

    /// Drop every grant for a conversation or session.
    pub fn revoke_conversation(&self, conversation_id: &str) {
        self.0
            .lock()
            .unwrap()
            .retain(|_, g| g.request.conversation_id.as_deref() != Some(conversation_id));
    }

    pub fn revoke_all(&self) {
        self.0.lock().unwrap().clear();
    }

    /// How many steps a grant covered. For the permission-count tests and the
    /// developer trace; not part of the decision.
    pub fn uses(&self, request_id: &str) -> u32 {
        self.0
            .lock()
            .unwrap()
            .get(request_id)
            .map(|g| g.uses)
            .unwrap_or(0)
    }

    pub fn active(&self) -> usize {
        let mut map = self.0.lock().unwrap();
        map.retain(|_, g| g.issued.elapsed() < GRANT_TTL);
        map.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(risk: RiskLevel, caps: &[&str], resources: &[&str]) -> GrantRequest {
        GrantRequest {
            request_id: "req-1".into(),
            plan_id: Some("plan-1".into()),
            account_id: "acct-A".into(),
            conversation_id: Some("conv-1".into()),
            origin: "voice".into(),
            approved_risk: risk,
            approved_capabilities: caps.iter().map(|c| (*c).into()).collect(),
            approved_resource_scope: resources.iter().map(|r| (*r).into()).collect(),
        }
    }

    fn step(capability: &str, risk: RiskLevel) -> StepRequest {
        StepRequest {
            request_id: "req-1".into(),
            account_id: "acct-A".into(),
            conversation_id: Some("conv-1".into()),
            origin: "voice".into(),
            capability_id: capability.into(),
            risk,
            resource: None,
            external_recipient: false,
        }
    }

    /// The reported failure, as a test: one sentence, four steps, one approval.
    #[test]
    fn one_approval_covers_every_step_of_the_plan() {
        let store = ApprovalStore::default();
        store
            .grant(plan(
                RiskLevel::Reversible,
                &[
                    "applications.open",
                    "screen.capture",
                    "screen.highlight_target",
                    "screen.annotate",
                ],
                &["C:\\Users\\rober\\Pictures\\group.png"],
            ))
            .expect("a reversible plan is grantable");

        for capability in [
            "applications.open",
            "screen.capture",
            "screen.highlight_target",
            "screen.annotate",
        ] {
            assert_eq!(
                store.covers(&step(capability, RiskLevel::Reversible)),
                Ok(()),
                "{capability} should not have asked again"
            );
        }
        assert_eq!(store.uses("req-1"), 4, "the grant is reused, not consumed");
    }

    /// Re-resolving a target is the same request looking again, not a new one.
    #[test]
    fn a_target_re_resolution_does_not_re_ask() {
        let store = ApprovalStore::default();
        store
            .grant(plan(RiskLevel::Reversible, &["screen.highlight_target"], &[]))
            .unwrap();
        for _ in 0..3 {
            assert_eq!(
                store.covers(&step("screen.highlight_target", RiskLevel::ReadOnly)),
                Ok(())
            );
        }
    }

    #[test]
    fn a_destructive_step_always_asks() {
        let store = ApprovalStore::default();
        store
            .grant(plan(RiskLevel::Moderate, &["filesystem.delete"], &[]))
            .unwrap();
        assert_eq!(
            store.covers(&step("filesystem.delete", RiskLevel::Destructive)),
            Err(GrantMiss::RiskIncreased),
        );
    }

    #[test]
    fn destructive_approval_is_never_granted_up_front() {
        let store = ApprovalStore::default();
        assert!(
            store
                .grant(plan(RiskLevel::Destructive, &["filesystem.delete"], &[]))
                .is_none(),
            "a standing grant must not authorise deletions"
        );
    }

    #[test]
    fn anything_that_leaves_the_machine_asks() {
        let store = ApprovalStore::default();
        store
            .grant(plan(RiskLevel::Moderate, &["email.send"], &[]))
            .unwrap();
        let mut send = step("email.send", RiskLevel::Moderate);
        send.external_recipient = true;
        assert_eq!(store.covers(&send), Err(GrantMiss::ExternalRecipient));
    }

    #[test]
    fn a_widened_scope_asks_again() {
        let store = ApprovalStore::default();
        store
            .grant(plan(
                RiskLevel::Reversible,
                &["screen.highlight_target"],
                &["C:\\Users\\rober\\Pictures"],
            ))
            .unwrap();

        let mut inside = step("screen.highlight_target", RiskLevel::Reversible);
        inside.resource = Some("C:\\Users\\rober\\Pictures\\group.png".into());
        assert_eq!(store.covers(&inside), Ok(()));

        let mut outside = step("screen.highlight_target", RiskLevel::Reversible);
        outside.resource = Some("C:\\Users\\rober\\Documents\\taxes.pdf".into());
        assert_eq!(store.covers(&outside), Err(GrantMiss::ResourceOutsideScope));

        let elsewhere = step("filesystem.modify", RiskLevel::Reversible);
        assert_eq!(store.covers(&elsewhere), Err(GrantMiss::CapabilityOutsidePlan));
    }

    /// A near-miss that is easy to get wrong: "Pictures2" starts with "Pictures"
    /// as a string but is not inside it.
    #[test]
    fn scope_matching_is_by_path_segment_not_by_prefix() {
        let store = ApprovalStore::default();
        store
            .grant(plan(
                RiskLevel::Reversible,
                &["filesystem.list_directory"],
                &["C:\\Users\\rober\\Pictures"],
            ))
            .unwrap();
        let mut sneaky = step("filesystem.list_directory", RiskLevel::Reversible);
        sneaky.resource = Some("C:\\Users\\rober\\Pictures2\\private".into());
        assert_eq!(store.covers(&sneaky), Err(GrantMiss::ResourceOutsideScope));
    }

    #[test]
    fn a_grant_does_not_cross_account_conversation_or_origin() {
        let store = ApprovalStore::default();
        store
            .grant(plan(RiskLevel::Reversible, &["screen.capture"], &[]))
            .unwrap();

        let mut other_account = step("screen.capture", RiskLevel::ReadOnly);
        other_account.account_id = "acct-B".into();
        assert_eq!(store.covers(&other_account), Err(GrantMiss::DifferentAccount));

        let mut other_conversation = step("screen.capture", RiskLevel::ReadOnly);
        other_conversation.conversation_id = Some("conv-2".into());
        assert_eq!(
            store.covers(&other_conversation),
            Err(GrantMiss::DifferentConversation),
        );

        let mut other_origin = step("screen.capture", RiskLevel::ReadOnly);
        other_origin.origin = "chat".into();
        assert_eq!(store.covers(&other_origin), Err(GrantMiss::DifferentOrigin));
    }

    #[test]
    fn a_revoked_grant_authorises_nothing() {
        let store = ApprovalStore::default();
        store
            .grant(plan(RiskLevel::Reversible, &["screen.capture"], &[]))
            .unwrap();
        store.revoke("req-1");
        assert_eq!(
            store.covers(&step("screen.capture", RiskLevel::ReadOnly)),
            Err(GrantMiss::NoGrant),
        );
    }

    /// Closing the voice overlay must not leave an approval behind for whatever
    /// arrives next in that conversation.
    #[test]
    fn ending_a_conversation_drops_its_grants() {
        let store = ApprovalStore::default();
        store
            .grant(plan(RiskLevel::Reversible, &["screen.capture"], &[]))
            .unwrap();
        store.revoke_conversation("conv-1");
        assert_eq!(store.active(), 0);
        assert_eq!(
            store.covers(&step("screen.capture", RiskLevel::ReadOnly)),
            Err(GrantMiss::NoGrant),
        );
    }

    #[test]
    fn a_blanket_grant_is_only_allowed_for_read_only() {
        let store = ApprovalStore::default();
        assert!(
            store.grant(plan(RiskLevel::ReadOnly, &[], &[])).is_some(),
            "inspection needs no capability list"
        );
        assert!(
            store.grant(plan(RiskLevel::Reversible, &[], &[])).is_none(),
            "anything that changes state must name what it may change"
        );
    }
}

// ---------------------------------------------------------------------------
// Commands
//
// The store lives in Rust so the voice overlay and the main window ask the same
// authority. Both are separate WebView2 heaps; a TypeScript grant would be two
// grants that disagree, which is how the overlay came to re-ask for something
// the main window had already approved.
// ---------------------------------------------------------------------------

use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantDecision {
    pub allowed: bool,
    /// Absent when allowed. A specific reason, so the spoken question can say
    /// what changed rather than asking the same thing again.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub miss: Option<GrantMiss>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[tauri::command]
pub fn approval_grant(store: State<ApprovalStore>, request: GrantRequest) -> Option<String> {
    store.grant(request)
}

#[tauri::command]
pub fn approval_covers(store: State<ApprovalStore>, step: StepRequest) -> GrantDecision {
    match store.covers(&step) {
        Ok(()) => GrantDecision {
            allowed: true,
            miss: None,
            reason: None,
        },
        Err(miss) => GrantDecision {
            allowed: false,
            miss: Some(miss),
            reason: Some(miss.message().to_string()),
        },
    }
}

#[tauri::command]
pub fn approval_revoke(store: State<ApprovalStore>, request_id: String) {
    store.revoke(&request_id);
}

#[tauri::command]
pub fn approval_revoke_conversation(store: State<ApprovalStore>, conversation_id: String) {
    store.revoke_conversation(&conversation_id);
}

/// How many steps the grant covered, for the permission-count tests.
#[tauri::command]
pub fn approval_uses(store: State<ApprovalStore>, request_id: String) -> u32 {
    store.uses(&request_id)
}
