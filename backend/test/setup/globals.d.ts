import { StartedTestContainer } from 'testcontainers';

declare global {
  // Shared between globalSetup and globalTeardown (same process)
  var __E2E_CONTAINERS__: StartedTestContainer[] | undefined;
}

export {};
