import { BadRequestException, ValidationError } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

export interface FieldError {
  field: string;
  message: string;
}

// Nested and array properties become dotted paths: "items.0.name"
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    errorCode: ErrorCode.VALIDATION_FAILED,
    message: 'Validation failed',
    details: flattenValidationErrors(errors),
  });
}
