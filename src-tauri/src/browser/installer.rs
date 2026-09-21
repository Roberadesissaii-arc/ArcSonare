//! What a downloaded file is, and what running it would mean.
//!
//! The brief's rule is that the question belongs at the *elevation boundary*,
//! not before it. That only works if the boundary can be found before it is
//! crossed — otherwise "ask once, at the right moment" degrades into asking
//! before the download just in case, which is the behaviour being removed.
//!
//! So this module answers three things about a file on disk:
//!
//!   - what kind of installer it is (MSI, NSIS, Inno, MSIX, plain executable);
//!   - who signed it, and whether the signature verifies;
//!   - whether running it will almost certainly raise UAC.
//!
//! And afterwards, one more: whether the thing actually installed. "The
//! installer process exited" is the claim this replaces — it is true of a user
//! pressing Cancel, of a failed install, and of an installer that wrote nothing.
//!
//! Nothing here bypasses anything. There is no SmartScreen suppression, no
//! silent-install flag applied on ArcSonare's initiative, no unsigned binary
//! promoted to trusted. Where a warning exists, the user sees it.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// What sort of installer a file is.
///
/// Read from the file's own bytes, not from its extension: an `.exe` can be a
/// self-extracting archive, an NSIS installer, an Inno Setup installer or a
/// plain program, and they behave differently enough that guessing is worse
/// than saying "unknown".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallerKind {
    /// Windows Installer package.
    Msi,
    /// Modern packaged app. Installs per-user without elevation.
    Msix,
    /// NSIS — the most common .exe installer.
    Nsis,
    /// Inno Setup.
    InnoSetup,
    /// A PE executable that is not a recognised installer.
    Executable,
    /// An archive. Nothing to run until it is extracted.
    Archive,
    Unknown,
}

impl InstallerKind {
    /// Whether running this normally triggers UAC.
    ///
    /// MSIX is the interesting case: it installs per-user through the platform
    /// and does not elevate, so treating every installer as elevated would put
    /// a prompt in front of something that never needed one.
    pub fn usually_elevates(self) -> bool {
        matches!(self, Self::Msi | Self::Nsis | Self::InnoSetup | Self::Executable)
    }

    pub fn describe(self) -> &'static str {
        match self {
            Self::Msi => "a Windows Installer package",
            Self::Msix => "a packaged Windows app",
            Self::Nsis => "an NSIS installer",
            Self::InnoSetup => "an Inno Setup installer",
            Self::Executable => "a Windows program",
            Self::Archive => "an archive",
            Self::Unknown => "an unrecognised file",
        }
    }
}

/// Whether the file carries a valid Authenticode signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SignatureStatus {
    /// Signed, and the chain verified.
    Trusted { publisher: String },
    /// Signed, but the signature does not verify — expired, revoked, tampered.
    /// Materially worse than unsigned, and reported differently.
    Untrusted { publisher: Option<String>, reason: String },
    /// No signature at all.
    Unsigned,
    /// The check could not run. Not the same as "unsigned", and must never be
    /// reported as either trusted or untrusted.
    Unknown { reason: String },
}

impl SignatureStatus {
    pub fn publisher(&self) -> Option<&str> {
        match self {
            Self::Trusted { publisher } => Some(publisher),
            Self::Untrusted { publisher, .. } => publisher.as_deref(),
            _ => None,
        }
    }

    /// Whether this may run without an extra warning of ArcSonare's own.
    ///
    /// Only a verified signature qualifies. Windows will show its own warning
    /// for the rest, and that warning is not ArcSonare's to suppress.
    pub fn is_trusted(&self) -> bool {
        matches!(self, Self::Trusted { .. })
    }

