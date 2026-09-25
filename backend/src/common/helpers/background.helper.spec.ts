import { Logger } from '@nestjs/common';
import { runInBackground } from './background.helper';

const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('runInBackground', () => {
  const logger = new Logger('test');
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => loggerError.mockRestore());

  it('starts the task without waiting for it', () => {
    const task = jest.fn(() => new Promise<void>(() => undefined));

    expect(runInBackground(logger, task)).toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('logs a failure with its stack instead of throwing', async () => {
    const error = new Error('SMTP down');

    runInBackground(logger, () => Promise.reject(error));
    await flushPromises();

    expect(loggerError).toHaveBeenCalledWith(
      'Background task failed',
      error.stack,
    );
  });

  it('logs failures that are not Error instances as strings', async () => {
    runInBackground(logger, jest.fn().mockRejectedValue('timeout'));
    await flushPromises();

    expect(loggerError).toHaveBeenCalledWith(
      'Background task failed',
      'timeout',
    );
  });

  it('logs nothing when the task succeeds', async () => {
    runInBackground(logger, () => Promise.resolve('done'));
    await flushPromises();

    expect(loggerError).not.toHaveBeenCalled();
  });
});
