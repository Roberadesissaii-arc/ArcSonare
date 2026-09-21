//! The real ultrawide run, replayed through the current policy.
//!
//! These are the fourteen samples actually recorded on 2026-07-31, read back out
//! of the stored profile. The run was reported Failed on a 4.16 px average, and
//! a correction fitted from it was saved. Replaying the measured numbers is the
//! only way to check a policy change against the thing it was written for
//! without asking a person to click fourteen more rings.
//!
//! Run: cargo test --lib replay_real_ultrawide_run -- --nocapture

use super::mapping::{
    choose_correction, fit_affine, summarise, AccuracyRating, DisplayMappingSample, PhysicalPoint,
};

/// `(expected_x, expected_y, actual_x, actual_y)` exactly as stored.
const CALIBRATION: [(f64, f64, f64, f64); 9] = [
    (64.0, 64.0, 63.0, 60.0),
    (1920.0, 64.0, 1918.0, 63.0),
    (3776.0, 64.0, 3776.0, 61.0),
    (64.0, 540.0, 64.0, 536.0),
    (1920.0, 540.0, 1919.0, 537.0),
    (3776.0, 540.0, 3775.0, 536.0),
    (64.0, 1016.0, 63.0, 1011.0),
    (1920.0, 1016.0, 1919.0, 1013.0),
    (3776.0, 1016.0, 3775.0, 1013.0),
];

const VALIDATION: [(f64, f64, f64, f64); 5] = [
    (381.899_166_394_718, 179.418_742_101_157_14, 381.0, 177.0),
    (641.091_209_938_853_5, 829.577_848_267_081_5, 640.0, 825.0),
    (
        1042.794_013_109_901_7,
        177.948_897_583_109_87,
        1042.0,
        174.0,
    ),
    (2796.512_113_222_8, 505.853_331_105_380_96, 2798.0, 502.0),
    (2468.621_342_060_112, 145.322_296_990_649_9, 2468.0, 140.0),
];

/// The portrait monitor, 1080x1920 at (-1080, -661). Recorded 2026-07-31.
/// Reported 6.107 px average / 9.094 px maximum, with a correction applied.
const B_CALIBRATION: [(f64, f64, f64, f64); 9] = [
    (-1016.0, -597.0, -1018.0, -604.0),
    (-540.0, -597.0, -544.0, -602.0),
    (-64.0, -597.0, -68.0, -600.0),
    (-1016.0, 299.0, -1015.0, 295.0),
    (-540.0, 299.0, -541.0, 295.0),
    (-64.0, 299.0, -66.0, 294.0),
    (-1016.0, 1195.0, -1019.0, 1193.0),
    (-540.0, 1195.0, -540.0, 1192.0),
    (-64.0, 1195.0, -64.0, 1191.0),
];

const B_VALIDATION: [(f64, f64, f64, f64); 5] = [
    (-795.60, 1155.35, -798.0, 1151.0),
    (-153.71, 156.39, -159.0, 149.0),
    (-752.21, -394.50, -754.0, -398.0),
    (-537.07, 741.30, -539.0, 737.0),
    (-903.29, -333.11, -907.0, -340.0),
];

fn samples(rows: &[(f64, f64, f64, f64)]) -> Vec<DisplayMappingSample> {
    rows.iter()
        .enumerate()
        .map(|(i, (ex, ey, ax, ay))| {
            let expected = PhysicalPoint::new(*ex, *ey);
            DisplayMappingSample::new(
                format!("replay-{i}"),
                expected,
                expected,
                PhysicalPoint::new(*ax, *ay),
                0,
                false,
                false,
            )
        })
        .collect()
}