    /// The sentence shown at the approval boundary.
    pub fn describe(&self) -> String {
        match self {
            Self::Trusted { publisher } => format!("signed by {publisher}"),
            Self::Untrusted { publisher, reason } => match publisher {
                Some(p) => format!("signed by {p}, but the signature doesn't verify ({reason})"),
                None => format!("carrying a signature that doesn't verify ({reason})"),
            },
            Self::Unsigned => "not signed by a verified publisher".to_string(),
            Self::Unknown { reason } => {
                format!("of unverified origin — I couldn't check the signature ({reason})")
            }
        }
    }
}

/// Everything known about a downloaded installer before it runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerInspection {
    pub path: PathBuf,
    pub file_name: String,
    pub byte_size: u64,
    pub kind: InstallerKind,
    pub signature: SignatureStatus,
    /// Whether running this is expected to raise UAC.
    pub likely_elevates: bool,
}

impl InstallerInspection {
    /// The one question the user is asked, at the boundary that needs it.
    ///
    /// Everything before this — reaching the site, choosing the link, the
    /// download itself, inspecting the file — happens without asking. This is
    /// the sentence that replaces six of them.
    pub fn approval_prompt(&self, product: &str) -> String {
        let mut s = format!(
            "{product} has finished downloading. The installer is {}, {}.",
            self.kind.describe(),
            self.signature.describe(),
        );
        if self.likely_elevates {
            s.push_str(" Installing it will ask for Windows administrator permission.");
        }
        if !self.signature.is_trusted() {
            s.push_str(" Windows may warn about it, and I won't dismiss that warning for you.");
        }
        s
    }
}

/// Read the first bytes of a file and say what kind of installer it is.
pub fn classify(path: &Path) -> InstallerKind {
    let Ok(bytes) = read_prefix(path, 4096) else {
        return InstallerKind::Unknown;
    };
    classify_bytes(&bytes, path)
}

/// Classification from bytes, so it is testable without producing real
/// installers.
pub fn classify_bytes(bytes: &[u8], path: &Path) -> InstallerKind {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    // Compound File Binary header — MSI and friends.
    const CFB: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if bytes.starts_with(CFB) {
        return InstallerKind::Msi;
    }
    // Zip container. MSIX/APPX are zips; so are ordinary archives, and the
    // extension is what distinguishes them.
    if bytes.starts_with(b"PK\x03\x04") {
        return match ext.as_str() {
            "msix" | "appx" | "msixbundle" | "appxbundle" => InstallerKind::Msix,
            _ => InstallerKind::Archive,
        };
    }
    if bytes.starts_with(b"MZ") {
        // Installer families identify themselves in the PE body.
        let window = &bytes[..bytes.len().min(4096)];
        if find(window, b"Nullsoft").is_some() {
            return InstallerKind::Nsis;
        }
        if find(window, b"Inno Setup").is_some() || find(window, b"JR.Inno").is_some() {
            return InstallerKind::InnoSetup;
        }
        return InstallerKind::Executable;
    }
    if ext == "msi" {
        return InstallerKind::Msi;
    }
    if matches!(ext.as_str(), "zip" | "7z" | "rar" | "gz" | "xz") {
        return InstallerKind::Archive;
    }
    InstallerKind::Unknown
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn read_prefix(path: &Path, n: usize) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut buf = vec![0u8; n];
    let read = file.read(&mut buf)?;
    buf.truncate(read);
    Ok(buf)
}

