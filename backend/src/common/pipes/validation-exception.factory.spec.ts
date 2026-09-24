import { BadRequestException, ValidationError } from '@nestjs/common';
import {
  flattenValidationErrors,
  validationExceptionFactory,
} from './validation-exception.factory';

const error = (
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError => ({ property, constraints, children });

describe('validation exception factory', () => {
  const errors = [
    error('email', { isEmail: 'email must be an email' }),
    error('items', undefined, [
      error('0', undefined, [
        error('name', {
          isString: 'name must be a string',
          maxLength: 'name is too long',
        }),
      ]),
    ]),
  ];

  it('flattens nested errors into dotted field paths', () => {
    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'email', message: 'email must be an email' },
      { field: 'items.0.name', message: 'name must be a string' },
      { field: 'items.0.name', message: 'name is too long' },
    ]);
  });

  it('creates a 400 VALIDATION_FAILED exception with field details', () => {
    const exception = validationExceptionFactory(errors);

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getResponse()).toEqual({
      errorCode: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: flattenValidationErrors(errors),
    });
  });
});
