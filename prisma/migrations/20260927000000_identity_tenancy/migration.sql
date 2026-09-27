-- Rename the existing Club tenant in place so its records and foreign keys survive.
-- Refuse ambiguous legacy assignments instead of silently dropping tenant data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User"
    WHERE "role"::text = 'CHAMPIONSHIP_ADMIN' AND "clubId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot migrate a CHAMPIONSHIP_ADMIN user without a Club; assign the user to a Club first.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Team" t
    JOIN "Championship" c ON c."id" = t."championshipId"
    WHERE t."clubId" IS NOT NULL AND t."clubId" <> c."clubId"
  ) THEN
    RAISE EXCEPTION 'Cannot migrate a Team whose Club differs from its Championship Club.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Match" m
    LEFT JOIN "Team" h ON h."id" = m."homeTeamId"
    LEFT JOIN "Team" a ON a."id" = m."awayTeamId"
    WHERE h."championshipId" IS DISTINCT FROM m."championshipId"
       OR a."championshipId" IS DISTINCT FROM m."championshipId"
  ) THEN
    RAISE EXCEPTION 'Cannot migrate a Match whose home or away Team belongs to a different Championship.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Match" m
    JOIN "Phase" p ON p."id" = m."phaseId"
    WHERE p."championshipId" <> m."championshipId"
  ) THEN
    RAISE EXCEPTION 'Cannot migrate a Match whose Phase belongs to a different Championship.';
  END IF;
END $$;

ALTER TABLE "User" DROP CONSTRAINT "User_clubId_fkey";
ALTER TABLE "Championship" DROP CONSTRAINT "Championship_clubId_fkey";
ALTER TABLE "Team" DROP CONSTRAINT "Team_clubId_fkey";
ALTER TABLE "Team" DROP CONSTRAINT "Team_championshipId_fkey";
ALTER TABLE "Match" DROP CONSTRAINT "Match_phaseId_fkey";
ALTER TABLE "Match" DROP CONSTRAINT "Match_homeTeamId_fkey";
ALTER TABLE "Match" DROP CONSTRAINT "Match_awayTeamId_fkey";

ALTER TABLE "Club" RENAME TO "Organization";
ALTER TABLE "Organization" RENAME CONSTRAINT "Club_pkey" TO "Organization_pkey";
ALTER TABLE "Championship" RENAME COLUMN "clubId" TO "organizationId";
ALTER TABLE "Team" RENAME COLUMN "clubId" TO "organizationId";

ALTER TABLE "Organization"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Generate URL-friendly slugs for existing organizations. Duplicate names get a
-- stable suffix derived from the existing primary key, preserving all records.
WITH normalized AS (
  SELECT
    "id",
    NULLIF(
      trim(both '-' FROM regexp_replace(
        translate(lower("name"), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')),
        '[^a-z0-9]+', '-', 'g'
      )),
      ''
    ) AS base_slug
  FROM "Organization"
), ranked AS (
  SELECT
    "id",
    COALESCE(base_slug, 'organization') AS base_slug,
    count(*) OVER (PARTITION BY COALESCE(base_slug, 'organization')) AS slug_count
  FROM normalized
)
UPDATE "Organization" o
SET "slug" = CASE
  WHEN r.slug_count = 1 THEN r.base_slug
  ELSE r.base_slug || '-' || substr(md5(r."id"), 1, 8)
END
FROM ranked r
WHERE r."id" = o."id";

UPDATE "Organization" SET "updatedAt" = CURRENT_TIMESTAMP;
ALTER TABLE "Organization" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Organization" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TYPE "PlatformRole" AS ENUM ('MASTER_ADMIN');
CREATE TYPE "OrganizationMemberRole" AS ENUM ('CHAMPIONSHIP_ADMIN');

CREATE TABLE "OrganizationMember" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "role" "OrganizationMemberRole" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- A legacy Club assignment means the user belonged to that tenant. Preserve it
-- as a scoped membership before removing the old single-Club User column.
INSERT INTO "OrganizationMember" (
  "id", "userId", "organizationId", "role", "active", "createdAt", "updatedAt"
)
SELECT
  'legacy-organization-member:' || u."id",
  u."id",
  u."clubId",
  'CHAMPIONSHIP_ADMIN'::"OrganizationMemberRole",
  true,
  u."createdAt",
  u."updatedAt"
FROM "User" u
WHERE u."clubId" IS NOT NULL;

ALTER TYPE "UserRole" RENAME TO "LegacyUserRole";
ALTER TABLE "User" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "PlatformRole"
  USING CASE
    WHEN "role"::text = 'MASTER' THEN 'MASTER_ADMIN'::"PlatformRole"
    ELSE NULL
  END;
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" DROP COLUMN "clubId";
DROP TYPE "LegacyUserRole";

-- Existing teams retain their direct Organization relation. For teams already
-- tied to a Championship, fill a missing organization from that Championship.
UPDATE "Team" t
SET "organizationId" = c."organizationId"
FROM "Championship" c
WHERE t."championshipId" = c."id"
  AND t."organizationId" IS NULL;

ALTER TABLE "OrganizationMember"
  ADD CONSTRAINT "OrganizationMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganizationMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OrganizationMember_userId_organizationId_key"
  ON "OrganizationMember"("userId", "organizationId");
CREATE INDEX "OrganizationMember_organizationId_idx"
  ON "OrganizationMember"("organizationId");

ALTER TABLE "Championship"
  ADD CONSTRAINT "Championship_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Championship_id_organizationId_key" UNIQUE ("id", "organizationId");
CREATE INDEX "Championship_organizationId_idx" ON "Championship"("organizationId");

ALTER TABLE "Phase"
  ADD CONSTRAINT "Phase_id_championshipId_key" UNIQUE ("id", "championshipId");

ALTER TABLE "Team"
  ADD CONSTRAINT "Team_championship_requires_organization_check"
    CHECK ("championshipId" IS NULL OR "organizationId" IS NOT NULL),
  ADD CONSTRAINT "Team_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Team_championshipId_organizationId_fkey"
    FOREIGN KEY ("championshipId", "organizationId")
    REFERENCES "Championship"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "Team_id_championshipId_key" UNIQUE ("id", "championshipId");
CREATE INDEX "Team_championshipId_idx" ON "Team"("championshipId");
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");

ALTER TABLE "Match"
  ADD CONSTRAINT "Match_phaseId_championshipId_fkey"
    FOREIGN KEY ("phaseId", "championshipId")
    REFERENCES "Phase"("id", "championshipId") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "Match_homeTeamId_championshipId_fkey"
    FOREIGN KEY ("homeTeamId", "championshipId")
    REFERENCES "Team"("id", "championshipId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Match_awayTeamId_championshipId_fkey"
    FOREIGN KEY ("awayTeamId", "championshipId")
    REFERENCES "Team"("id", "championshipId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Phase_championshipId_idx" ON "Phase"("championshipId");
CREATE INDEX "Match_championshipId_idx" ON "Match"("championshipId");
CREATE INDEX "MatchRoster_matchId_idx" ON "MatchRoster"("matchId");
CREATE INDEX "MatchEvent_matchId_idx" ON "MatchEvent"("matchId");
CREATE INDEX "Award_championshipId_idx" ON "Award"("championshipId");
CREATE INDEX "Sponsor_championshipId_idx" ON "Sponsor"("championshipId");
CREATE INDEX "Comment_championshipId_idx" ON "Comment"("championshipId");