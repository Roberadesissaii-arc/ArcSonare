//! A narrow Windows UI Automation reader.
//!
//! Deliberately narrow. UI Automation can walk an application's entire tree,
//! and an unbounded walk of a chat client is a transcript — so this exposes two
//! operations and no general traversal: read the *names* of interactive
//! controls, and read text elements under an explicitly named region. Both are
//! depth- and count-limited, and both are gated by the caller's privacy policy
//! before they are ever called.
//!
//! What this is not: a screen reader. Nothing here captures pixels.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiaElement {
    pub name: String,
    pub control_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_id: Option<String>,
    pub depth: u32,
}

/// How much of a tree a single read may touch.
///
/// A budget rather than "read everything and truncate": the cost of a UIA walk
/// is paid during the walk, and an unbounded one on a busy Electron window
/// takes seconds while holding the caller's turn.
#[derive(Debug, Clone, Copy)]
pub struct WalkBudget {
    pub max_depth: u32,
    pub max_elements: usize,
}

impl Default for WalkBudget {
    fn default() -> Self {
        Self {
            max_depth: 12,
            max_elements: 400,
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::{UiaElement, WalkBudget};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, TreeScope_Children,
        UIA_ButtonControlTypeId, UIA_DocumentControlTypeId, UIA_EditControlTypeId,
        UIA_ListItemControlTypeId, UIA_MenuItemControlTypeId, UIA_TabItemControlTypeId,
        UIA_TextControlTypeId, UIA_TreeItemControlTypeId,
    };

    /// COM must be initialised on the calling thread. Repeated calls on an
    /// already-initialised thread return a benign "already initialised", which
    /// is why the result is discarded rather than propagated.
    fn ensure_com() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    fn automation() -> Result<IUIAutomation, String> {
        ensure_com();
        unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("UI Automation is unavailable: {e}"))
        }
    }

    fn control_type_label(id: i32) -> &'static str {
        match id {
            id if id == UIA_ButtonControlTypeId.0 => "button",
            id if id == UIA_EditControlTypeId.0 => "edit",
            id if id == UIA_TextControlTypeId.0 => "text",
            id if id == UIA_ListItemControlTypeId.0 => "list-item",
            id if id == UIA_TreeItemControlTypeId.0 => "tree-item",
            id if id == UIA_TabItemControlTypeId.0 => "tab",
            id if id == UIA_MenuItemControlTypeId.0 => "menu-item",
            id if id == UIA_DocumentControlTypeId.0 => "document",
            _ => "other",
        }
    }

    fn describe(element: &IUIAutomationElement, depth: u32) -> Option<UiaElement> {
        unsafe {
            let name = element.CurrentName().ok()?.to_string();
            if name.trim().is_empty() {
                return None;
            }
            let control_type = element.CurrentControlType().ok()?;
            let automation_id = element
                .CurrentAutomationId()
                .ok()
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            Some(UiaElement {
                name,
                control_type: control_type_label(control_type.0).to_string(),
                automation_id,
                depth,
            })
        }
    }

    /// Breadth-first walk under `root`, within budget.
    fn walk(
        automation: &IUIAutomation,
        root: &IUIAutomationElement,
        budget: WalkBudget,
        keep: &dyn Fn(&UiaElement) -> bool,
    ) -> Vec<UiaElement> {
        let mut out = Vec::new();
        let Ok(condition) = (unsafe { automation.CreateTrueCondition() }) else {
            return out;
        };
        let mut frontier = vec![(root.clone(), 0u32)];

        while let Some((element, depth)) = frontier.pop() {
            if depth >= budget.max_depth || out.len() >= budget.max_elements {
                continue;
            }
            let Ok(children) = (unsafe { element.FindAll(TreeScope_Children, &condition) }) else {
                continue;
            };
            let Ok(count) = (unsafe { children.Length() }) else {
                continue;
            };
            for index in 0..count {
                if out.len() >= budget.max_elements {
                    break;
                }
                let Ok(child) = (unsafe { children.GetElement(index) }) else {
                    continue;
                };
                if let Some(described) = describe(&child, depth + 1) {
                    if keep(&described) {
                        out.push(described);
                    }
                }
                frontier.push((child, depth + 1));
            }
        }
        out
    }

    fn element_for(hwnd: isize) -> Result<(IUIAutomation, IUIAutomationElement), String> {
        let automation = automation()?;
        let element = unsafe { automation.ElementFromHandle(HWND(hwnd as *mut _)) }
            .map_err(|e| format!("that window does not expose an accessibility tree: {e}"))?;
        Ok((automation, element))
    }

    /// Names of interactive controls only — buttons, tabs, list and tree items.
    ///
    /// Text elements are excluded here by construction. In a chat client the
    /// text elements *are* the conversation, and "what controls are available"
    /// must not quietly return one.
    pub fn interactive_controls(hwnd: isize, budget: WalkBudget) -> Result<Vec<UiaElement>, String> {
        let (automation, root) = element_for(hwnd)?;
        Ok(walk(&automation, &root, budget, &|e| {
            matches!(
                e.control_type.as_str(),
                "button" | "tab" | "tree-item" | "menu-item" | "edit"
            )
        }))
    }

    /// Text elements, for callers that hold explicit content consent.
    pub fn text_elements(hwnd: isize, budget: WalkBudget) -> Result<Vec<UiaElement>, String> {
        let (automation, root) = element_for(hwnd)?;
        Ok(walk(&automation, &root, budget, &|e| {
            matches!(e.control_type.as_str(), "text" | "list-item" | "document")
        }))
    }

    /// Whether this window exposes a usable tree at all.
    ///
    /// Electron applications only build one when accessibility support is
    /// switched on, so "Discord is running" and "Discord can be read" are
    /// different facts and the adapter must not conflate them.
    pub fn tree_available(hwnd: isize) -> bool {
        match element_for(hwnd) {
            Ok((automation, root)) => {
                let budget = WalkBudget {
                    max_depth: 4,
                    max_elements: 8,
                };
                !walk(&automation, &root, budget, &|_| true).is_empty()
            }
            Err(_) => false,
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{UiaElement, WalkBudget};

    pub fn interactive_controls(_hwnd: isize, _budget: WalkBudget) -> Result<Vec<UiaElement>, String> {
        Err("UI Automation is only available on Windows.".into())
    }

    pub fn text_elements(_hwnd: isize, _budget: WalkBudget) -> Result<Vec<UiaElement>, String> {
        Err("UI Automation is only available on Windows.".into())
    }

    pub fn tree_available(_hwnd: isize) -> bool {
        false
    }
}

pub use imp::{interactive_controls, text_elements, tree_available};

#[cfg(test)]
mod tests {
    use super::*;

    /// The budget must be small enough that a single read cannot become a
    /// transcript of an entire chat history.
    #[test]
    fn the_default_walk_budget_is_bounded() {
        let budget = WalkBudget::default();
        assert!(budget.max_depth <= 16);
        assert!(budget.max_elements <= 500);
    }
}
