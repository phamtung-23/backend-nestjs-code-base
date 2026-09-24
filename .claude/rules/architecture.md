---
paths:
  - "backend/src/**/*.ts"
---

# Architecture & SOLID

## Module layout

One folder per bounded context in `backend/src/modules/<name>/`. Resource modules use the plural kebab-case
resource name (`users`, `order-items`).

```text
modules/<name>/
  <name>.module.ts
  <name>.controller.ts     HTTP only: take DTOs, call the service, wrap with ResponseHelper
  <name>.service.ts        business rules, orchestration, transactions
  <name>.repository.ts     Prisma access only (queries, select/include maps)
  <name>.constants.ts      whitelists (sort/fields/include/search), limits, module error codes
  dto/                     create-<entity>.dto.ts, update-<entity>.dto.ts,
                           list-<entities>-query.dto.ts, <entity>-response.dto.ts
  interfaces/              types and ports local to the module
  *.spec.ts                next to the file under test
```

Cross-cutting code lives in
`src/common/{constants,context,decorators,dto,filters,guards,helpers,interceptors,interfaces,logger,middleware,pipes,query}`;
app wiring in `src/app.setup.ts`; env declarations in `src/config/`.
Only generic code goes there — nothing that knows about a specific module.

## Layering (dependencies point inward)

`controller → service → repository → PrismaService`

- Controllers never inject `PrismaService` or repositories and hold no business logic or control-flow try/catch.
- Services never import Express types (`Request`, `Response`); pass plain values (`userId`, `ip`, `userAgent`).
- Repositories hold no business rules and never throw `HttpException`; they return data or `null`. Every method
  accepts an optional `tx?: Prisma.TransactionClient` so services can compose them in one transaction.
- A module uses another module only through that module's exported service — never its repository.
- Circular module dependencies are a design smell: extract a shared service instead of `forwardRef`.

## SOLID in practice

- **S** — one reason to change per class. A service that grows past ~300 lines or mixes concerns
  (tokens + OTP + passwords) gets split into focused services.
- **O** — extend by adding providers/strategies, not `if/else` on type flags. Whitelists and maps live in
  `<name>.constants.ts`, not in switch statements scattered through the code.
- **L** — every implementation of a port keeps the same contract, including error semantics.
- **I** — small ports (`MailSender.send()`), not one god-interface.
- **D** — external systems (mail, storage, payment, SMS, third-party APIs) sit behind an interface + injection
  token; business code never imports nodemailer or SDKs directly:

```ts
export const MAIL_SENDER = Symbol('MAIL_SENDER');
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}
// module:  providers: [{ provide: MAIL_SENDER, useClass: SmtpMailSender }]
// service: constructor(@Inject(MAIL_SENDER) private readonly mailSender: MailSender) {}
```

## Configuration

- Read config through `ConfigService` only — never `process.env` outside bootstrap/config files.
- Every env var is declared and validated in `src/config/env.validation.ts` (`EnvironmentVariables`, wired through
  `ConfigModule.forRoot({ validate })`); the app refuses to start on invalid config. Validated values are typed
  (numbers, booleans), so `ConfigService.get<number>('PORT')` returns a number. Required values also use
  `getOrThrow` where they're read. Grouping settings with `registerAs` namespaces (e.g. `auth.accessTokenTtl`) is
  still a target — see CLAUDE.md "Foundations status".
- No magic numbers or strings in services: durations, limits and keys go into `<name>.constants.ts` or config.
- A new env var goes to `EnvironmentVariables`, `.env.sample`, `backend/.env.example`, every `docker-compose*.yml` backend `environment`
  block, and the validation schema — in the same change.

## Code style

- TypeScript strict; no `any` in exported signatures; constructor dependencies are `private readonly`.
- Prettier (single quotes, trailing commas) + ESLint (typescript-eslint `recommendedTypeChecked`). A PostToolUse
  hook formats files after each edit; `yarn lint:check` must stay clean.
- Async all the way; no floating promises.
- Logging via `new Logger(ClassName.name)`; no `console.log` except the bootstrap banner in `main.ts`.
- Comments explain why, not what; match the surrounding comment density.
