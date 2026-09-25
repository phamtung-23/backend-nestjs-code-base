import { Request, Response } from 'express';
import { RequestContext, RequestStore } from '../context/request-context';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './request-id.middleware';

describe('requestIdMiddleware', () => {
  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const run = ({
    headers = {},
    ip = '203.0.113.7',
  }: { headers?: Record<string, string>; ip?: string } = {}) => {
    const req = {
      headers,
      ip,
      header: jest.fn((name: string) => headers[name.toLowerCase()]),
    } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    let idInsideNext: string | undefined;
    let storeInsideNext: RequestStore | undefined;
    const next = jest.fn(() => {
      idInsideNext = RequestContext.requestId();
      storeInsideNext = RequestContext.current();
    });

    requestIdMiddleware(req, res, next);
    return {
      headerName: setHeader.mock.calls[0][0],
      headerValue: setHeader.mock.calls[0][1],
      idInsideNext,
      storeInsideNext,
      next,
    };
  };

  it('generates an id, sets the response header and exposes it to the request chain', () => {
    const { headerName, headerValue, idInsideNext, next } = run();

    expect(headerName).toBe(REQUEST_ID_HEADER);
    expect(headerValue).toMatch(UUID);
    expect(idInsideNext).toBe(headerValue);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('never reuses a client-supplied id', () => {
    const incoming = '7f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
    const { headerValue } = run({ headers: { 'x-request-id': incoming } });

    expect(headerValue).toMatch(UUID);
    expect(headerValue).not.toBe(incoming);
  });

  it('gives every request a different id', () => {
    expect(run().headerValue).not.toBe(run().headerValue);
  });

  it('stores the client IP and user agent with the request id for audit entries', () => {
    const { headerValue, storeInsideNext } = run({
      headers: { 'user-agent': 'Mozilla/5.0 (jest)' },
      ip: '198.51.100.23',
    });

    expect(storeInsideNext).toEqual({
      requestId: headerValue,
      ipAddress: '198.51.100.23',
      userAgent: 'Mozilla/5.0 (jest)',
    });
  });

  it('truncates the user agent to 500 characters', () => {
    const { storeInsideNext } = run({
      headers: { 'user-agent': 'x'.repeat(2000) },
    });

    expect(storeInsideNext?.userAgent).toBe('x'.repeat(500));
  });

  it('strips control characters from the user agent', () => {
    const { storeInsideNext } = run({
      headers: { 'user-agent': 'Mozilla\u0000/5.0\u001b[31m (jest)\u007f' },
    });

    expect(storeInsideNext?.userAgent).toBe('Mozilla/5.0[31m (jest)');
  });

  it('leaves the user agent undefined when the header is missing', () => {
    const { storeInsideNext } = run();

    expect(storeInsideNext?.userAgent).toBeUndefined();
    expect(storeInsideNext?.ipAddress).toBe('203.0.113.7');
  });

  it('has no request context outside a request', () => {
    expect(RequestContext.requestId()).toBeUndefined();
    expect(RequestContext.current()).toBeUndefined();
  });
});
