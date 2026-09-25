import { Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { RedisConfig } from '../config/redis.config';
import { RedisClient } from './redis.constants';
import { createRedisClient, RedisModule } from './redis.module';

jest.mock('redis', () => ({ createClient: jest.fn() }));

const mockedCreateClient = createClient as unknown as jest.Mock;

// Lets rejected promises that nobody awaits (connect()) settle
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('createRedisClient', () => {
  let client: { on: jest.Mock; connect: jest.Mock };
  let handlers: Record<string, (...args: unknown[]) => void>;
  let loggerWarn: jest.SpyInstance;
  let loggerLog: jest.SpyInstance;

  const defaultConfig = (): RedisConfig => ({
    host: 'redis.internal',
    port: 6380,
    password: 's3cret',
  });

  const clientOptions = () => mockedCreateClient.mock.calls[0][0];

  beforeEach(() => {
    handlers = {};
    client = {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
        return client;
      }),
      connect: jest.fn().mockResolvedValue(undefined),
    };
    mockedCreateClient.mockReset().mockReturnValue(client);
    loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    loggerLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerWarn.mockRestore();
    loggerLog.mockRestore();
  });

  it('creates a client from config that fails fast while disconnected, and starts connecting', () => {
    expect(createRedisClient(defaultConfig())).toBe(client);

    expect(clientOptions()).toEqual({
      socket: {
        host: 'redis.internal',
        port: 6380,
        reconnectStrategy: expect.any(Function),
      },
      password: 's3cret',
      disableOfflineQueue: true,
    });
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', ''],
    ['unset', undefined],
  ])('sends no password when REDIS_PASSWORD is %s', (_case, password) => {
    createRedisClient({ host: 'redis', port: 6379, password });

    expect(clientOptions().password).toBeUndefined();
  });

  it.each([
    [0, 0],
    [1, 200],
    [10, 2000],
    [25, 5000],
    [1000, 5000],
  ])(
    'waits %i retries -> %i ms before reconnecting, capped at 5s',
    (retries, delay) => {
      createRedisClient(defaultConfig());

      expect(clientOptions().socket.reconnectStrategy(retries)).toBe(delay);
    },
  );

  it('logs a failed initial connection instead of crashing the app', async () => {
    client.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    createRedisClient(defaultConfig());
    await flushPromises();

    expect(loggerWarn).toHaveBeenCalledWith(
      'Initial connection failed: ECONNREFUSED',
    );
  });

  it('warns once per outage, not on every reconnect attempt', () => {
    createRedisClient(defaultConfig());

    handlers.error(new Error('ECONNRESET'));
    handlers.error(new Error('ECONNREFUSED'));
    handlers.error(new Error('ECONNREFUSED'));

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith('Connection lost: ECONNRESET');
  });

  it('logs the reconnection and warns again on the next outage', () => {
    createRedisClient(defaultConfig());

    handlers.error(new Error('ECONNRESET'));
    handlers.ready();
    handlers.error(new Error('ETIMEDOUT'));

    expect(loggerLog).toHaveBeenCalledWith('Connected');
    expect(loggerWarn).toHaveBeenCalledTimes(2);
    expect(loggerWarn).toHaveBeenLastCalledWith('Connection lost: ETIMEDOUT');
  });

  it('never logs the password', () => {
    createRedisClient(defaultConfig());
    handlers.error(new Error('WRONGPASS invalid username-password pair'));

    const logged = JSON.stringify([
      ...loggerWarn.mock.calls,
      ...loggerLog.mock.calls,
    ]);
    expect(logged).not.toContain('s3cret');
  });
});

describe('RedisModule', () => {
  const buildClient = (state: { isOpen: boolean; isReady: boolean }) => ({
    ...state,
    close: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn(),
  });

  it('does nothing on shutdown when the client never opened', async () => {
    const client = buildClient({ isOpen: false, isReady: false });

    await new RedisModule(
      client as unknown as RedisClient,
    ).onApplicationShutdown();

    expect(client.close).not.toHaveBeenCalled();
    expect(client.destroy).not.toHaveBeenCalled();
  });

  it('closes a connected client gracefully, waiting for pending replies', async () => {
    const client = buildClient({ isOpen: true, isReady: true });

    await new RedisModule(
      client as unknown as RedisClient,
    ).onApplicationShutdown();

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.destroy).not.toHaveBeenCalled();
  });

  it('destroys a client stuck reconnecting instead of waiting on it', async () => {
    const client = buildClient({ isOpen: true, isReady: false });

    await new RedisModule(
      client as unknown as RedisClient,
    ).onApplicationShutdown();

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(client.close).not.toHaveBeenCalled();
  });
});
