import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Swagger contract. With ?fields= only the requested properties are present.
export class AuditLogResponseDto {
  @ApiProperty({ example: 'cmuq2l3v70001o4hc0q7a9k2x' })
  id: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'cmufs79e80009o4gpupls7i3y',
  })
  actorId: string | null;

  @ApiProperty({ example: 'user.password_changed' })
  action: string;

  @ApiProperty({ example: 'user' })
  entity: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'cmufs79e80009o4gpupls7i3y',
  })
  entityId: string | null;

  @ApiPropertyOptional({ nullable: true, type: Object, example: null })
  changes: unknown;

  @ApiPropertyOptional({
    nullable: true,
    type: Object,
    example: { method: 'password' },
  })
  metadata: unknown;

  @ApiPropertyOptional({ nullable: true, type: String, example: '203.0.113.7' })
  ipAddress: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Mozilla/5.0' })
  userAgent: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'uuid',
    example: '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f',
  })
  requestId: string | null;

  @ApiProperty({ example: '2026-01-01T08:00:00.000Z' })
  createdAt: Date;
}