/// Verify a file's Authenticode signature.
///
/// `WinVerifyTrust` with the standard policy — the same check Explorer's
/// Properties → Digital Signatures tab performs. It is deliberately the real
/// API rather than a heuristic: a claim that a file is "signed by LightBurn
/// Software" has to be a checked fact or it is worse than saying nothing.
#[cfg(windows)]
pub fn verify_signature(path: &Path) -> SignatureStatus {
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct WinTrustFileInfo {
        cb_struct: u32,
        pcwsz_file_path: *const u16,
        h_file: isize,
        pgKnownSubject: *const std::ffi::c_void,
    }
    #[repr(C)]
    struct WinTrustData {
        cb_struct: u32,
        p_policy_callback_data: *mut std::ffi::c_void,
        p_sip_client_data: *mut std::ffi::c_void,
        dw_ui_choice: u32,
        fdw_revocation_checks: u32,
        dw_union_choice: u32,
        p_file: *mut WinTrustFileInfo,
        dw_state_action: u32,
        h_wvt_state_data: isize,
        pwsz_url_reference: *mut u16,
        dw_prov_flags: u32,
        dw_ui_context: u32,
        p_signature_settings: *mut std::ffi::c_void,
    }

    #[link(name = "wintrust")]
    extern "system" {
        fn WinVerifyTrust(hwnd: isize, pgActionID: *const [u8; 16], pWVTData: *mut std::ffi::c_void)
            -> i32;
    }

    // WINTRUST_ACTION_GENERIC_VERIFY_V2
    const ACTION: [u8; 16] = [
        0xC6, 0xB2, 0xE8, 0x00, 0xE7, 0x66, 0xD2, 0x11, 0x9F, 0xCB, 0x00, 0xC0, 0x4F, 0xC2, 0x95,
        0xEE,
    ];
    const WTD_UI_NONE: u32 = 2;
    const WTD_REVOKE_NONE: u32 = 0;
    const WTD_CHOICE_FILE: u32 = 1;
    const WTD_STATEACTION_VERIFY: u32 = 1;
    const WTD_STATEACTION_CLOSE: u32 = 2;
    const WTD_SAFER_FLAG: u32 = 0x100;
    const TRUST_E_NOSIGNATURE: i32 = -2146762496; // 0x800B0100

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut file_info = WinTrustFileInfo {
        cb_struct: std::mem::size_of::<WinTrustFileInfo>() as u32,
        pcwsz_file_path: wide.as_ptr(),
        h_file: 0,
        pgKnownSubject: std::ptr::null(),
    };
    let mut data = WinTrustData {
        cb_struct: std::mem::size_of::<WinTrustData>() as u32,
        p_policy_callback_data: std::ptr::null_mut(),
        p_sip_client_data: std::ptr::null_mut(),
        // No UI: this is an inspection, not the moment the user is asked.
        // Windows still shows its own warnings when the installer runs.
        dw_ui_choice: WTD_UI_NONE,
        fdw_revocation_checks: WTD_REVOKE_NONE,
        dw_union_choice: WTD_CHOICE_FILE,
        p_file: &mut file_info,
        dw_state_action: WTD_STATEACTION_VERIFY,
        h_wvt_state_data: 0,
        pwsz_url_reference: std::ptr::null_mut(),
        dw_prov_flags: WTD_SAFER_FLAG,
        dw_ui_context: 0,
        p_signature_settings: std::ptr::null_mut(),
    };

    let status = unsafe {
        WinVerifyTrust(
            0,
            &ACTION,
            &mut data as *mut WinTrustData as *mut std::ffi::c_void,
        )
    };
    // Always closed, whatever the verdict — the state handle is a real
    // allocation and leaking one per inspection is how this becomes a leak.
    data.dw_state_action = WTD_STATEACTION_CLOSE;
    unsafe {
        WinVerifyTrust(
            0,
            &ACTION,
            &mut data as *mut WinTrustData as *mut std::ffi::c_void,
        );
    }

    match status {
        0 => match publisher_of(path) {
            Some(publisher) => SignatureStatus::Trusted { publisher },
            // Verified but the subject could not be read. Reported as unknown
            // rather than trusted-with-a-blank-name, because the name is the
            // part the user is being asked to rely on.
            None => SignatureStatus::Unknown {
                reason: "the signature verified but the publisher name could not be read".into(),
            },
        },
        TRUST_E_NOSIGNATURE => SignatureStatus::Unsigned,
        other => SignatureStatus::Untrusted {
            publisher: publisher_of(path),
            reason: format!("Windows reported 0x{:08X}", other as u32),
        },
    }
}

