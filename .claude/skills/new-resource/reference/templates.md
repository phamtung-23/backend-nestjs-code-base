# Resource module templates (example: `articles`)

A complete, working resource: an `Article` owned by a `User`, with list pagination, filters, search, sort, sparse
fieldsets, a whitelisted include, ownership checks, optimistic locking and unit tests. It was compiled, linted, unit
tested, and exercised over HTTP against PostgreSQL. Copy it, then rename (`Article` → `Thing`, `articles` →
`things`) and adapt the fields, filters and whitelists to the new resource.

Prerequisites (CLAUDE.md "Foundations status"): error codes, transform helpers, the list query contract, the Swagger
envelope decorator, and `@CurrentUser()` — see `foundations.md`. When `JwtAuthGuard` becomes global, drop the
controller-level `@UseGuards(JwtAuthGuard)`.

## Prisma model (`backend/prisma/schema.prisma`)

```prisma
enum ArticleStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

model Article {
  id        String        @id @default(cuid())
  title     String
  content   String
  status    ArticleStatus @default(DRAFT)
  version   Int           @default(0)
  authorId  String
  author    User          @relation(fields: [authorId], references: [id], onDelete: Cascade)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  @@index([authorId, createdAt])
  @@index([status, createdAt])
  @@map("articles")
}

// and on the owning side, in model User:
//   articles Article[]
```

Indexes follow the list queries: filter by author/status, sort by `createdAt`.

## Files

### articles.constants.ts

`backend/src/modules/articles/articles.constants.ts`

```ts
export const ARTICLE_SORTABLE = ['createdAt', 'updatedAt', 'title'] as const;
export const ARTICLE_DEFAULT_SORT = '-createdAt';
export const ARTICLE_SEARCHABLE = ['title', 'content'] as const;

// Selectable via ?fields= (id is always selected); defaults to all of them
export const ARTICLE_FIELDS = [
  'title',
  'content',
  'status',
  'version',
  'authorId',
  'createdAt',
  'updatedAt',
] as const;

// Embeddable via ?include= — nested selects keep columns explicit and let
// Prisma batch the relation query (no N+1)
export const ARTICLE_INCLUDABLE = {
  author: { select: { id: true, firstName: true, lastName: true } },
};

export const ArticleErrorCode = {
  NOT_FOUND: 'ARTICLE_NOT_FOUND',
} as const;
```

### create-article.dto.ts

`backend/src/modules/articles/dto/create-article.dto.ts`

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { trimString } from '../../../common/helpers/transform.helpers';

export class CreateArticleDto {
  @ApiProperty({ example: 'Designing REST APIs', maxLength: 200 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Resources are nouns...', maxLength: 20000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content: string;

  @ApiPropertyOptional({ enum: ArticleStatus, default: ArticleStatus.DRAFT })
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;
}
```

### update-article.dto.ts

`backend/src/modules/articles/dto/update-article.dto.ts`

```ts
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { CreateArticleDto } from './create-article.dto';

export class UpdateArticleDto extends PartialType(CreateArticleDto) {
  @ApiProperty({
    example: 3,
    description: 'Version the client last read (optimistic locking)',
  })
  @IsInt()
  @Min(0)
  version: number;
}
```

### list-articles-query.dto.ts

`backend/src/modules/articles/dto/list-articles-query.dto.ts`

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { toArray } from '../../../common/helpers/transform.helpers';
import { ListQueryDto } from '../../../common/query';

export class ListArticlesQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ArticleStatus, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(ArticleStatus, { each: true })
  status?: ArticleStatus[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  authorId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdFrom?: Date;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdTo?: Date;
}
```

### article-response.dto.ts

`backend/src/modules/articles/dto/article-response.dto.ts`

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';

class ArticleAuthorDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true, type: String })
  firstName: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastName: string | null;
}

// Swagger contract. With ?fields= only the requested properties are present.
export class ArticleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ enum: ArticleStatus })
  status: ArticleStatus;

  @ApiProperty()
  version: number;

  @ApiProperty()
  authorId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: ArticleAuthorDto })
  author?: ArticleAuthorDto;
}
```

### articles.repository.ts

`backend/src/modules/articles/articles.repository.ts`

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ArticlesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  async findPage(args: {
    where: Prisma.ArticleWhereInput;
    orderBy: Prisma.ArticleOrderByWithRelationInput[];
    select: Prisma.ArticleSelect;
    skip: number;
    take: number;
  }) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.article.findMany(args),
      this.prisma.article.count({ where: args.where }),
    ]);
    return { items, total };
  }

  findById(
    id: string,
    select: Prisma.ArticleSelect,
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).article.findUnique({ where: { id }, select });
  }

  create(
    data: Prisma.ArticleUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).article.create({ data });
  }

  // Optimistic locking: false when the row changed since `version` was read
  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.ArticleUpdateManyMutationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await this.db(tx).article.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return count === 1;
  }

  async delete(id: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const { count } = await this.db(tx).article.deleteMany({ where: { id } });
    return count === 1;
  }
}
```

