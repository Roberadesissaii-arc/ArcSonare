import { runConformanceSuite } from "../src/features/orchestration/conformance";

const result = runConformanceSuite("deterministic-router");
console.log(JSON.stringify(result, null, 2));
if (result.failedTests > 0) {
  console.error(`\nFAILED ${result.failedTests}/${result.totalTests}`);
  process.exit(1);
}
console.log(`\nPASSED ${result.passedTests}/${result.totalTests}`);
