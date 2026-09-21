//! Telling a Zoom meeting window from the rest of Zoom.
//!
//! The obvious approach — look for "Zoom Meeting" in the window title — cannot
//! work, and it is worth being precise about why, because it is what the
//! previous implementation did and it never fired once.
//!
//! Enumerating every top-level window of every Zoom process on a machine with a
//! live meeting gives this (titles verbatim):
//!
//! ```text
//! pid 14496  ZPPTMainFrmWndClassEx            1296x999   "Zoom Workplace"
//! pid 14496  ZPPTEnhanceLoginMainWindowClassEx 1312x720  "Zoom Workplace"
//! pid 18272  ConfMultiTabContentWndClass      1280x720   "Zoom Workplace"
//! pid 18272  ZPFloatVideoWndClass              224x126   "Zoom Workplace"
//! pid 18272  ZPActiveSpeakerWndClass           224x30    "Zoom Workplace"
//! ```
//!
//! Every one of them is called "Zoom Workplace". The meeting window's title is
//! not "…'s Zoom Meeting" — that string appears in Zoom's own notification and
//! in its meeting-info panel, never in the window caption. Title matching had
//! nothing to match on.
//!
//! What *does* separate them is the window class, and Zoom is unusually helpful
//! here: it runs the meeting in a **separate process** whose windows carry
//! conference-specific classes (`Conf…`, `ZPFloatVideo…`, `ZPActiveSpeaker…`).
//! So the classifier reads class names and ignores titles entirely, which also
//! means it never has to look at a string containing the user's name.

use serde::{Deserialize, Serialize};

/// What one Zoom top-level window is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ZoomWindowKind {
    /// The conference surface: a meeting is in progress.
    Meeting,
    /// A webinar, which Zoom hosts on the same conference classes.
    Webinar,
    /// Zoom Workplace itself — the home window. Not a meeting.
    Home,
    /// Preferences.
    Settings,
    /// The sign-in window.
    SignIn,
    /// Installer or updater UI.
    Update,
    /// Message-only windows, IME stubs, tooltips, notifiers, menus.
    Background,
    /// A Zoom window this classifier does not recognise.
    Unknown,
}

impl ZoomWindowKind {
    /// Does this window mean a meeting is happening?
    pub fn is_meeting(self) -> bool {
        matches!(self, Self::Meeting | Self::Webinar)
    }

    /// The sanitized name for diagnostics. Never carries a title.
    pub fn diagnostic_label(self) -> &'static str {
        match self {
            Self::Meeting => "ZoomMeetingWindow",
            Self::Webinar => "ZoomWebinarWindow",
            Self::Home => "ZoomHomeWindow",
            Self::Settings => "ZoomSettingsWindow",
            Self::SignIn => "ZoomSignInWindow",
            Self::Update => "ZoomUpdateWindow",
            Self::Background => "ZoomBackgroundWindow",
            Self::Unknown => "UnknownZoomWindow",
        }
    }
}

/// One window, as the classifier needs to see it.
///
/// Deliberately no title field. The classifier does not read titles, so it
/// cannot accidentally start depending on one — and a struct with nowhere to
/// put a caption cannot leak one into a log.
#[derive(Debug, Clone)]
pub struct ZoomWindowFacts<'a> {
    /// Executable file name, e.g. `Zoom.exe`. Case-insensitive.
    pub executable_name: &'a str,
    /// Win32 window class name.
    pub class_name: &'a str,
    pub visible: bool,
    pub minimized: bool,
    pub width: i32,
    pub height: i32,
}

/// Executables that are Zoom's meeting client.
///
/// `cpthost.exe` is Zoom's screen-share/annotation host and `zoom.exe` covers
/// both the home process and the conference process. Anything else with "zoom"
/// in a window title is not Zoom — which is the rule that keeps a browser tab
/// called "Zoom pricing" from being mistaken for a call.
const ZOOM_EXECUTABLES: &[&str] = &["zoom.exe", "cpthost.exe", "zoomus.exe"];