### articles.service.ts

`backend/src/modules/articles/articles.service.ts`

```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  buildSearch,
  buildSelect,
  parseSort,
  ProjectionQueryDto,
} from '../../common/query';
import {
  ARTICLE_DEFAULT_SORT,
  ARTICLE_FIELDS,
  ARTICLE_INCLUDABLE,
  ARTICLE_SEARCHABLE,
  ARTICLE_SORTABLE,
  ArticleErrorCode,
} from './articles.constants';
import { ArticlesRepository } from './articles.repository';
import { CreateArticleDto } from './dto/create-article.dto';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

const PROJECTION = { fields: ARTICLE_FIELDS, includable: ARTICLE_INCLUDABLE };

@Injectable()
export class ArticlesService {
  constructor(private readonly articlesRepository: ArticlesRepository) {}

  async list(query: ListArticlesQueryDto) {
    const where: Prisma.ArticleWhereInput = {
      status: query.status && { in: query.status },
      authorId: query.authorId,
      createdAt:
        query.createdFrom || query.createdTo
          ? { gte: query.createdFrom, lte: query.createdTo }
          : undefined,
      OR: buildSearch<Prisma.ArticleWhereInput>(
        query.search,
        ARTICLE_SEARCHABLE,
      ),
    };

    return this.articlesRepository.findPage({
      where,
      orderBy: parseSort(query.sort, ARTICLE_SORTABLE, ARTICLE_DEFAULT_SORT),
      select: buildSelect<Prisma.ArticleSelect>(query, PROJECTION),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  async findOne(id: string, query: ProjectionQueryDto = {}) {
    const article = await this.articlesRepository.findById(
      id,
      buildSelect<Prisma.ArticleSelect>(query, PROJECTION),
    );
    if (!article) {
      throw this.notFound();
    }
    return article;
  }

  async create(authorId: string, dto: CreateArticleDto) {
    const article = await this.articlesRepository.create({
      title: dto.title,
      content: dto.content,
      status: dto.status,
      authorId,
    });
    return this.findOne(article.id);
  }

  async update(id: string, userId: string, dto: UpdateArticleDto) {
    await this.assertOwner(id, userId);

    const updated = await this.articlesRepository.updateIfVersion(
      id,
      dto.version,
      { title: dto.title, content: dto.content, status: dto.status },
    );
    if (!updated) {
      throw new ConflictException({
        errorCode: ErrorCode.VERSION_CONFLICT,
        message: 'The article was modified by someone else; reload and retry',
      });
    }
    return this.findOne(id);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.assertOwner(id, userId);
    if (!(await this.articlesRepository.delete(id))) {
      throw this.notFound();
    }
  }

  // Foreign resources look missing (404) so their existence doesn't leak
  private async assertOwner(id: string, userId: string): Promise<void> {
    const article = await this.articlesRepository.findById(id, {
      id: true,
      authorId: true,
    });
    if (!article || article.authorId !== userId) {
      throw this.notFound();
    }
  }

  private notFound() {
    return new NotFoundException({
      errorCode: ArticleErrorCode.NOT_FOUND,
      message: 'Article not found',
    });
  }
}
```

### articles.controller.ts

`backend/src/modules/articles/articles.controller.ts`

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ResponseHelper } from '../../common/helpers/response.helper';
import { ProjectionQueryDto } from '../../common/query';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/interfaces/auth.interface';
import { ArticlesService } from './articles.service';
import { ArticleResponseDto } from './dto/article-response.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

@ApiTags('Articles')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard) // drop once JwtAuthGuard is the global APP_GUARD
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @ApiOperation({ summary: 'List articles' })
  @ApiEnvelopeResponse(ArticleResponseDto, { paginated: true })
  @Get()
  async list(@Query() query: ListArticlesQueryDto) {
    const { items, total } = await this.articlesService.list(query);
    return ResponseHelper.paginated(
      items,
      total,
      query.page,
      query.limit,
      'Articles retrieved',
    );
  }

  @ApiOperation({ summary: 'Get an article' })
  @ApiEnvelopeResponse(ArticleResponseDto)
  @ApiNotFoundResponse({ description: 'ARTICLE_NOT_FOUND' })
  @Get(':id')
  async findOne(@Param('id') id: string, @Query() query: ProjectionQueryDto) {
    const article = await this.articlesService.findOne(id, query);
    return ResponseHelper.success(article, 'Article retrieved');
  }

  @ApiOperation({ summary: 'Create an article' })
  @ApiEnvelopeResponse(ArticleResponseDto, { status: HttpStatus.CREATED })
  @Post()
  async create(@CurrentUser() user: User, @Body() dto: CreateArticleDto) {
    const article = await this.articlesService.create(user.id, dto);
    return ResponseHelper.success(article, 'Article created');
  }

  @ApiOperation({ summary: 'Update an article (optimistic locking)' })
  @ApiEnvelopeResponse(ArticleResponseDto)
  @ApiNotFoundResponse({ description: 'ARTICLE_NOT_FOUND' })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateArticleDto,
  ) {
    const article = await this.articlesService.update(id, user.id, dto);
    return ResponseHelper.success(article, 'Article updated');
  }

  @ApiOperation({ summary: 'Delete an article' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'ARTICLE_NOT_FOUND' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.articlesService.remove(id, user.id);
  }
}
```

### articles.module.ts

`backend/src/modules/articles/articles.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller';
import { ArticlesRepository } from './articles.repository';
import { ArticlesService } from './articles.service';

