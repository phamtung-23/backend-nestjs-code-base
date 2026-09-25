-- Emails are normalized to lowercase on input from now on. Runs before any
-- other change of this release and never fails, so a problem here can't leave
-- the database unusable for either version.

-- Lowercase every email that doesn't collide with another account
UPDATE "public"."users" AS u
SET "email" = LOWER(u."email")
WHERE u."email" <> LOWER(u."email")
  AND NOT EXISTS (
    SELECT 1 FROM "public"."users" AS o
    WHERE LOWER(o."email") = LOWER(u."email") AND o."id" <> u."id"
  );

-- New and updated rows must be lowercase. NOT VALID skips existing rows, so
-- accounts that differ only by case (left untouched above) don't block the
-- migration. Find them with:
--   SELECT LOWER(email), array_agg(id || ' ' || email) FROM users
--   GROUP BY 1 HAVING COUNT(*) > 1;
-- merge or rename them by hand, then run:
--   ALTER TABLE users VALIDATE CONSTRAINT users_email_lowercase_check;
ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = LOWER("email")) NOT VALID;
