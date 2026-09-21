//! Where a Desktop icon actually is, according to Windows.
//!
//! "Show me the books folder" was being answered by photographing the screen and
//! asking a vision model to find it. The model returned a box covering four
//! unrelated icons and ArcSonare drew a border round all of them. Every layer
//! below that was working correctly — the capture, the frame ownership, the
//! coordinate mapping, the overlay — and none of it could help, because the
//! answer being mapped was wrong before it arrived.
//!
//! Windows already knows where every Desktop icon is, to the pixel. The shell
//! keeps them in a list-view control, and that control will report each item's
//! label and rectangle on request. Asking it is faster than a screenshot, cannot
//! misrecognise anything, and cannot return a box spanning four icons.
//!
//! The awkward part is that the control belongs to explorer.exe, and the
//! list-view messages that return data write it through a pointer in the calling
//! process's address space. Reading it therefore means allocating a small buffer
//! *inside* explorer and reading it back — the documented technique for this,
//! and the reason this module is longer than it looks like it should be.

#![cfg(windows)]

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;

use super::types::{ResultBuilder, ToolResult, VerificationEvidence};

type Hwnd = isize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopItemKind {
    Folder,
    File,
    Any,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopItemSource {
    ShellListView,
    Vision,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl PhysicalRect {
    pub fn center(&self) -> (i32, i32) {
        (self.x + self.width / 2, self.y + self.height / 2)
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopItem {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// `None` when the label alone cannot say — see `resolve_label`. Unknown is
    /// a distinct answer from "not a folder", and collapsing the two is how a
    /// zip archive comes to be described as the folder sitting next to it.
    pub is_folder: Option<bool>,
    /// The icon's rectangle in virtual-desktop pixels — the same space the
    /// overlay draws in, so nothing downstream has to convert anything.
    pub bounds: PhysicalRect,
    pub source: DesktopItemSource,
}

// ---------------------------------------------------------------------------
// Win32
// ---------------------------------------------------------------------------

const LVM_FIRST: u32 = 0x1000;
const LVM_GETITEMCOUNT: u32 = LVM_FIRST + 4;
const LVM_GETITEMRECT: u32 = LVM_FIRST + 14;
const LVM_GETITEMTEXTW: u32 = LVM_FIRST + 115;
/// The icon plus its label, which is what a user points at.
const LVIR_SELECTBOUNDS: i32 = 3;

const PROCESS_VM_OPERATION: u32 = 0x0008;
const PROCESS_VM_READ: u32 = 0x0010;
const PROCESS_VM_WRITE: u32 = 0x0020;
const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
const MEM_COMMIT: u32 = 0x1000;
const MEM_RESERVE: u32 = 0x2000;
const MEM_RELEASE: u32 = 0x8000;
const PAGE_READWRITE: u32 = 0x04;

#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct LvItemW {
    mask: u32,
    item: i32,
    sub_item: i32,
    state: u32,
    state_mask: u32,
    text: *mut u16,
    text_max: i32,
    image: i32,
    param: isize,
    indent: i32,
    group_id: i32,
    columns: u32,
    col_fmt: *mut u32,
    group: i32,
}

#[link(name = "user32")]
extern "system" {
    fn FindWindowW(class: *const u16, window: *const u16) -> Hwnd;
    fn FindWindowExW(
        parent: Hwnd,
        child_after: Hwnd,
        class: *const u16,
        window: *const u16,
    ) -> Hwnd;
    fn SendMessageW(hwnd: Hwnd, msg: u32, wp: usize, lp: isize) -> isize;
    fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
    fn ClientToScreen(hwnd: Hwnd, point: *mut Point) -> i32;
    fn EnumWindows(callback: unsafe extern "system" fn(Hwnd, isize) -> i32, param: isize) -> i32;
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Point {
    x: i32,
    y: i32,
}

#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
    fn CloseHandle(handle: isize) -> i32;
    fn VirtualAllocEx(
        process: isize,
        address: *mut core::ffi::c_void,
        size: usize,
        allocation_type: u32,
        protect: u32,
    ) -> *mut core::ffi::c_void;
    fn VirtualFreeEx(
        process: isize,
        address: *mut core::ffi::c_void,
        size: usize,
        free_type: u32,
    ) -> i32;
    fn WriteProcessMemory(
        process: isize,
        address: *mut core::ffi::c_void,
        buffer: *const core::ffi::c_void,
        size: usize,
        written: *mut usize,
    ) -> i32;
    fn ReadProcessMemory(
        process: isize,
        address: *const core::ffi::c_void,
        buffer: *mut core::ffi::c_void,
        size: usize,
        read: *mut usize,
    ) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Find the desktop's icon list-view.
///
/// Two arrangements exist and both are normal. Without a wallpaper slideshow the
/// list lives under `Progman`; with one, the shell interposes a `WorkerW` window
/// and the list moves under that instead. Checking only the first is why this
/// kind of code usually "works on my machine".
fn find_desktop_listview() -> Option<Hwnd> {
    let progman = unsafe { FindWindowW(wide("Progman").as_ptr(), std::ptr::null()) };
    if progman != 0 {
        let defview = unsafe {
            FindWindowExW(
                progman,
                0,
                wide("SHELLDLL_DefView").as_ptr(),
                std::ptr::null(),
            )
        };
        if defview != 0 {
            let list = unsafe {
                FindWindowExW(defview, 0, wide("SysListView32").as_ptr(), std::ptr::null())
            };
            if list != 0 {
                return Some(list);
            }
        }
    }
    // Wallpaper slideshow: walk the WorkerW windows for the one holding it.
    static mut FOUND: Hwnd = 0;
    unsafe extern "system" fn visit(hwnd: Hwnd, _param: isize) -> i32 {
        let defview = FindWindowExW(hwnd, 0, wide("SHELLDLL_DefView").as_ptr(), std::ptr::null());
        if defview != 0 {
            let list = FindWindowExW(defview, 0, wide("SysListView32").as_ptr(), std::ptr::null());
            if list != 0 {
                FOUND = list;
                return 0; // stop
            }
        }
        1
    }
    unsafe {
        FOUND = 0;
        EnumWindows(visit, 0);
        (FOUND != 0).then_some(FOUND)
    }
}

/// A scratch buffer inside another process, freed when it goes out of scope.
///
/// The list-view messages write their answers through a pointer, and that
/// pointer is dereferenced by explorer.exe — so it has to be explorer's memory,
/// not ours. Wrapping it in a type means an early return cannot leak it.
struct RemoteBuffer {
    process: isize,
    address: *mut core::ffi::c_void,
    size: usize,
}

impl RemoteBuffer {
    fn new(hwnd: Hwnd, size: usize) -> Option<Self> {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid == 0 {
            return None;
        }
        let process = unsafe {
            OpenProcess(
                PROCESS_VM_OPERATION
                    | PROCESS_VM_READ
                    | PROCESS_VM_WRITE
                    | PROCESS_QUERY_INFORMATION,
                0,
                pid,
            )
        };
        if process == 0 {
            return None;
        }
        let address = unsafe {
            VirtualAllocEx(
                process,
                std::ptr::null_mut(),
                size,
                MEM_COMMIT | MEM_RESERVE,
                PAGE_READWRITE,
            )
        };
        if address.is_null() {
            unsafe { CloseHandle(process) };
            return None;
        }
        Some(Self {
            process,
            address,
            size,
        })
    }

    fn write<T>(&self, value: &T) -> bool {
        let mut written = 0usize;
        let ok = unsafe {
            WriteProcessMemory(
                self.process,
                self.address,
                value as *const T as *const core::ffi::c_void,
                std::mem::size_of::<T>(),
                &mut written,
            )
        };
        ok != 0
    }

    fn read<T: Copy>(&self, offset: usize) -> Option<T> {
        let mut value = std::mem::MaybeUninit::<T>::uninit();
        let mut read = 0usize;
        let ok = unsafe {
            ReadProcessMemory(
                self.process,
                (self.address as usize + offset) as *const core::ffi::c_void,
                value.as_mut_ptr() as *mut core::ffi::c_void,
                std::mem::size_of::<T>(),
                &mut read,
            )
        };
        (ok != 0).then(|| unsafe { value.assume_init() })
    }

    fn read_wide(&self, offset: usize, chars: usize) -> Option<String> {
        let mut buf = vec![0u16; chars];
        let mut read = 0usize;
        let ok = unsafe {
            ReadProcessMemory(
                self.process,
                (self.address as usize + offset) as *const core::ffi::c_void,
                buf.as_mut_ptr() as *mut core::ffi::c_void,
                chars * 2,
                &mut read,
            )
        };
        if ok == 0 {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..end]))
    }

    fn offset_ptr(&self, offset: usize) -> *mut u16 {
        (self.address as usize + offset) as *mut u16
    }
}

impl Drop for RemoteBuffer {
    fn drop(&mut self) {
        unsafe {
            VirtualFreeEx(self.process, self.address, 0, MEM_RELEASE);
            CloseHandle(self.process);
        }
    }
}

const TEXT_CHARS: usize = 260;
/// Rect first, then the label buffer. One allocation rather than two.
const TEXT_OFFSET: usize = 64;

/// Everything actually sitting in the Desktop folders: `(file name, path, is_dir)`.
///
/// Read once per enumeration rather than probing per icon — the list-view has
/// roughly a hundred items and each probe would otherwise be two stat calls.
fn desktop_entries() -> Vec<(String, PathBuf, bool)> {
    let public = std::env::var("PUBLIC")
        .ok()
        .map(|p| PathBuf::from(p).join("Desktop"));
    let mut entries = Vec::new();
    for dir in [dirs::desktop_dir(), public].into_iter().flatten() {
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push((
                entry.file_name().to_string_lossy().into_owned(),
                entry.path(),
                is_dir,
            ));
        }
    }
    entries
}

/// Map an icon's label back to the file or folder it stands for.
///
/// Explorer hides known extensions by default, so the icon labelled `amazon` is
/// really `amazon.pdf`. Matching the label against the full name alone leaves
/// most files unresolved, which is why nearly every file on a real Desktop used
/// to come back with no path and no kind.
///
/// Matching the stem as well fixes that but creates a collision: a folder `Trip`
/// beside an archive `Trip.zip` yields two icons whose labels are identical, and
/// nothing in the list-view says which row is which. That case reports the kind
/// as unknown instead of picking one — describing the archive as the folder is
/// precisely the confident-but-wrong answer this module exists to prevent.
fn resolve_label(
    entries: &[(String, PathBuf, bool)],
    label: &str,
) -> (Option<String>, Option<bool>) {
    let wanted = label.to_lowercase();
    let hits: Vec<&(String, PathBuf, bool)> = entries
        .iter()
        .filter(|(name, path, _)| {
            name.to_lowercase() == wanted
                || path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_lowercase() == wanted)
                    .unwrap_or(false)
        })
        .collect();
    match hits.len() {
        0 => (None, None),
        1 => (
            Some(hits[0].1.to_string_lossy().into_owned()),
            Some(hits[0].2),
        ),
        _ => {
            // Which entry it is stays unknown; whether they agree on being
            // folders need not. `notes.txt` beside `notes.md` is still a file.
            let kind = hits[0].2;
            (None, hits.iter().all(|h| h.2 == kind).then_some(kind))
        }
    }
}

