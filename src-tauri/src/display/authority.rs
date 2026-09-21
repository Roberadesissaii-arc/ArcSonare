//! Permission to act, as a value.
//!
//! The profile gate is correct today, and the recorded-side-effect tests prove
//! it. What they cannot prove is that it will still be correct after the *next*
//! visual command is written. Twice already a second path existed that nobody
//! had traced — `interaction/executor.rs` and `agent_highlight.rs` both reached
//! the overlay without passing the gate, and both were found by audit rather
//! than by anything failing.
//!
//! So the gate stops returning advice and starts returning a capability.
//! `VisualExecutionAuthority` can only be minted inside `display`, and the only
//! thing that mints one is the gate. Its fields are private, so a caller cannot
//! assemble one. `AuthorizedPoint` and `AuthorizedRect` can only be obtained by
//! asking an authority to vouch for a coordinate — and the side-effect trait now
//! takes nothing else.
//!
//! The consequence is that a future fifth command which forgets the gate does
//! not misbehave at runtime. It fails to compile: there is no way to name a
//! value the backend will accept.
//!
//! What this does *not* do is replace the gate's checks. An authority is issued
//! only after `profile_for_bounds` has approved the monitor; this type carries
//! that decision around so it cannot be lost, and re-checks the three things
//! that can change between the decision and the click — the arrangement, the
//! clock, and which display the coordinate is on.

#![cfg(windows)]

use super::coordinates::DisplayGeometry;
use super::side_effects::{DesktopPoint, DesktopRect};

/// How long a decision stays good for.
///
/// The gate consults the monitor arrangement and the stored profile. Both can
/// change — a cable is pulled, the wizard reruns — and an authority minted
/// before that must not still be spendable afterwards. Two seconds is far longer
/// than capture-to-click takes and far shorter than any plausible
/// reconfiguration.
const AUTHORITY_TTL_MS: u64 = 2_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Why an authorization was refused, in the same typed vocabulary as the gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorityRefusal {
    /// Issued too long ago to still describe the screen.
    Expired,
    /// The monitor arrangement changed after the authority was issued.
    TopologyChanged,
    /// The coordinate is not on the display this authority covers.
    WrongDisplay,
}

impl AuthorityRefusal {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Expired => "VISUAL_AUTHORITY_EXPIRED",
            Self::TopologyChanged => "DISPLAY_IDENTITY_MISMATCH",
            Self::WrongDisplay => "TARGET_OUTSIDE_CONNECTED_DISPLAY",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::Expired => {
                "Too much time passed between checking the screen and acting on it, so I stopped."
            }
            Self::TopologyChanged => {
                "The monitor arrangement changed after I looked, so I stopped."
            }
            Self::WrongDisplay => {
                "That point is not on the display I checked, so I won't click it."
            }
        }
    }
}

/// A point some authority has vouched for.
///
/// No public constructor and no public fields: the only way to hold one is to
/// have been given one by `VisualExecutionAuthority::authorize_point`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthorizedPoint {
    x: i32,
    y: i32,
    display_id: u32,
}

impl AuthorizedPoint {
    pub fn x(&self) -> i32 {
        self.x
    }
    pub fn y(&self) -> i32 {
        self.y
    }
    pub fn display_id(&self) -> u32 {
        self.display_id
    }
    pub fn desktop_point(&self) -> DesktopPoint {
        DesktopPoint {
            x: self.x,
            y: self.y,
        }
    }
}

/// A rectangle some authority has vouched for. Same rules as the point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthorizedRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    display_id: u32,
}