#[test]
fn replay_real_ultrawide_run() {
    let calibration = samples(&CALIBRATION);
    let validation = samples(&VALIDATION);

    let summary = summarise(&validation);
    println!("\n{}", "=".repeat(74));
    println!("REAL ULTRAWIDE RUN — replayed through the current policy");
    println!("{}", "=".repeat(74));
    println!(
        "\nvalidation  n={}  average {:.2} px  maximum {:.2} px  wrong {}  oob {}",
        summary.sample_count,
        summary.average_error_px,
        summary.maximum_error_px,
        summary.wrong_display_count,
        summary.out_of_bounds_count
    );
    println!("rating      {}", summary.rating.label());

    // The figures the stored profile recorded, reproduced from its own samples.
    assert!((summary.average_error_px - 4.161).abs() < 0.01);
    assert!((summary.maximum_error_px - 5.358).abs() < 0.01);

    // The whole point of the policy change.
    assert_eq!(
        summary.rating,
        AccuracyRating::Valid,
        "this run must now pass"
    );
    assert!(summary.passed);

    // The candidate that was previously saved without being checked.
    let pairs: Vec<_> = calibration
        .iter()
        .map(|s| (s.expected_desktop_point, s.actual_desktop_point))
        .collect();
    let candidate = fit_affine(&pairs).expect("nine spread points determine a fit");
    println!(
        "\ncandidate   x' = {:.5}x + {:.5}y + {:.2}",
        candidate.a, candidate.b, candidate.c
    );
    println!(
        "            y' = {:.5}x + {:.5}y + {:.2}",
        candidate.d, candidate.e, candidate.f
    );

    let decision = choose_correction(Some(candidate), &validation);
    println!(
        "\nidentity    average {:.2} px  maximum {:.2} px",
        decision.identity_average_px, decision.identity_maximum_px
    );
    println!(
        "candidate   average {:.2} px  maximum {:.2} px  ({:+.0}%)",
        decision.candidate_average_px,
        decision.candidate_maximum_px,
        decision.improvement * 100.0
    );
    println!(
        "decision    {}",
        if decision.applied.is_some() {
            "correction applied"
        } else {
            "identity retained"
        }
    );
    println!("reason      {}", decision.reason);
    println!("{}\n", "=".repeat(74));

    // The finding this test exists to pin down.
    //
    // The candidate *does* generalise: every one of the fourteen points carries
    // the same roughly (-1, -3.3) px offset, so it cuts the held-out average
    // substantially. Cross-validation alone therefore accepts it — and would be
    // wrong to, because `display_mapping_native_targets` independently proves
    // the overlay lands at 0.00 px. There is no mapping error for a correction
    // to remove. All of that offset is where the operator's eye put the cursor.
    //
    // Applying it would bias every future ArcSonare click by one person's aim on
    // one afternoon.
    assert!(
        decision.applied.is_none(),
        "a pure translation fitted from hand-aimed clicks is aiming bias, not \
         geometry — the overlay is already verified at 0.00 px. Reason given: {}",
        decision.reason
    );
}

/// The portrait run, which failed by 0.107 px of average error.
///
/// Two questions it answers from real data: why the average was 6.1, and whether
/// the correction that was saved should have been.
#[test]
fn replay_real_portrait_run() {
    let calibration = samples(&B_CALIBRATION);
    let validation = samples(&B_VALIDATION);

    let summary = summarise(&validation);
    println!("\n{}", "=".repeat(74));
    println!("REAL PORTRAIT RUN (Display B) — replayed");
    println!("{}", "=".repeat(74));
    println!(
        "\nvalidation  n={}  average {:.3} px  maximum {:.3} px",
        summary.sample_count, summary.average_error_px, summary.maximum_error_px
    );
    println!("rating      {}", summary.rating.label());

    assert!((summary.average_error_px - 6.107).abs() < 0.01);
    assert!((summary.maximum_error_px - 9.094).abs() < 0.01);

    // Still a failure, and by how little. Not rounded away.
    assert_eq!(summary.rating, AccuracyRating::Failed);
    let over = summary.average_error_px - super::mapping::VALID_AVERAGE_PX;
    println!("over by     {over:.3} px on the average; the maximum passed");
    assert!(over > 0.0 && over < 0.2);

    // Every sample errs the same way: a systematic aim, not scatter.
    let all: Vec<_> = calibration.iter().chain(validation.iter()).collect();
    assert!(
        all.iter().all(|s| s.error_y < 0.0),
        "all fourteen samples land above their target — that is aim, not geometry"
    );
    let negative_x = all.iter().filter(|s| s.error_x < 0.0).count();
    println!("bias        {negative_x}/14 samples left of target, 14/14 above it");

    // The worst validation point, and what it costs.
    let worst = validation
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.error_distance.partial_cmp(&b.1.error_distance).unwrap())
        .unwrap();
    let without: f64 = validation
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != worst.0)
        .map(|(_, s)| s.error_distance)
        .sum::<f64>()
        / (validation.len() - 1) as f64;
    println!(
        "worst       point {} at {:.3} px; average without it {:.3} px",
        worst.0 + 1,
        worst.1.error_distance,
        without
    );
    assert!(
        without <= super::mapping::VALID_AVERAGE_PX,
        "one loose point is what put this over"
    );

    // The correction that was saved.
    let pairs: Vec<_> = calibration
        .iter()
        .map(|s| (s.expected_desktop_point, s.actual_desktop_point))
        .collect();
    let candidate = fit_affine(&pairs).expect("nine spread points determine a fit");
    let decision = choose_correction(Some(candidate), &validation);
    println!(
        "\nidentity    average {:.3} px  maximum {:.3} px",
        decision.identity_average_px, decision.identity_maximum_px
    );
    println!(
        "candidate   average {:.3} px  maximum {:.3} px",
        decision.candidate_average_px, decision.candidate_maximum_px
    );
    println!(
        "decision    {}",
        if decision.applied.is_some() {
            "applied"
        } else {
            "identity retained"
        }
    );
    println!("reason      {}", decision.reason);
    println!("{}\n", "=".repeat(74));

    // It improves held-out accuracy substantially — and is still refused,
    // because a plain offset does the same job better. On this run: affine
    // 2.39 px, translation-only 2.01 px. The extra freedom fitted noise.
    assert!(
        decision.applied.is_none(),
        "a translation-like correction is aiming bias: {}",
        decision.reason
    );
}