/// Every icon currently on the Desktop, with its on-screen rectangle.
pub fn enumerate_desktop_items() -> Result<Vec<DesktopItem>, String> {
    let list = find_desktop_listview().ok_or("Could not find the Desktop icon list.")?;
    let count = unsafe { SendMessageW(list, LVM_GETITEMCOUNT, 0, 0) };
    if count <= 0 {
        return Ok(Vec::new());
    }
    let buffer = RemoteBuffer::new(list, TEXT_OFFSET + TEXT_CHARS * 2)
        .ok_or("Could not read the Desktop icon list.")?;

    let entries = desktop_entries();

    let mut items = Vec::new();
    for index in 0..count as i32 {
        // Rectangle. `left` doubles as the input: it selects which part of the
        // item is wanted, and is overwritten with the answer.
        let request = Rect {
            left: LVIR_SELECTBOUNDS,
            ..Default::default()
        };
        if !buffer.write(&request) {
            continue;
        }
        let got = unsafe {
            SendMessageW(
                list,
                LVM_GETITEMRECT,
                index as usize,
                buffer.address as isize,
            )
        };
        if got == 0 {
            continue;
        }
        let Some(rect) = buffer.read::<Rect>(0) else {
            continue;
        };

        // Label.
        let item = LvItemW {
            mask: 0,
            item: index,
            sub_item: 0,
            state: 0,
            state_mask: 0,
            text: buffer.offset_ptr(TEXT_OFFSET),
            text_max: TEXT_CHARS as i32,
            image: 0,
            param: 0,
            indent: 0,
            group_id: 0,
            columns: 0,
            col_fmt: std::ptr::null_mut(),
            group: 0,
        };
        // The LVITEM itself must also live in explorer's memory, but it can
        // share the allocation: the rect has already been read back.
        let mut written = 0usize;
        let wrote = unsafe {
            WriteProcessMemory(
                buffer.process,
                buffer.address,
                &item as *const LvItemW as *const core::ffi::c_void,
                std::mem::size_of::<LvItemW>(),
                &mut written,
            )
        };
        if wrote == 0 {
            continue;
        }
        let len = unsafe {
            SendMessageW(
                list,
                LVM_GETITEMTEXTW,
                index as usize,
                buffer.address as isize,
            )
        };
        if len <= 0 {
            continue;
        }
        let Some(name) = buffer.read_wide(TEXT_OFFSET, TEXT_CHARS) else {
            continue;
        };
        if name.trim().is_empty() {
            continue;
        }

        // List-view rects are client-relative; the overlay draws on the virtual
        // desktop, so convert once here rather than everywhere downstream.
        let mut top_left = Point {
            x: rect.left,
            y: rect.top,
        };
        let mut bottom_right = Point {
            x: rect.right,
            y: rect.bottom,
        };
        unsafe {
            ClientToScreen(list, &mut top_left);
            ClientToScreen(list, &mut bottom_right);
        }

        // Resolve the real filesystem entry so "folder" is a fact rather than an
        // assumption from the icon.
        let (path, is_folder) = resolve_label(&entries, &name);

        items.push(DesktopItem {
            name,
            path,
            is_folder,
            bounds: PhysicalRect {
                x: top_left.x,
                y: top_left.y,
                width: bottom_right.x - top_left.x,
                height: bottom_right.y - top_left.y,
            },
            source: DesktopItemSource::ShellListView,
        });
    }
    Ok(items)
}