/// The conference window the user actually sits in.
const MEETING_CLASSES: &[&str] = &[
    // The meeting surface itself, tabbed since Zoom Workplace.
    "confmultitabcontentwndclass",
    // Older/simple conference frames, still emitted in some layouts.
    "zpconfwndclass",
    "conf_activity_wnd_class",
];

/// Windows that only exist while a conference is running.
///
/// Weaker evidence than the meeting window: they say "a call is in progress"
/// without being the thing the user is looking at. Used when the meeting window
/// is minimised to the floating thumbnail, which is a normal way to be in a
/// meeting while working in another application.
const IN_CONFERENCE_CLASSES: &[&str] = &[
    "zpfloatvideowndclass",
    "zpactivespeakerwndclass",
    "videoframewndclass",
    "confpopuptopclass",
    "zptoolbarparentwndclass",
    "zpreactionawarenesswndclass",
];

const WEBINAR_CLASSES: &[&str] = &["zpwebinarwndclass", "webinarattendeewndclass"];

const HOME_CLASSES: &[&str] = &["zpptmainfrmwndclassex", "zpptenhanceloginmainwindowclassex"];

const SETTINGS_CLASSES: &[&str] = &["zpsettingwndclass", "zppreferencewndclass"];
const SIGN_IN_CLASSES: &[&str] = &["zploginwndclass", "zpsigninwndclass"];
const UPDATE_CLASSES: &[&str] = &["zpupdatewndclass", "zpinstallerwndclass"];

/// Class fragments that are always plumbing, whatever their size.
const BACKGROUND_FRAGMENTS: &[&str] = &[
    "menuclass",
    "ime",
    "msctfime",
    "tooltips_class",
    "notifywnd",
    // Zoom spells some of these with underscores: `zoom_acc_notify_wnd`,
    // `zoom_pt_notification_app_bar_wnd`.
    "notify_wnd",
    "notification_app_bar",
    "notifierwnd",
    "notificationwnd",
    "hostwindow",
    "methodinvokewnd",
    "gdi+ hook",
    "message window",
    "batterypowermonitor",
    "popupcontainerbase",
    "emojimanagerwnd",
    "devicesnotifier",
    "device_wnd_class",
    "tasksyncwindow",
    "transparentoverlay",
    "nativetransferhelper",
    "imageviewerwnd",
    "annotationbutton",
    "zpagedragablebtn",
    "zpageturnbtn",
    "zpvideoscrollbtnclass",
    "popupcontainerwndclass",
    "retracehistorymenu",
    "customizeddrawmenu",
    "controlpanelhintclass",
    "floatwidgetnotifi",
];

fn matches_any(class: &str, list: &[&str]) -> bool {
    list.iter().any(|c| class == *c)
}

fn contains_any(class: &str, list: &[&str]) -> bool {
    list.iter().any(|c| class.contains(c))
}

/// Classify one Zoom window.
///
/// Returns `None` when the window does not belong to Zoom at all — the caller
/// should skip it rather than treat it as an unknown Zoom window.
pub fn classify(facts: &ZoomWindowFacts<'_>) -> Option<ZoomWindowKind> {
    let exe = facts.executable_name.trim().to_ascii_lowercase();
    if !ZOOM_EXECUTABLES.iter().any(|z| exe == *z) {
        // Process identity is the gate. Without it, any window whose class or
        // title mentioned Zoom could pose as a meeting.
        return None;
    }

    // Zoom's class names are stable but not consistently cased, and at least
    // one is emitted with a leading tab character.
    let class = facts
        .class_name
        .trim()
        .trim_start_matches('\t')
        .to_ascii_lowercase();

    if matches_any(&class, WEBINAR_CLASSES) {
        return Some(ZoomWindowKind::Webinar);
    }
    if matches_any(&class, MEETING_CLASSES) || matches_any(&class, IN_CONFERENCE_CLASSES) {
        return Some(ZoomWindowKind::Meeting);
    }
    if matches_any(&class, HOME_CLASSES) {
        return Some(ZoomWindowKind::Home);
    }
    if matches_any(&class, SETTINGS_CLASSES) {
        return Some(ZoomWindowKind::Settings);
    }
    if matches_any(&class, SIGN_IN_CLASSES) {
        return Some(ZoomWindowKind::SignIn);
    }
    if matches_any(&class, UPDATE_CLASSES) {
        return Some(ZoomWindowKind::Update);
    }
    if contains_any(&class, BACKGROUND_FRAGMENTS) {
        return Some(ZoomWindowKind::Background);
    }
    Some(ZoomWindowKind::Unknown)
}

