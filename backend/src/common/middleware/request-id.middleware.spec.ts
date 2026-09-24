import { Request, Response } from 'express';
import { RequestContext } from '../context/request-context';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './request-id.middleware';

describe('requestIdMiddleware', () => {
  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const run = (incoming?: string) => {
    const req = {
      headers: incoming ? { 'x-request-id': incoming } : {},
    } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    let idInsideNext: string | undefined;
    const next = jest.fn(() => {
      idInsideNext = RequestContext.requestId();
    });

    requestIdMiddleware(req, res, next);
    return {
      headerName: setHeader.mock.calls[0][0],
      headerValue: setHeader.mock.calls[0][1],
      idInsideNext,
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
    const { headerValue } = run(incoming);

    expect(headerValue).toMatch(UUID);
    expect(headerValue).not.toBe(incoming);
  });

  it('gives every request a different id', () => {
    expect(run().headerValue).not.toBe(run().headerValue);
  });

  it('has no request id outside a request', () => {
    expect(RequestContext.requestId()).toBeUndefined();
  });
});
