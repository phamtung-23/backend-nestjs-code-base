import { withTimeout } from './redis.helpers';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the command result when Redis answers in time', async () => {
    await expect(withTimeout(Promise.resolve('OK'), 50)).resolves.toBe('OK');
  });

  it('passes a command error through', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('NOAUTH')), 50),
    ).rejects.toThrow('NOAUTH');
  });

  it('rejects when Redis does not answer within the budget', async () => {
    jest.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => undefined), 500);
    const assertion = expect(pending).rejects.toThrow(
      'Redis did not answer within 500 ms',
    );

    await jest.advanceTimersByTimeAsync(500);

    await assertion;
  });
});
