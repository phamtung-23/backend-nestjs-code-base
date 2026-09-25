import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

// Per-request values available anywhere down the call chain (logger, filter)
// without threading them through every function signature
export const RequestContext = {
  run<T>(store: RequestStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  // Undefined outside a request (e.g. scheduled jobs)
  current(): RequestStore | undefined {
    return storage.getStore();
  },
};
