import { RequestContext } from '../context/request-context';
import { AppLogger } from './app.logger';

describe('AppLogger', () => {
  let write: jest.SpyInstance;

  beforeEach(() => {
    write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => write.mockRestore());

  const output = () =>
    write.mock.calls.map(([chunk]) => String(chunk)).join('');

  it('adds the request id to lines logged during a request', () => {
    const logger = new AppLogger('Orders', { colors: false });

    RequestContext.run({ requestId: 'req-123' }, () => logger.log('created'));

    expect(output()).toContain('[Orders] [req req-123] created');
  });

  it('logs normally outside a request', () => {
    const logger = new AppLogger('Orders', { colors: false });

    logger.log('startup');

    expect(output()).toContain('[Orders] startup');
    expect(output()).not.toContain('[req');
  });
});