impl AuthorizedRect {
    pub fn display_id(&self) -> u32 {
        self.display_id
    }
    pub fn desktop_rect(&self) -> DesktopRect {
        DesktopRect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

/// The gate's decision, as something a caller has to hold to act.
///
/// Constructed only by `issue`, which is visible to `display` and called only
/// from the profile gate.
#[derive(Debug, Clone)]
pub struct VisualExecutionAuthority {
    display_id: u32,
    bounds: DisplayGeometry,
    topology_version: String,
    issued_at_ms: u64,
}

impl VisualExecutionAuthority {
    /// Mint an authority. Only the profile gate may call this.
    pub(super) fn issue(
        display_id: u32,
        bounds: DisplayGeometry,
        topology_version: String,
    ) -> Self {
        Self {
            display_id,
            bounds,
            topology_version,
            issued_at_ms: now_ms(),
        }
    }

    pub fn display_id(&self) -> u32 {
        self.display_id
    }

    pub fn topology_version(&self) -> &str {
        &self.topology_version
    }

    pub fn age_ms(&self) -> u64 {
        now_ms().saturating_sub(self.issued_at_ms)
    }

    /// The checks every authorization repeats, however the coordinate arrived.
    fn check(&self, current_topology_version: &str) -> Result<(), AuthorityRefusal> {
        if self.age_ms() > AUTHORITY_TTL_MS {
            return Err(AuthorityRefusal::Expired);
        }
        if current_topology_version != self.topology_version {
            return Err(AuthorityRefusal::TopologyChanged);
        }
        Ok(())
    }

    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.bounds.x
            && y >= self.bounds.y
            && x < self.bounds.x + self.bounds.width as i32
            && y < self.bounds.y + self.bounds.height as i32
    }

    /// Vouch for a point, or say why not.
    ///
    /// Takes the *current* topology version rather than reading it here so the
    /// caller cannot be handed a different arrangement than the one the rest of
    /// its work was done against.
    pub fn authorize_point(
        &self,
        x: i32,
        y: i32,
        current_topology_version: &str,
    ) -> Result<AuthorizedPoint, AuthorityRefusal> {
        self.check(current_topology_version)?;
        if !self.contains(x, y) {
            return Err(AuthorityRefusal::WrongDisplay);
        }
        Ok(AuthorizedPoint {
            x,
            y,
            display_id: self.display_id,
        })
    }

    /// Vouch for a rectangle to outline.
    ///
    /// An outline is decoration, so a box that hangs off the edge is clamped to
    /// the display rather than refused — but a box that misses the authorized
    /// display entirely is a different display's box, and that is refused.
    pub fn authorize_rect(
        &self,
        rect: DesktopRect,
        current_topology_version: &str,
    ) -> Result<AuthorizedRect, AuthorityRefusal> {
        self.check(current_topology_version)?;
        let (bx, by) = (self.bounds.x, self.bounds.y);
        let (bw, bh) = (self.bounds.width as i32, self.bounds.height as i32);
        let left = rect.x.max(bx);
        let top = rect.y.max(by);
        let right = (rect.x + rect.width).min(bx + bw);
        let bottom = (rect.y + rect.height).min(by + bh);
        if right <= left || bottom <= top {
            return Err(AuthorityRefusal::WrongDisplay);
        }
        Ok(AuthorizedRect {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
            display_id: self.display_id,
        })
    }

    /// An authority covering one whole monitor, for tests that drive the
    /// backend directly rather than through a command.
    #[cfg(test)]
    pub(crate) fn covering_for_test(
        display_id: u32,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Self {
        Self::issue(
            display_id,
            DisplayGeometry {
                display_id,
                x,
                y,
                width,
                height,
                scale_factor: 1.0,
                rotation: 0,
            },
            "test-topology".into(),
        )
    }

    /// Vouch for a coordinate in a test, panicking rather than returning — a
    /// test that fails to authorize its own point has a bug in the test.
    #[cfg(test)]
    pub(crate) fn vouch_for_test(&self, x: i32, y: i32) -> AuthorizedPoint {
        let version = self.topology_version.clone();
        self.authorize_point(x, y, &version)
            .unwrap_or_else(|e| panic!("the test's own point was refused: {e:?}"))
    }

    #[cfg(test)]
    pub(crate) fn vouch_rect_for_test(&self, rect: DesktopRect) -> AuthorizedRect {
        let version = self.topology_version.clone();
        self.authorize_rect(rect, &version)
            .unwrap_or_else(|e| panic!("the test's own rectangle was refused: {e:?}"))
    }

    /// Mint an authority with a chosen issue time, so expiry can be tested
    /// without sleeping. `#[cfg(test)]` so no running code can age-forge one.
    #[cfg(test)]
    pub(crate) fn issue_at_for_test(
        display_id: u32,
        bounds: DisplayGeometry,
        topology_version: String,
        issued_at_ms: u64,
    ) -> Self {
        Self {
            display_id,
            bounds,
            topology_version,
            issued_at_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geom(id: u32, x: i32, y: i32, w: u32, h: u32) -> DisplayGeometry {
        DisplayGeometry {
            display_id: id,
            x,
            y,
            width: w,
            height: h,
            scale_factor: 1.0,
            rotation: 0,
        }
    }

    /// The portrait monitor at a negative origin, because that is where sign
    /// mistakes actually show up.
    fn portrait() -> DisplayGeometry {
        geom(2, -1080, -661, 1080, 1920)
    }

    fn authority_for(d: DisplayGeometry) -> VisualExecutionAuthority {
        VisualExecutionAuthority::issue(d.display_id, d, "v1".into())
    }

    #[test]
    fn a_fresh_authority_vouches_for_a_point_on_its_own_display() {
        let a = authority_for(portrait());
        let p = a.authorize_point(-540, 299, "v1").unwrap();
        assert_eq!((p.x(), p.y(), p.display_id()), (-540, 299, 2));
        assert_eq!(p.desktop_point(), DesktopPoint { x: -540, y: 299 });
    }

    #[test]
    fn an_authority_will_not_vouch_for_another_displays_point() {
        let a = authority_for(portrait());
        // Squarely inside the landscape monitor at the origin.
        assert_eq!(
            a.authorize_point(1920, 540, "v1"),
            Err(AuthorityRefusal::WrongDisplay)
        );
    }

    #[test]
    fn the_far_edges_are_exclusive_so_a_point_cannot_belong_to_two_displays() {
        let a = authority_for(portrait());
        assert!(a.authorize_point(-1080, -661, "v1").is_ok());
        // One past the right and bottom edges belongs to whatever is next.
        assert_eq!(
            a.authorize_point(0, -661, "v1"),
            Err(AuthorityRefusal::WrongDisplay)
        );
        assert_eq!(
            a.authorize_point(-1080, 1259, "v1"),
            Err(AuthorityRefusal::WrongDisplay)
        );
    }

    #[test]
    fn an_expired_authority_vouches_for_nothing() {
        let d = portrait();
        let stale = VisualExecutionAuthority::issue_at_for_test(
            d.display_id,
            d,
            "v1".into(),
            now_ms().saturating_sub(AUTHORITY_TTL_MS + 1),
        );
        assert_eq!(
            stale.authorize_point(-540, 299, "v1"),
            Err(AuthorityRefusal::Expired)
        );
        assert_eq!(
            stale.authorize_rect(
                DesktopRect {
                    x: -600,
                    y: 250,
                    width: 100,
                    height: 100
                },
                "v1"
            ),
            Err(AuthorityRefusal::Expired)
        );
    }

    /// Expiry is checked before the display, so a stale authority for the right
    /// display is refused for the honest reason.
    #[test]
    fn expiry_outranks_every_other_check() {
        let d = portrait();
        let stale = VisualExecutionAuthority::issue_at_for_test(
            d.display_id,
            d,
            "v1".into(),
            now_ms().saturating_sub(AUTHORITY_TTL_MS + 1),
        );
        assert_eq!(
            stale.authorize_point(1920, 540, "v2"),
            Err(AuthorityRefusal::Expired)
        );
    }

    #[test]
    fn an_authority_from_a_different_arrangement_vouches_for_nothing() {
        let a = authority_for(portrait());
        assert_eq!(
            a.authorize_point(-540, 299, "v2-after-the-cable-moved"),
            Err(AuthorityRefusal::TopologyChanged)
        );
    }

    #[test]
    fn an_outline_is_clamped_to_the_display_rather_than_refused() {
        let a = authority_for(portrait());
        let r = a
            .authorize_rect(
                DesktopRect {
                    x: -1200,
                    y: -700,
                    width: 300,
                    height: 200,
                },
                "v1",
            )
            .unwrap();
        assert_eq!(
            r.desktop_rect(),
            DesktopRect {
                x: -1080,
                y: -661,
                width: 180,
                height: 161,
            }
        );
        assert_eq!(r.display_id(), 2);
    }

    #[test]
    fn an_outline_that_misses_the_display_entirely_is_refused() {
        let a = authority_for(portrait());
        assert_eq!(
            a.authorize_rect(
                DesktopRect {
                    x: 1900,
                    y: 500,
                    width: 40,
                    height: 40
                },
                "v1",
            ),
            Err(AuthorityRefusal::WrongDisplay)
        );
    }

    #[test]
    fn every_refusal_has_a_typed_code_and_something_to_show_the_user() {
        for r in [
            AuthorityRefusal::Expired,
            AuthorityRefusal::TopologyChanged,
            AuthorityRefusal::WrongDisplay,
        ] {
            assert!(r.code().chars().all(|c| c.is_ascii_uppercase() || c == '_'));
            assert!(r.message().ends_with('.'));
        }
    }
}
