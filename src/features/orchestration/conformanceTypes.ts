export type ModelConformanceResult = {
  providerId: string;
  modelId: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  nativeToolTestsPassed: boolean;
  structuredFallbackPassed: boolean;
  deterministicRoutingPassed: boolean;
  supportedOperationModes: string[];
  failures: Array<{
    testName: string;
    expectedCapability: string;
    actualCapability?: string;
    message: string;
  }>;
  testedAt: string;
};
