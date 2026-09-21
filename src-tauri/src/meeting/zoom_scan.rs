//! Enumerating Zoom's top-level windows natively.
//!
//! The Watch system's `discover_instances` cannot answer this question. It maps
//! a *process* to one catalog application and keeps one instance per
//! application, which is right for "which applications are running" and wrong
//! for "is a meeting open": Zoom's home window and its conference window are
//! two separate HWNDs, and collapsing them loses exactly the one that matters.
//!
//! So this is a separate, narrow scan — Zoom processes only, every top-level
//! window, each keeping its own handle. It does not modify or replace Watch
//! discovery; the two answer different questions.
//!
//! Nothing here reads a window title. `ZoomWindowFacts` has no field for one,
//! which is deliberate: the classifier works on window classes, so a caption
//! containing the user's name is never fetched, never logged and never emitted.

use super::zoom_windows::{self, ZoomWindowKind};

/// One Zoom top-level window, identified by handle rather than by process.
#[derive(Debug, Clone)]
pub struct ZoomWindow {
    pub process_id: u32,
    /// `HWND` as an integer. With `process_id` this is the runtime identity —
    /// process id alone would merge the home and conference windows again.
    pub hwnd: isize,
    pub class_name: String,
    pub executable_name: String,
    pub kind: ZoomWindowKind,
    pub visible: bool,
    pub minimized: bool,
    /// Physical desktop rectangle: left, top, right, bottom.
    pub bounds: (i32, i32, i32, i32),
}

impl ZoomWindow {
    pub fn width(&self) -> i32 {
        self.bounds.2 - self.bounds.0
    }
    pub fn height(&self) -> i32 {
        self.bounds.3 - self.bounds.1
    }

    /// A log line that cannot leak anything private.
    ///
    /// Class names and sizes only. No title, no participant, no meeting id.
    pub fn diagnostic(&self) -> String {
        format!(
            "pid={} hwnd=0x{:X} class={} kind={} visible={} minimized={} size={}x{}",
            self.process_id,
            self.hwnd,
            self.class_name,
            self.kind.diagnostic_label(),
            self.visible,
            self.minimized,
            self.width(),
            self.height(),
        )
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::ZoomWindow;
    use crate::meeting::zoom_windows::{self, ZoomWindowFacts};
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible,
    };

    struct Collector {
        windows: Vec<ZoomWindow>,
        /// pid → executable file name, resolved once per process.
        executables: std::collections::HashMap<u32, Option<String>>,
    }

    fn wide_to_string(buffer: &[u16], len: usize) -> String {
        std::ffi::OsString::from_wide(&buffer[..len])
            .to_string_lossy()
            .into_owned()
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let collector = &mut *(lparam.0 as *mut Collector);

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return BOOL(1);
        }

        let executable = collector
            .executables
            .entry(pid)
            .or_insert_with(|| super::executable_name_for(pid))
            .clone();
        let Some(executable) = executable else {
            return BOOL(1);
        };

        let mut class_buf = [0u16; 256];
        let class_len = GetClassNameW(hwnd, &mut class_buf) as usize;
        let class_name = wide_to_string(&class_buf, class_len);

        let visible = IsWindowVisible(hwnd).as_bool();
        let minimized = IsIconic(hwnd).as_bool();
        let mut rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);

        let facts = ZoomWindowFacts {
            executable_name: &executable,
            class_name: &class_name,
            visible,
            minimized,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        };
        // `None` means the window is not Zoom's at all — skip it entirely.
        if let Some(kind) = zoom_windows::classify(&facts) {
            collector.windows.push(ZoomWindow {
                process_id: pid,
                hwnd: hwnd.0 as isize,
                class_name,
                executable_name: executable,
                kind,
                visible,
                minimized,
                bounds: (rect.left, rect.top, rect.right, rect.bottom),
            });
        }
        BOOL(1)
    }

    pub fn scan() -> Vec<ZoomWindow> {
        let mut collector = Collector {
            windows: Vec::new(),
            executables: std::collections::HashMap::new(),
        };
        unsafe {
            let _ = EnumWindows(
                Some(enum_proc),
                LPARAM(&mut collector as *mut Collector as isize),
            );
        }
        collector.windows
    }
}

#[cfg(target_os = "windows")]
fn executable_name_for(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 512];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
        .is_ok();
        let _ = CloseHandle(handle);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        path.rsplit(['\\', '/']).next().map(str::to_string)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::ZoomWindow;
    pub fn scan() -> Vec<ZoomWindow> {
        Vec::new()
    }
}

