import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { AUDIT_FIELDS } from '../audit.constants';
import { AuditLogResponseDto } from './audit-log-response.dto';

describe('AuditLogResponseDto', () => {
  it('documents exactly the fields the list endpoint can return (id plus the FIELDS whitelist)', () => {
    const documented = (
      Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES_ARRAY,
        AuditLogResponseDto.prototype,
      ) as string[]
    ).map((property) => property.replace(/^:/, ''));

    expect([...documented].sort()).toEqual(['id', ...AUDIT_FIELDS].sort());
  });
});
