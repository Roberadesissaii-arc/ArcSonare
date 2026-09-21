//! Things a release build must not contain.
//!
//! Unlike the modules they check, this one is always compiled, so the
//! assertions run in both profiles. A test that lives inside a debug-only
//! module cannot prove anything about release — it is not there either.

/// Compiled only in release. Its existence is the assertion: if `dev_unlock`
/// were reachable here, the `cfg` gating would have to have been removed, and
/// this module names that explicitly rather than leaving it to a comment.
#[cfg(not(debug_assertions))]
mod release_profile {
    /// A release build has no development unlock. There is no flag to check,
    /// because there is no code: `src/dev_unlock.rs` carries an inner
    /// `#![cfg(debug_assertions)]`, so its contents compile to nothing here even
    /// if the `mod` declaration were left ungated.
    pub const HAS_DEV_UNLOCK: bool = false;
}

#[cfg(test)]
mod tests {
    /// The gating is structural, so it is checked structurally.
    ///
    /// Reading the source is unusual for a unit test and deliberate here: the
    /// property is "this declaration is behind a cfg", and no runtime value in a
    /// debug build can express that. A debug binary that checked its own
    /// behaviour would pass while release was wide open.
    #[test]
    fn the_dev_unlock_module_is_debug_only() {
        let lib = include_str!("lib.rs");

        let module = lib
            .lines()
            .position(|l| l.trim() == "mod dev_unlock;")
            .expect("dev_unlock module declaration");
        assert_eq!(
            lib.lines().nth(module - 1).map(str::trim),
            Some("#[cfg(debug_assertions)]"),
            "the dev_unlock module must be declared behind #[cfg(debug_assertions)]",
        );

        // Both commands, each individually gated. One ungated entry would export
        // it from a release binary on its own.
        for command in ["dev_unlock::dev_unlock_available,", "dev_unlock::dev_unlock,"] {
            let at = lib
                .lines()
                .position(|l| l.trim() == command)
                .unwrap_or_else(|| panic!("{command} should be registered"));
            assert_eq!(
                lib.lines().nth(at - 1).map(str::trim),
                Some("#[cfg(debug_assertions)]"),
                "{command} must be registered only in debug builds",
            );
        }

        // Belt and braces: the file's own inner attribute, so removing the outer
        // gate still yields an empty module in release.
        let module_source = include_str!("dev_unlock.rs");
        assert!(
            module_source.contains("#![cfg(debug_assertions)]"),
            "dev_unlock.rs must carry its own inner cfg",
        );
    }

    /// The development password must not be in the repository.
    ///
    /// Checks the source tree rather than the running process: the value being
    /// absent from memory is not the property that matters, being absent from a
    /// commit is.
    #[test]
    fn no_source_file_carries_the_dev_password() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("project root");

        // The file itself is allowed to exist locally; it must be gitignored.
        let gitignore = std::fs::read_to_string(root.join(".gitignore")).unwrap_or_default();
        assert!(
            gitignore.lines().any(|l| l.trim() == ".dev-password"),
            ".dev-password must be gitignored",
        );

        // And nothing may read it into a literal. Scanning for the value itself
        // would mean putting the value in this test, which is the same mistake.
        let dev_unlock = include_str!("dev_unlock.rs");
        assert!(
            !dev_unlock.contains("ARCSONARE_DEV_PASSWORD=") ,
            "the environment variable must be read, not assigned, in source",
        );
    }
}