@Module({
  controllers: [ArticlesController],
  providers: [ArticlesService, ArticlesRepository],
  exports: [ArticlesService],
})
export class ArticlesModule {}
```

### articles.service.spec.ts

`backend/src/modules/articles/articles.service.spec.ts`

```ts
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ArticlesRepository } from './articles.repository';
import { ArticlesService } from './articles.service';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';

describe('ArticlesService', () => {
  let repository: jest.Mocked<ArticlesRepository>;
  let service: ArticlesService;

  const listQuery = (overrides: Partial<ListArticlesQueryDto> = {}) =>
    Object.assign(new ListArticlesQueryDto(), overrides);

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: jest.fn(),
      create: jest.fn(),
      updateIfVersion: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ArticlesRepository>;
    service = new ArticlesService(repository);
  });

  describe('list', () => {
    it('builds filters, search, sort with id tiebreaker and pagination', async () => {
      await service.list(
        listQuery({
          page: 2,
          limit: 10,
          status: ['PUBLISHED'],
          search: 'nest',
          sort: '-title',
        }),
      );

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['PUBLISHED'] },
            OR: [
              { title: { contains: 'nest', mode: 'insensitive' } },
              { content: { contains: 'nest', mode: 'insensitive' } },
            ],
          }),
          orderBy: [{ title: 'desc' }, { id: 'asc' }],
          skip: 10,
          take: 10,
        }),
      );
    });

    it('selects only requested fields plus id and whitelisted relations', async () => {
      await service.list(listQuery({ fields: 'title', include: 'author' }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            title: true,
            author: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
      );
    });

    it.each([
      ['sort', { sort: 'password' }],
      ['fields', { fields: 'secret' }],
      ['include', { include: 'comments' }],
    ])('rejects a non-whitelisted %s value', async (_param, overrides) => {
      await expect(service.list(listQuery(overrides))).rejects.toMatchObject({
        constructor: BadRequestException,
        response: { errorCode: 'INVALID_QUERY_PARAM' },
      });
    });
  });

  describe('update', () => {
    const dto = { version: 3, title: 'New title' };

    it('updates with the client version and returns the fresh article', async () => {
      repository.findById
        .mockResolvedValueOnce({ id: 'a1', authorId: 'u1' } as never)
        .mockResolvedValueOnce({ id: 'a1', title: 'New title' } as never);
      repository.updateIfVersion.mockResolvedValue(true);

      await expect(service.update('a1', 'u1', dto)).resolves.toEqual({
        id: 'a1',
        title: 'New title',
      });
      expect(repository.updateIfVersion).toHaveBeenCalledWith('a1', 3, {
        title: 'New title',
        content: undefined,
        status: undefined,
      });
    });

    it('returns 404 for an article owned by someone else', async () => {
      repository.findById.mockResolvedValue({
        id: 'a1',
        authorId: 'other',
      } as never);

      await expect(service.update('a1', 'u1', dto)).rejects.toMatchObject({
        constructor: NotFoundException,
        response: { errorCode: 'ARTICLE_NOT_FOUND' },
      });
      expect(repository.updateIfVersion).not.toHaveBeenCalled();
    });

    it('returns 409 when the version is stale', async () => {
      repository.findById.mockResolvedValue({
        id: 'a1',
        authorId: 'u1',
      } as never);
      repository.updateIfVersion.mockResolvedValue(false);

      await expect(service.update('a1', 'u1', dto)).rejects.toMatchObject({
        constructor: ConflictException,
        response: { errorCode: 'VERSION_CONFLICT' },
      });
    });
  });
});
```

## Register the module

Add `ArticlesModule` to `imports` in `backend/src/app.module.ts`.

## Adapting checklist

- Whitelists in `<name>.constants.ts` contain only non-sensitive columns; `FIELDS` excludes `id` (always selected).
- Filters: one explicit DTO property per filter, ranges as `<field>From` / `<field>To`, enums as arrays via `toArray`.
- Every filter or sort column is covered by an index.
- Drop `version` / `updateIfVersion` only if concurrent edits are impossible for this resource.
- Resources without an owner: replace `assertOwner` with role checks (`@Roles`) or plain existence checks.
- Multi-write operations (e.g. create + audit row) go through `prisma.$transaction(async (tx) => ...)`, passing `tx`
  to repository methods; emails and other side effects run after commit.
- Add `@Idempotent()` to create/side-effect endpoints once the idempotency foundation exists.