#[cfg(not(windows))]
pub fn verify_signature(_path: &Path) -> SignatureStatus {
    SignatureStatus::Unknown {
        reason: "signature verification is only available on Windows".into(),
    }
}

/// Read the signing subject's common name.
#[cfg(windows)]
fn publisher_of(path: &Path) -> Option<String> {
    // Read from the certificate via PowerShell's Authenticode cmdlet rather
    // than hand-rolling CMS parsing: the verdict above already came from
    // `WinVerifyTrust`, so this only supplies a display name, and a wrong
    // display name cannot promote an untrusted file to trusted.
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "(Get-AuthenticodeSignature -LiteralPath '{}').SignerCertificate.Subject",
                path.display().to_string().replace('\'', "''")
            ),
        ])
        .output()
        .ok()?;
    let subject = String::from_utf8_lossy(&output.stdout);
    common_name_of(subject.trim())
}

#[cfg(not(windows))]
fn publisher_of(_path: &Path) -> Option<String> {
    None
}

/// Pull `CN=` out of an X.500 subject.
pub fn common_name_of(subject: &str) -> Option<String> {
    if subject.is_empty() {
        return None;
    }
    for part in subject.split(',') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("CN=") {
            let name = rest.trim().trim_matches('"');
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Inspect a downloaded file.
pub fn inspect(path: &Path) -> Result<InstallerInspection, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Could not read \"{}\": {e}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("\"{}\" is not a file.", path.display()));
    }
    let kind = classify(path);
    let signature = verify_signature(path);
    Ok(InstallerInspection {
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        byte_size: metadata.len(),
        likely_elevates: kind.usually_elevates(),
        kind,
        signature,
        path: path.to_path_buf(),
    })
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/// Evidence that something is actually installed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApplication {
    pub display_name: String,
    #[serde(default)]
    pub display_version: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub install_location: Option<String>,
    /// Which registry view it was found in, so the claim can be retraced.
    pub source: String,
}

/// How an installation ended.
///
/// `ProcessExited` is deliberately not a success. It is what the old code
/// reported, and it is true when the user pressed Cancel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum InstallOutcome {
    /// Found in the installed-applications registry afterwards, and not before.
    Installed { application: InstalledApplication },
    /// The installer ran and exited, but nothing new is registered. Usually a
    /// cancelled install.
    NotInstalled { exit_code: Option<i32> },
    /// It was already installed before this ran, so this proves nothing about
    /// what just happened.
    AlreadyPresent { application: InstalledApplication },
    /// The installer is still running, or a window is still open.
    StillRunning,
}

impl InstallOutcome {
    /// The sentence the user gets. Only the first variant may claim success.
    pub fn describe(&self, product: &str) -> String {
        match self {
            Self::Installed { application } => {
                let version = application
                    .display_version
                    .as_deref()
                    .map(|v| format!(" {v}"))
                    .unwrap_or_default();
                format!("{}{version} installed successfully.", application.display_name)
            }
            Self::NotInstalled { exit_code } => match exit_code {
                Some(code) if *code != 0 => format!(
                    "The {product} installer exited with code {code} and {product} is not \
                     installed."
                ),
                _ => format!(
                    "The {product} installer closed without installing anything — it looks like \
                     it was cancelled."
                ),
            },
            Self::AlreadyPresent { application } => format!(
                "{} was already installed before this ran, so I can't say the install did \
                 anything.",
                application.display_name
            ),
            Self::StillRunning => {
                format!("The {product} installer is still open.")
            }
        }
    }

    pub fn is_success(&self) -> bool {
        matches!(self, Self::Installed { .. })
    }
}