/// Is a Zoom meeting in progress, given every Zoom window on the machine?
///
/// Any conference window counts, visible or not. A meeting minimised to its
/// floating thumbnail — or hidden entirely behind other windows — is still a
/// meeting, and requiring visibility meant a user who alt-tabbed away stopped
/// being in a call. The zero-sized plumbing windows are already excluded by
/// class, so this does not need a size rule to stay honest.
pub fn meeting_window<'a>(
    windows: &'a [ZoomWindowFacts<'a>],
) -> Option<(&'a ZoomWindowFacts<'a>, ZoomWindowKind)> {
    // The real conference surface first, so the session binds to the window the
    // user is looking at rather than to a 224x126 thumbnail.
    let mut fallback = None;
    for window in windows {
        let Some(kind) = classify(window) else {
            continue;
        };
        if !kind.is_meeting() {
            continue;
        }
        let class = window.class_name.trim().to_ascii_lowercase();
        if matches_any(&class, MEETING_CLASSES) || matches_any(&class, WEBINAR_CLASSES) {
            return Some((window, kind));
        }
        if fallback.is_none() {
            fallback = Some((window, kind));
        }
    }
    fallback
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win<'a>(exe: &'a str, class: &'a str) -> ZoomWindowFacts<'a> {
        ZoomWindowFacts {
            executable_name: exe,
            class_name: class,
            visible: true,
            minimized: false,
            width: 1280,
            height: 720,
        }
    }

    /// The exact window that must be found: the conference surface.
    #[test]
    fn the_conference_window_is_a_meeting() {
        let w = win("Zoom.exe", "ConfMultiTabContentWndClass");
        assert_eq!(classify(&w), Some(ZoomWindowKind::Meeting));
        assert!(classify(&w).unwrap().is_meeting());
    }

    /// The exact window that must NOT be found. Same process name, same title,
    /// different class — which is the whole reason this module reads classes.
    #[test]
    fn zoom_workplace_home_is_not_a_meeting() {
        for class in ["ZPPTMainFrmWndClassEx", "ZPPTEnhanceLoginMainWindowClassEx"] {
            let w = win("Zoom.exe", class);
            assert_eq!(classify(&w), Some(ZoomWindowKind::Home), "{class}");
            assert!(!classify(&w).unwrap().is_meeting(), "{class}");
        }
    }

    #[test]
    fn a_webinar_is_a_meeting() {
        assert_eq!(
            classify(&win("Zoom.exe", "ZPWebinarWndClass")),
            Some(ZoomWindowKind::Webinar)
        );
    }

    #[test]
    fn settings_sign_in_and_updater_are_not_meetings() {
        for (class, expected) in [
            ("ZPSettingWndClass", ZoomWindowKind::Settings),
            ("ZPLoginWndClass", ZoomWindowKind::SignIn),
            ("ZPUpdateWndClass", ZoomWindowKind::Update),
        ] {
            let kind = classify(&win("Zoom.exe", class)).unwrap();
            assert_eq!(kind, expected, "{class}");
            assert!(!kind.is_meeting(), "{class}");
        }
    }

    /// Every one of these was enumerated from the live machine alongside the
    /// real meeting. None of them is a call.
    #[test]
    fn zooms_plumbing_windows_are_background() {
        for class in [
            "ZPMenuClass",
            "PopupContainerBase",
            "MSCTFIME UI",
            "IME",
            "GDI+ Hook Window Class",
            "cpt message window",
            "BatteryPowerMonitorClass",
            "NotificationWnd",
            "EmojiManagerWnd",
            "ZoomPTApp_HostWindow",
            "AnnotationButton",
            "ZPVideoScrollBtnClass",
            "TransparentOverlayWindow",
            "ImageViewerWnd",
            "zoom_acc_notify_wnd",
        ] {
            let kind = classify(&win("Zoom.exe", class)).unwrap();
            assert_eq!(kind, ZoomWindowKind::Background, "{class}");
            assert!(!kind.is_meeting(), "{class}");
        }
    }

    /// Process identity is the gate. A browser tab about Zoom is not a call.
    #[test]
    fn a_window_from_another_application_is_never_zoom() {
        for exe in ["chrome.exe", "msedge.exe", "notepad.exe"] {
            assert_eq!(
                classify(&win(exe, "ConfMultiTabContentWndClass")),
                None,
                "{exe}"
            );
            assert_eq!(classify(&win(exe, "Chrome_WidgetWin_1")), None, "{exe}");
        }
    }

    /// A meeting minimised to its floating thumbnail is still a meeting.
    #[test]
    fn an_in_conference_thumbnail_still_counts() {
        let mut w = win("Zoom.exe", "ZPFloatVideoWndClass");
        w.visible = false;
        w.minimized = true;
        w.width = 224;
        w.height = 126;
        assert_eq!(classify(&w), Some(ZoomWindowKind::Meeting));
    }

    /// The class list Zoom really emits, in the order Windows enumerated it.
    /// The conference surface must win over the thumbnail so the session binds
    /// to the window the user is actually in.
    #[test]
    fn the_live_window_set_resolves_to_the_conference_surface() {
        let windows = vec![
            win("Zoom.exe", "ZPMenuClass"),
            win("Zoom.exe", "ZPPTMainFrmWndClassEx"),
            win("Zoom.exe", "PopupContainerBase"),
            win("Zoom.exe", "ZPFloatVideoWndClass"),
            win("Zoom.exe", "ZPActiveSpeakerWndClass"),
            win("Zoom.exe", "ConfMultiTabContentWndClass"),
            win("Zoom.exe", "Default IME"),
        ];
        let (found, kind) = meeting_window(&windows).expect("a meeting");
        assert_eq!(found.class_name, "ConfMultiTabContentWndClass");
        assert_eq!(kind, ZoomWindowKind::Meeting);
    }

    /// Zoom open, no call: nothing is found.
    #[test]
    fn zoom_open_without_a_call_finds_no_meeting() {
        let windows = vec![
            win("Zoom.exe", "ZPPTMainFrmWndClassEx"),
            win("Zoom.exe", "ZPPTEnhanceLoginMainWindowClassEx"),
            win("Zoom.exe", "ZPMenuClass"),
            win("Zoom.exe", "PopupContainerBase"),
            win("Zoom.exe", "Default IME"),
            win("Zoom.exe", "GDI+ Hook Window Class"),
        ];
        assert!(meeting_window(&windows).is_none());
    }

    /// A tab character really does appear on one of Zoom's class names.
    #[test]
    fn a_leading_tab_in_a_class_name_does_not_defeat_the_match() {
        assert_eq!(
            classify(&win("Zoom.exe", "\tZPControlPanelHintClass")),
            Some(ZoomWindowKind::Background)
        );
    }

    /// Diagnostics carry a kind, never a caption.
    #[test]
    fn diagnostic_labels_are_sanitized() {
        assert_eq!(
            ZoomWindowKind::Meeting.diagnostic_label(),
            "ZoomMeetingWindow"
        );
        assert_eq!(ZoomWindowKind::Home.diagnostic_label(), "ZoomHomeWindow");
    }
}