/// Pick the item the user meant, or refuse.
///
/// Exact name wins over a prefix, a prefix over a substring. Ambiguity is
/// returned as ambiguity: two folders both starting with "book" is a question,
/// not a coin flip, and drawing a border round the wrong one looks identical to
/// drawing it round the right one.
pub fn match_item<'a>(
    items: &'a [DesktopItem],
    name: &str,
    kind: DesktopItemKind,
) -> Result<&'a DesktopItem, MatchFailure> {
    let wanted = name.trim().to_lowercase();
    if wanted.is_empty() {
        return Err(MatchFailure::NotFound);
    }
    let eligible: Vec<&DesktopItem> = items
        .iter()
        // An item of unknown kind stays eligible for either query. Excluding it
        // would turn "I can't tell these two apart" into a silent pick of the
        // other one, which is the failure mode being designed out.
        .filter(|i| match kind {
            DesktopItemKind::Folder => i.is_folder != Some(false),
            DesktopItemKind::File => i.is_folder != Some(true),
            DesktopItemKind::Any => true,
        })
        .collect();

    for tier in 0..3 {
        let hits: Vec<&&DesktopItem> = eligible
            .iter()
            .filter(|i| {
                let label = i.name.to_lowercase();
                match tier {
                    0 => label == wanted,
                    // "books" typed as "book", or a folder shown with its
                    // extension hidden.
                    1 => label.starts_with(&wanted) || wanted.starts_with(&label),
                    _ => label.contains(&wanted),
                }
            })
            .collect();
        match hits.len() {
            0 => continue,
            1 => return Ok(hits[0]),
            _ => {
                return Err(MatchFailure::Ambiguous(
                    hits.iter().map(|i| i.name.clone()).collect(),
                ))
            }
        }
    }
    Err(MatchFailure::NotFound)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchFailure {
    NotFound,
    Ambiguous(Vec<String>),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FindItemArgs {
    pub name: String,
    #[serde(default)]
    pub kind: Option<String>,
}

pub fn find_item(args: FindItemArgs) -> ToolResult {
    let rb = ResultBuilder::new("desktop.find_item");
    let kind = match args.kind.as_deref() {
        Some("folder") => DesktopItemKind::Folder,
        Some("file") => DesktopItemKind::File,
        _ => DesktopItemKind::Any,
    };
    let items = match enumerate_desktop_items() {
        Ok(i) => i,
        Err(e) => return rb.error("desktop-unavailable", e, true),
    };
    match match_item(&items, &args.name, kind) {
        Ok(item) => rb.success(
            format!(
                "\"{}\" is on the Desktop at ({}, {}).",
                item.name, item.bounds.x, item.bounds.y
            ),
            json!({
                "found": true,
                "name": item.name,
                "path": item.path,
                "is_folder": item.is_folder,
                "bounds": item.bounds,
                "source": item.source,
                "desktop_item_count": items.len(),
            }),
            VerificationEvidence::verified_with(
                "state-readback",
                json!({ "source": "shell-list-view" }),
            ),
        ),
        Err(MatchFailure::Ambiguous(names)) => rb.needs_confirmation(
            format!(
                "There are {} Desktop items matching \"{}\". Which one?",
                names.len(),
                args.name
            ),
            json!({
                "reason": "ambiguous",
                "candidates": names.iter().map(|n| json!({ "id": n, "label": n })).collect::<Vec<_>>(),
            }),
        ),
        Err(MatchFailure::NotFound) => rb.not_found(format!(
            "Nothing on the Desktop is called \"{}\".",
            args.name
        )),
    }
}

/// Every Desktop icon and its rectangle.
///
/// Exists so a vision answer can be checked against what is actually on the
/// Desktop: a box said to be one icon that in fact covers four is only
/// detectable if the real icon rectangles are known.
pub fn list_items() -> ToolResult {
    let rb = ResultBuilder::new("desktop.list_items");
    match enumerate_desktop_items() {
        Ok(items) => rb.success(
            format!("{} item(s) on the Desktop.", items.len()),
            json!({ "items": items, "count": items.len() }),
            VerificationEvidence::verified_with(
                "state-readback",
                json!({ "source": "shell-list-view" }),
            ),
        ),
        Err(e) => rb.error("desktop-unavailable", e, true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(name: &str, folder: bool, x: i32, y: i32) -> DesktopItem {
        DesktopItem {
            name: name.into(),
            path: Some(format!("C:/Users/x/Desktop/{name}")),
            is_folder: Some(folder),
            bounds: PhysicalRect {
                x,
                y,
                width: 80,
                height: 90,
            },
            source: DesktopItemSource::ShellListView,
        }
    }

    /// The Desktop from the failing report: the border covered four of these.
    fn desktop() -> Vec<DesktopItem> {
        vec![
            item("File", false, 20, 20),
            item("New folder", true, 20, 130),
            item("ridetrip.txt", false, 20, 240),
            item("Trip", true, 20, 350),
            item("books", true, 20, 780),
            item("ArcSonare", true, 120, 20),
        ]
    }

    #[test]
    fn the_books_folder_matches_exactly_one_item() {
        let items = desktop();
        let found = match_item(&items, "books", DesktopItemKind::Folder).unwrap();
        assert_eq!(found.name, "books");
        assert_eq!(found.is_folder, Some(true));
    }

    #[test]
    fn matching_ignores_case() {
        let items = desktop();
        assert_eq!(
            match_item(&items, "BOOKS", DesktopItemKind::Any)
                .unwrap()
                .name,
            "books"
        );
        assert_eq!(
            match_item(&items, "  Books  ", DesktopItemKind::Any)
                .unwrap()
                .name,
            "books"
        );
    }

    #[test]
    fn the_answer_is_one_icon_not_a_region_of_them() {
        // The actual failure: a rectangle covering File, New folder, ridetrip
        // and Trip. A per-item rectangle cannot express that.
        let items = desktop();
        let found = match_item(&items, "books", DesktopItemKind::Folder).unwrap();
        let others: Vec<&DesktopItem> = items.iter().filter(|i| i.name != "books").collect();
        for other in others {
            let (cx, cy) = other.bounds.center();
            assert!(
                !found.bounds.contains(cx, cy),
                "the books rectangle swallowed {}",
                other.name
            );
        }
    }

    #[test]
    fn a_folder_query_does_not_return_a_file() {
        let items = desktop();
        // "ridetrip.txt" contains "trip", but the folder "Trip" is the folder.
        let found = match_item(&items, "trip", DesktopItemKind::Folder).unwrap();
        assert_eq!(found.name, "Trip");
        assert_eq!(found.is_folder, Some(true));
    }

    #[test]
    fn an_exact_name_beats_a_longer_one_that_contains_it() {
        let items = vec![
            item("book", true, 0, 0),
            item("books archive", true, 0, 100),
        ];
        assert_eq!(
            match_item(&items, "book", DesktopItemKind::Any)
                .unwrap()
                .name,
            "book"
        );
    }

    #[test]
    fn two_equally_good_matches_are_a_question_not_a_guess() {
        // Drawing a border round the wrong one looks exactly like drawing it
        // round the right one, so this must never be resolved silently.
        let items = vec![
            item("books 2023", true, 0, 0),
            item("books 2024", true, 0, 100),
        ];
        assert_eq!(
            match_item(&items, "books", DesktopItemKind::Any).unwrap_err(),
            MatchFailure::Ambiguous(vec!["books 2023".into(), "books 2024".into()])
        );
    }

    #[test]
    fn something_that_is_not_there_is_reported_as_missing() {
        assert_eq!(
            match_item(&desktop(), "quarterly report", DesktopItemKind::Any).unwrap_err(),
            MatchFailure::NotFound
        );
    }

    #[test]
    fn an_empty_query_matches_nothing() {
        assert_eq!(
            match_item(&desktop(), "   ", DesktopItemKind::Any).unwrap_err(),
            MatchFailure::NotFound
        );
    }

    /// Explorer hides known extensions, so `Trip` and `Trip.zip` draw two icons
    /// captioned identically. The list-view cannot say which row is which.
    #[test]
    fn a_folder_and_a_same_named_archive_are_not_told_apart_by_guessing() {
        let entries = vec![
            ("Trip".to_string(), PathBuf::from("C:/Desktop/Trip"), true),
            (
                "Trip.zip".to_string(),
                PathBuf::from("C:/Desktop/Trip.zip"),
                false,
            ),
        ];
        let (path, kind) = resolve_label(&entries, "Trip");
        assert_eq!(path, None, "neither entry may be claimed as the answer");
        assert_eq!(
            kind, None,
            "the archive must not be described as the folder"
        );
    }

    #[test]
    fn a_hidden_extension_still_resolves_to_its_file() {
        let entries = vec![(
            "amazon.pdf".to_string(),
            PathBuf::from("C:/Desktop/amazon.pdf"),
            false,
        )];
        let (path, kind) = resolve_label(&entries, "amazon");
        assert_eq!(path.as_deref(), Some("C:/Desktop/amazon.pdf"));
        assert_eq!(kind, Some(false));
    }

    /// Two files sharing a stem leave the path unknown but the kind certain.
    #[test]
    fn same_stem_files_are_still_known_to_be_files() {
        let entries = vec![
            (
                "notes.txt".to_string(),
                PathBuf::from("C:/Desktop/notes.txt"),
                false,
            ),
            (
                "notes.md".to_string(),
                PathBuf::from("C:/Desktop/notes.md"),
                false,
            ),
        ];
        assert_eq!(resolve_label(&entries, "notes"), (None, Some(false)));
    }

    /// An unknown kind is a question, not permission to pick the other one.
    #[test]
    fn an_unknown_kind_makes_a_folder_query_ambiguous_rather_than_wrong() {
        let mut folder = item("Trip", true, 0, 0);
        folder.is_folder = None;
        let mut archive = item("Trip", false, 0, 100);
        archive.is_folder = None;
        let items = vec![folder, archive];
        assert!(matches!(
            match_item(&items, "Trip", DesktopItemKind::Folder),
            Err(MatchFailure::Ambiguous(_))
        ));
    }

    #[test]
    fn a_rectangle_knows_its_own_centre_and_extent() {
        let r = PhysicalRect {
            x: -1080,
            y: -661,
            width: 80,
            height: 90,
        };
        assert_eq!(r.center(), (-1040, -616));
        assert!(r.contains(-1040, -616));
        assert!(!r.contains(-1000, -616), "the right edge is exclusive");
    }
}