/// Every Zoom top-level window on the machine, one entry per HWND.
pub fn scan_zoom_windows() -> Vec<ZoomWindow> {
    platform::scan()
}

/// The conference window, when a meeting is in progress.
///
/// Prefers the real conference surface over the floating thumbnail, so a
/// session binds to the window the user is in.
pub fn find_meeting_window(windows: &[ZoomWindow]) -> Option<&ZoomWindow> {
    windows
        .iter()
        .find(|w| w.kind == ZoomWindowKind::Meeting || w.kind == ZoomWindowKind::Webinar)
        .and_then(|_| {
            // Conference surface first.
            windows
                .iter()
                .find(|w| {
                    let class = w.class_name.trim().to_ascii_lowercase();
                    w.kind.is_meeting()
                        && (class == "confmultitabcontentwndclass"
                            || class == "zpconfwndclass"
                            || class.contains("webinar"))
                })
                .or_else(|| windows.iter().find(|w| w.kind.is_meeting()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(pid: u32, hwnd: isize, class: &str, kind: ZoomWindowKind) -> ZoomWindow {
        ZoomWindow {
            process_id: pid,
            hwnd,
            class_name: class.into(),
            executable_name: "Zoom.exe".into(),
            kind,
            visible: true,
            minimized: false,
            bounds: (0, 0, 1280, 720),
        }
    }

    /// The failure this module exists to fix: one process, two windows, and the
    /// meeting one must survive.
    #[test]
    fn the_home_and_meeting_windows_are_separate_entries() {
        let windows = vec![
            w(
                14496,
                0x20D2C,
                "ZPPTMainFrmWndClassEx",
                ZoomWindowKind::Home,
            ),
            w(
                18272,
                0x670BDA,
                "ConfMultiTabContentWndClass",
                ZoomWindowKind::Meeting,
            ),
        ];
        assert_eq!(windows.len(), 2, "neither window may be collapsed away");
        assert_ne!(windows[0].hwnd, windows[1].hwnd);
        let meeting = find_meeting_window(&windows).expect("the meeting");
        assert_eq!(meeting.hwnd, 0x670BDA);
        assert_eq!(meeting.kind, ZoomWindowKind::Meeting);
    }

    /// Zoom runs the conference in its own process, but the rule must not rely
    /// on that: the same pid with two window kinds still resolves correctly.
    #[test]
    fn one_process_with_both_kinds_still_finds_the_meeting() {
        let windows = vec![
            w(14496, 0x1, "ZPPTMainFrmWndClassEx", ZoomWindowKind::Home),
            w(
                14496,
                0x2,
                "ConfMultiTabContentWndClass",
                ZoomWindowKind::Meeting,
            ),
        ];
        let meeting = find_meeting_window(&windows).expect("the meeting");
        assert_eq!(meeting.hwnd, 0x2);
        assert_eq!(meeting.process_id, 14496);
    }

    #[test]
    fn the_conference_surface_beats_the_floating_thumbnail() {
        let windows = vec![
            w(
                18272,
                0x40E34,
                "ZPFloatVideoWndClass",
                ZoomWindowKind::Meeting,
            ),
            w(
                18272,
                0x670BDA,
                "ConfMultiTabContentWndClass",
                ZoomWindowKind::Meeting,
            ),
        ];
        assert_eq!(find_meeting_window(&windows).unwrap().hwnd, 0x670BDA);
    }

    #[test]
    fn home_windows_alone_are_not_a_meeting() {
        let windows = vec![
            w(14496, 0x1, "ZPPTMainFrmWndClassEx", ZoomWindowKind::Home),
            w(14496, 0x2, "ZPMenuClass", ZoomWindowKind::Background),
        ];
        assert!(find_meeting_window(&windows).is_none());
    }

    /// Diagnostics carry class names and sizes, never a caption.
    #[test]
    fn diagnostics_carry_no_title() {
        let line = w(
            18272,
            0x670BDA,
            "ConfMultiTabContentWndClass",
            ZoomWindowKind::Meeting,
        )
        .diagnostic();
        assert!(line.contains("ZoomMeetingWindow"));
        assert!(line.contains("hwnd=0x670BDA"));
        assert!(!line.to_lowercase().contains("title"));
    }
}
