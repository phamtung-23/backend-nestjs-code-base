import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
  requestId: string;
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
};
