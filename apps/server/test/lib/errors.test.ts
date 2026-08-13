import { describe, expect, it } from 'vitest';
import { badRequest, conflict, forbidden, HttpError, notFound, parseId, unauthorized } from '../../src/lib/errors.js';

describe('HttpError', () => {
  it('constructs a typed error with statusCode and code', () => {
    const err = new HttpError(418, 'teapot', 'short and stout');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HttpError');
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('teapot');
    expect(err.message).toBe('short and stout');
  });
});

describe('error factories', () => {
  it('badRequest uses defaults', () => {
    const err = badRequest();
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('bad_request');
    expect(err.message).toBe('Bad request');
  });

  it('badRequest accepts overrides', () => {
    const err = badRequest('Email taken', 'email_taken');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('email_taken');
    expect(err.message).toBe('Email taken');
  });

  it('unauthorized uses defaults and overrides', () => {
    expect(unauthorized().statusCode).toBe(401);
    expect(unauthorized().code).toBe('unauthorized');
    expect(unauthorized('Nope').message).toBe('Nope');
  });

  it('forbidden', () => {
    expect(forbidden().statusCode).toBe(403);
    expect(forbidden().code).toBe('forbidden');
  });

  it('notFound', () => {
    expect(notFound().statusCode).toBe(404);
    expect(notFound().code).toBe('not_found');
    expect(notFound('missing').message).toBe('missing');
  });

  it('conflict', () => {
    expect(conflict().statusCode).toBe(409);
    expect(conflict().code).toBe('conflict');
  });
});

describe('parseId', () => {
  it('returns the integer for a valid numeric string', () => {
    expect(parseId('42')).toBe(42);
  });

  it('throws a 400 invalid_id for a non-numeric string', () => {
    try {
      parseId('abc');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(400);
      expect((err as HttpError).code).toBe('invalid_id');
    }
  });

  it('throws for zero and negative ids', () => {
    expect(() => parseId('0')).toThrow(HttpError);
    expect(() => parseId('-5')).toThrow(HttpError);
  });

  it('throws for a non-integer', () => {
    expect(() => parseId('1.5')).toThrow(HttpError);
  });
});