/// Decide the outcome from before/after evidence.
///
/// Separated from the registry reading so the rule — what counts as installed —
/// is testable without installing anything.
pub fn conclude(
    before: &[InstalledApplication],
    after: &[InstalledApplication],
    product: &str,
    exit_code: Option<i32>,
    still_running: bool,
) -> InstallOutcome {
    if still_running {
        return InstallOutcome::StillRunning;
    }
    let matches_product = |app: &InstalledApplication| {
        let name = app.display_name.to_lowercase();
        let p = product.to_lowercase();
        !p.is_empty() && name.contains(&p)
    };

    let was_there = before.iter().find(|a| matches_product(a));
    let is_there = after.iter().find(|a| matches_product(a));

    match (was_there, is_there) {
        // New, or upgraded to a different version. Both are a real install.
        (None, Some(now)) => InstallOutcome::Installed {
            application: now.clone(),
        },
        (Some(then), Some(now)) if then.display_version != now.display_version => {
            InstallOutcome::Installed {
                application: now.clone(),
            }
        }
        (Some(then), Some(_)) => InstallOutcome::AlreadyPresent {
            application: then.clone(),
        },
        _ => InstallOutcome::NotInstalled { exit_code },
    }
}

/// Read the installed-applications registry.
#[cfg(windows)]
pub fn installed_applications() -> Vec<InstalledApplication> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut out = Vec::new();
    // Machine-wide 64-bit, machine-wide 32-bit, and per-user. An installer that
    // does not elevate writes only to the third, so omitting it would report a
    // successful per-user install as a failure.
    let sources: [(&str, isize, &str); 3] = [
        (
            "HKLM\\...\\Uninstall",
            HKEY_LOCAL_MACHINE as isize,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            "HKLM\\...\\WOW6432Node\\Uninstall",
            HKEY_LOCAL_MACHINE as isize,
            "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            "HKCU\\...\\Uninstall",
            HKEY_CURRENT_USER as isize,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
    ];

    for (label, hive, path) in sources {
        let root = RegKey::predef(hive as winreg::HKEY);
        let Ok(uninstall) = root.open_subkey(path) else {
            continue;
        };
        for name in uninstall.enum_keys().flatten() {
            let Ok(entry) = uninstall.open_subkey(&name) else {
                continue;
            };
            let Ok(display_name) = entry.get_value::<String, _>("DisplayName") else {
                continue;
            };
            if display_name.trim().is_empty() {
                continue;
            }
            // System components and updates are not applications the user
            // installed, and listing them makes the "was it there before?"
            // comparison noisy.
            if entry.get_value::<u32, _>("SystemComponent").unwrap_or(0) == 1 {
                continue;
            }
            out.push(InstalledApplication {
                display_name,
                display_version: entry.get_value("DisplayVersion").ok(),
                publisher: entry.get_value("Publisher").ok(),
                install_location: entry.get_value("InstallLocation").ok(),
                source: label.to_string(),
            });
        }
    }
    out
}

