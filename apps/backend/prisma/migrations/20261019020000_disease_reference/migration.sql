-- "Molim kasal" disease reference: the source text (verbatim), its groups and
-- its diseases, parsed by src/diseases/disease-source.parser.ts and loaded by
-- the idempotent disease seed. Read-only reference data: every row is
-- immutable, a corrected text is loaded under a new source key.
--
-- Sections after the Prisma-generated part (CHECK constraints, triggers,
-- grants) cannot be expressed in schema.prisma. Prisma ignores these objects
-- when diffing, so later migrations will not drop them.

-- CreateEnum
CREATE TYPE "DiseaseAnimal" AS ENUM ('CATTLE', 'CALF', 'SHEEP', 'LAMB');

-- CreateEnum
CREATE TYPE "DiseaseInfoStatus" AS ENUM ('SOURCE_TEXT');

-- CreateTable
CREATE TABLE "disease_sources" (
    "id" UUID NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "abbreviations" TEXT NOT NULL,
    "full_text" TEXT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disease_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disease_groups" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "disease_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diseases" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scientific_names" TEXT,
    "symptoms" TEXT,
    "animals" "DiseaseAnimal"[],
    "lines" JSONB NOT NULL,
    "full_text" TEXT NOT NULL,
    "search_text" TEXT NOT NULL,
    "status" "DiseaseInfoStatus" NOT NULL DEFAULT 'SOURCE_TEXT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diseases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disease_sources_key_key" ON "disease_sources"("key");

-- CreateIndex
CREATE UNIQUE INDEX "disease_groups_source_id_number_key" ON "disease_groups"("source_id", "number");

-- CreateIndex
CREATE INDEX "diseases_group_id_idx" ON "diseases"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "diseases_source_id_number_key" ON "diseases"("source_id", "number");

-- AddForeignKey
ALTER TABLE "disease_groups" ADD CONSTRAINT "disease_groups_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "disease_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diseases" ADD CONSTRAINT "diseases_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "disease_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diseases" ADD CONSTRAINT "diseases_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "disease_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =========================================================================
-- CHECK constraints
-- =========================================================================

ALTER TABLE "disease_sources"
  ADD CONSTRAINT "disease_sources_key_chk" CHECK ("key" ~ '^[a-z0-9][a-z0-9-]{1,49}$'),
  ADD CONSTRAINT "disease_sources_checksum_chk" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "disease_sources_text_chk" CHECK (
    char_length(btrim("abbreviations")) > 0 AND char_length(btrim("full_text")) > 0
  );

ALTER TABLE "disease_groups"
  ADD CONSTRAINT "disease_groups_number_chk" CHECK ("number" >= 1),
  ADD CONSTRAINT "disease_groups_text_chk" CHECK (
    char_length(btrim("heading")) > 0 AND char_length(btrim("title")) > 0
  );

ALTER TABLE "diseases"
  ADD CONSTRAINT "diseases_number_chk" CHECK ("number" >= 1),
  ADD CONSTRAINT "diseases_text_chk" CHECK (
    char_length(btrim("title")) > 0
    AND char_length(btrim("name")) > 0
    AND char_length(btrim("full_text")) > 0
    AND char_length(btrim("search_text")) > 0
  ),
  ADD CONSTRAINT "diseases_animals_chk" CHECK ("animals" IS NOT NULL AND cardinality("animals") >= 1),
  ADD CONSTRAINT "diseases_lines_chk" CHECK (jsonb_typeof("lines") = 'array');

-- =========================================================================
-- Consistency: a disease's group belongs to the disease's source
-- =========================================================================

CREATE OR REPLACE FUNCTION "diseases_check_group_source"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "disease_groups" g
    WHERE g."id" = NEW."group_id" AND g."source_id" = NEW."source_id"
  ) THEN
    RAISE EXCEPTION 'disease group does not belong to the disease source'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "diseases_check_group_source"
  BEFORE INSERT ON "diseases"
  FOR EACH ROW EXECUTE FUNCTION "diseases_check_group_source"();

-- =========================================================================
-- Immutable reference data: UPDATE, DELETE and TRUNCATE are rejected
-- =========================================================================

CREATE TRIGGER "disease_sources_immutable"
  BEFORE UPDATE OR DELETE ON "disease_sources"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation"();
CREATE TRIGGER "disease_sources_no_truncate"
  BEFORE TRUNCATE ON "disease_sources"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation"();

CREATE TRIGGER "disease_groups_immutable"
  BEFORE UPDATE OR DELETE ON "disease_groups"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation"();
CREATE TRIGGER "disease_groups_no_truncate"
  BEFORE TRUNCATE ON "disease_groups"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation"();

CREATE TRIGGER "diseases_immutable"
  BEFORE UPDATE OR DELETE ON "diseases"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation"();
CREATE TRIGGER "diseases_no_truncate"
  BEFORE TRUNCATE ON "diseases"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation"();

-- =========================================================================
-- Least-privilege runtime role (see docs/operations/database.md)
-- =========================================================================
-- The default privileges of 20261016000100 granted SELECT/INSERT/UPDATE on
-- these new tables; reference data gets SELECT/INSERT only (the disease
-- seed may run as the runtime role).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meningfermam_app') THEN
    REVOKE ALL ON "disease_sources", "disease_groups", "diseases" FROM meningfermam_app;
    GRANT SELECT, INSERT ON "disease_sources", "disease_groups", "diseases"
      TO meningfermam_app;
  END IF;
END;
$$;