#[cfg(not(windows))]
pub fn installed_applications() -> Vec<InstalledApplication> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, version: Option<&str>) -> InstalledApplication {
        InstalledApplication {
            display_name: name.into(),
            display_version: version.map(str::to_string),
            publisher: Some("LightBurn Software, LLC".into()),
            install_location: None,
            source: "HKLM\\...\\Uninstall".into(),
        }
    }

    // --- classification ---------------------------------------------------

    #[test]
    fn an_msi_is_recognised_from_its_header() {
        let cfb = [0xD0u8, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0];
        assert_eq!(classify_bytes(&cfb, Path::new("x.msi")), InstallerKind::Msi);
    }

    #[test]
    fn an_nsis_installer_is_told_apart_from_a_plain_exe() {
        let mut nsis = b"MZ".to_vec();
        nsis.extend_from_slice(&[0u8; 200]);
        nsis.extend_from_slice(b"Nullsoft Install System v3.08");
        assert_eq!(classify_bytes(&nsis, Path::new("setup.exe")), InstallerKind::Nsis);

        let mut plain = b"MZ".to_vec();
        plain.extend_from_slice(&[0u8; 400]);
        assert_eq!(
            classify_bytes(&plain, Path::new("tool.exe")),
            InstallerKind::Executable,
        );
    }

    #[test]
    fn inno_setup_is_recognised() {
        let mut inno = b"MZ".to_vec();
        inno.extend_from_slice(&[0u8; 100]);
        inno.extend_from_slice(b"Inno Setup Setup Data (6.2.0)");
        assert_eq!(classify_bytes(&inno, Path::new("s.exe")), InstallerKind::InnoSetup);
    }

    /// A zip is a zip; the extension is what makes it an app package.
    #[test]
    fn msix_and_ordinary_zips_are_distinguished() {
        let zip = b"PK\x03\x04rest";
        assert_eq!(classify_bytes(zip, Path::new("app.msix")), InstallerKind::Msix);
        assert_eq!(classify_bytes(zip, Path::new("photos.zip")), InstallerKind::Archive);
    }

    /// The elevation boundary is per kind, and MSIX genuinely does not cross it.
    #[test]
    fn only_the_kinds_that_elevate_are_marked_as_elevating() {
        assert!(InstallerKind::Msi.usually_elevates());
        assert!(InstallerKind::Nsis.usually_elevates());
        assert!(InstallerKind::InnoSetup.usually_elevates());
        assert!(InstallerKind::Executable.usually_elevates());
        assert!(!InstallerKind::Msix.usually_elevates());
        assert!(!InstallerKind::Archive.usually_elevates());
    }

    // --- signature reporting ----------------------------------------------

    #[test]
    fn only_a_verified_signature_counts_as_trusted() {
        assert!(SignatureStatus::Trusted {
            publisher: "LightBurn Software, LLC".into()
        }
        .is_trusted());
        assert!(!SignatureStatus::Unsigned.is_trusted());
        assert!(!SignatureStatus::Untrusted {
            publisher: Some("X".into()),
            reason: "expired".into()
        }
        .is_trusted());
        assert!(!SignatureStatus::Unknown {
            reason: "could not check".into()
        }
        .is_trusted());
    }

    /// "I couldn't check" must never be rendered as "unsigned" or as "signed".
    #[test]
    fn an_unchecked_signature_says_so() {
        let s = SignatureStatus::Unknown {
            reason: "wintrust unavailable".into(),
        };
        let text = s.describe();
        assert!(text.contains("couldn't check"), "{text}");
        assert!(!text.contains("signed by"), "{text}");
    }

    #[test]
    fn a_broken_signature_is_reported_as_worse_than_unsigned() {
        let s = SignatureStatus::Untrusted {
            publisher: Some("Acme".into()),
            reason: "certificate expired".into(),
        };
        assert!(s.describe().contains("doesn't verify"));
    }

    #[test]
    fn the_publisher_common_name_is_extracted() {
        assert_eq!(
            common_name_of("CN=LightBurn Software, LLC, O=LightBurn, C=US").as_deref(),
            Some("LightBurn Software"),
        );
        assert_eq!(common_name_of("O=NoCommonName, C=US"), None);
        assert_eq!(common_name_of(""), None);
    }

    // --- the approval sentence --------------------------------------------

    /// One prompt, at the elevation boundary, naming the publisher.
    #[test]
    fn the_approval_prompt_names_the_publisher_and_the_elevation() {
        let inspection = InstallerInspection {
            path: PathBuf::from("C:\\Users\\rober\\Downloads\\LightBurn-1.7.08.exe"),
            file_name: "LightBurn-1.7.08.exe".into(),
            byte_size: 92_000_000,
            kind: InstallerKind::Nsis,
            signature: SignatureStatus::Trusted {
                publisher: "LightBurn Software, LLC".into(),
            },
            likely_elevates: true,
        };
        let prompt = inspection.approval_prompt("LightBurn");
        assert!(prompt.contains("LightBurn Software, LLC"), "{prompt}");
        assert!(prompt.contains("administrator permission"), "{prompt}");
        // Nothing is promised about dismissing warnings, because it is trusted.
        assert!(!prompt.contains("won't dismiss"), "{prompt}");
    }

    /// An unsigned installer says plainly that Windows will warn and that
    /// ArcSonare will not click through it.
    #[test]
    fn an_unsigned_installer_promises_no_bypass() {
        let inspection = InstallerInspection {
            path: PathBuf::from("C:\\x\\thing.exe"),
            file_name: "thing.exe".into(),
            byte_size: 100,
            kind: InstallerKind::Executable,
            signature: SignatureStatus::Unsigned,
            likely_elevates: true,
        };
        let prompt = inspection.approval_prompt("Thing");
        assert!(prompt.contains("not signed"), "{prompt}");
        assert!(prompt.contains("won't dismiss that warning"), "{prompt}");
    }

    /// An MSIX does not claim an administrator prompt it will not produce.
    #[test]
    fn a_package_that_does_not_elevate_does_not_mention_uac() {
        let inspection = InstallerInspection {
            path: PathBuf::from("C:\\x\\app.msix"),
            file_name: "app.msix".into(),
            byte_size: 100,
            kind: InstallerKind::Msix,
            signature: SignatureStatus::Trusted {
                publisher: "Contoso".into(),
            },
            likely_elevates: false,
        };
        assert!(!inspection.approval_prompt("App").contains("administrator"));
    }

    // --- outcome ----------------------------------------------------------

    /// The claim being replaced: "the installer exited, therefore it installed".
    #[test]
    fn a_cancelled_install_is_not_a_success() {
        let before = vec![app("Notepad++", Some("8.6"))];
        let after = before.clone();
        let outcome = conclude(&before, &after, "LightBurn", Some(0), false);
        assert_eq!(outcome, InstallOutcome::NotInstalled { exit_code: Some(0) });
        assert!(!outcome.is_success());
        assert!(outcome.describe("LightBurn").contains("cancelled"));
    }

    #[test]
    fn a_real_install_is_a_success() {
        let before = vec![app("Notepad++", Some("8.6"))];
        let after = vec![app("Notepad++", Some("8.6")), app("LightBurn", Some("1.7.08"))];
        let outcome = conclude(&before, &after, "LightBurn", Some(0), false);
        assert!(outcome.is_success());
        assert!(outcome.describe("LightBurn").contains("1.7.08"));
    }

    /// Something already installed is not evidence that this install worked.
    #[test]
    fn an_already_installed_application_is_not_claimed_as_a_new_install() {
        let before = vec![app("LightBurn", Some("1.7.08"))];
        let after = before.clone();
        let outcome = conclude(&before, &after, "LightBurn", Some(0), false);
        assert!(!outcome.is_success());
        assert!(outcome.describe("LightBurn").contains("already installed"));
    }

    #[test]
    fn an_upgrade_counts_as_an_install() {
        let before = vec![app("LightBurn", Some("1.6.00"))];
        let after = vec![app("LightBurn", Some("1.7.08"))];
        assert!(conclude(&before, &after, "LightBurn", Some(0), false).is_success());
    }

    #[test]
    fn an_installer_still_on_screen_is_not_concluded_either_way() {
        let outcome = conclude(&[], &[], "LightBurn", None, true);
        assert_eq!(outcome, InstallOutcome::StillRunning);
        assert!(!outcome.is_success());
    }

    #[test]
    fn a_failing_exit_code_is_reported_with_its_code() {
        let outcome = conclude(&[], &[], "LightBurn", Some(1603), false);
        assert!(outcome.describe("LightBurn").contains("1603"));
    }

    /// Reading the machine's own registry must not panic, whatever is in it.
    #[test]
    fn reading_installed_applications_is_safe() {
        let apps = installed_applications();
        for a in &apps {
            assert!(!a.display_name.trim().is_empty());
        }
    }
}
