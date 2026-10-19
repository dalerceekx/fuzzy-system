-- Feed warehouse prices and feed rations: unit price / low-stock threshold on
-- inventory items, per-farm animal types, rations with their feed lines, and
-- append-only ration issues that write OUT stock movements.
--
-- Sections after the Prisma-generated part (data backfill, CHECK
-- constraints, partial unique indexes, triggers, grants) cannot be expressed
-- in schema.prisma. Prisma ignores these objects when diffing, so later
-- migrations will not drop them.

-- CreateEnum
CREATE TYPE "RationProfile" AS ENUM ('BULL', 'COW', 'RAM', 'EWE', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedingPurpose" AS ENUM ('FATTENING', 'MAINTENANCE', 'MILK', 'BREEDING');

-- CreateEnum
CREATE TYPE "PhysiologicalState" AS ENUM ('NORMAL', 'PREGNANT', 'LACTATING', 'DRY');

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "min_quantity" DECIMAL(14,3),
ADD COLUMN     "unit_price" DECIMAL(16,2);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "ration_issue_id" UUID;

-- CreateTable
CREATE TABLE "ration_animal_types" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "profile" "RationProfile" NOT NULL DEFAULT 'OTHER',
    "species" "Species" NOT NULL,
    "sex" "AnimalSex",
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ration_animal_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rations" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_type_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "animal_count" INTEGER NOT NULL,
    "average_weight_kg" DECIMAL(8,2),
    "age_months" INTEGER,
    "purpose" "FeedingPurpose" NOT NULL,
    "physiological_state" "PhysiologicalState",
    "milk_yield_liters" DECIMAL(6,2),
    "days" INTEGER NOT NULL,
    "notes" VARCHAR(500),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ration_items" (
    "id" UUID NOT NULL,
    "ration_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "daily_per_animal" DECIMAL(9,3) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ration_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ration_issues" (
    "id" UUID NOT NULL,
    "ration_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "days" INTEGER NOT NULL,
    "animal_count" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ration_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ration_animal_types_farm_id_archived_at_idx" ON "ration_animal_types"("farm_id", "archived_at");

-- CreateIndex
CREATE INDEX "rations_farm_id_archived_at_idx" ON "rations"("farm_id", "archived_at");

-- CreateIndex
CREATE INDEX "rations_animal_type_id_archived_at_idx" ON "rations"("animal_type_id", "archived_at");

-- CreateIndex
CREATE INDEX "ration_items_inventory_item_id_idx" ON "ration_items"("inventory_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ration_items_ration_id_inventory_item_id_key" ON "ration_items"("ration_id", "inventory_item_id");

-- CreateIndex
CREATE INDEX "ration_issues_ration_id_created_at_idx" ON "ration_issues"("ration_id", "created_at");

-- CreateIndex
CREATE INDEX "ration_issues_farm_id_created_at_idx" ON "ration_issues"("farm_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_ration_issue_id_idx" ON "stock_movements"("ration_issue_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ration_issue_id_fkey" FOREIGN KEY ("ration_issue_id") REFERENCES "ration_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_animal_types" ADD CONSTRAINT "ration_animal_types_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rations" ADD CONSTRAINT "rations_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rations" ADD CONSTRAINT "rations_animal_type_id_fkey" FOREIGN KEY ("animal_type_id") REFERENCES "ration_animal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_items" ADD CONSTRAINT "ration_items_ration_id_fkey" FOREIGN KEY ("ration_id") REFERENCES "rations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_items" ADD CONSTRAINT "ration_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_issues" ADD CONSTRAINT "ration_issues_ration_id_fkey" FOREIGN KEY ("ration_id") REFERENCES "rations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_issues" ADD CONSTRAINT "ration_issues_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_issues" ADD CONSTRAINT "ration_issues_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =========================================================================
-- Data backfill
-- =========================================================================

-- The current price of an item is the unit cost of its latest priced IN
-- movement (the API keeps it that way from now on).
UPDATE "inventory_items" i
SET "unit_price" = latest."unit_cost"
FROM (
  SELECT DISTINCT ON ("item_id") "item_id", "unit_cost"
  FROM "stock_movements"
  WHERE "type" = 'IN' AND "unit_cost" IS NOT NULL
  ORDER BY "item_id", "created_at" DESC, "id" DESC
) latest
WHERE latest."item_id" = i."id";

-- =========================================================================
-- inventory_items, stock_movements
-- =========================================================================

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_unit_price_chk" CHECK ("unit_price" IS NULL OR "unit_price" >= 0),
  ADD CONSTRAINT "inventory_items_min_quantity_chk" CHECK ("min_quantity" IS NULL OR "min_quantity" >= 0);

ALTER TABLE "stock_movements"
  -- Only the OUT movements written by a ration issue reference it.
  ADD CONSTRAINT "stock_movements_ration_issue_out_chk" CHECK ("ration_issue_id" IS NULL OR "type" = 'OUT');

-- A ration issue's movements are recorded against the issue's farm.
CREATE OR REPLACE FUNCTION "stock_movements_check_ration_issue"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ration_issue_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ration_issues" ri
    WHERE ri."id" = NEW."ration_issue_id" AND ri."farm_id" = NEW."farm_id"
  ) THEN
    RAISE EXCEPTION 'stock movement farm does not match ration issue farm'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "stock_movements_check_ration_issue"
  BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_check_ration_issue"();

-- =========================================================================
-- ration_animal_types
-- =========================================================================

ALTER TABLE "ration_animal_types"
  ADD CONSTRAINT "ration_animal_types_name_chk" CHECK (char_length(btrim("name")) > 0),
  -- NULL means "any sex"; UNKNOWN describes an animal, not a category.
  ADD CONSTRAINT "ration_animal_types_sex_chk" CHECK ("sex" IS NULL OR "sex" IN ('MALE', 'FEMALE')),
  -- Default types have a real profile and are never archived.
  ADD CONSTRAINT "ration_animal_types_default_chk" CHECK (NOT "is_default" OR ("profile" <> 'OTHER' AND "archived_at" IS NULL));

-- One default type per profile and farm (created lazily with
-- INSERT … ON CONFLICT DO NOTHING, so concurrent listings never duplicate).
CREATE UNIQUE INDEX "ration_animal_types_farm_default_key"
  ON "ration_animal_types"("farm_id", "profile")
  WHERE "is_default";

-- Names are unique per farm among non-archived types, case-insensitively.
CREATE UNIQUE INDEX "ration_animal_types_farm_name_active_key"
  ON "ration_animal_types"("farm_id", lower("name"))
  WHERE "archived_at" IS NULL;

-- =========================================================================
-- rations, ration_items
-- =========================================================================

ALTER TABLE "rations"
  ADD CONSTRAINT "rations_name_chk" CHECK (char_length(btrim("name")) > 0),
  ADD CONSTRAINT "rations_animal_count_chk" CHECK ("animal_count" BETWEEN 1 AND 1000000),
  ADD CONSTRAINT "rations_average_weight_chk" CHECK ("average_weight_kg" IS NULL OR "average_weight_kg" > 0),
  ADD CONSTRAINT "rations_age_months_chk" CHECK ("age_months" IS NULL OR "age_months" BETWEEN 0 AND 600),
  ADD CONSTRAINT "rations_milk_yield_chk" CHECK ("milk_yield_liters" IS NULL OR "milk_yield_liters" >= 0),
  ADD CONSTRAINT "rations_days_chk" CHECK ("days" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "rations_notes_chk" CHECK ("notes" IS NULL OR char_length(btrim("notes")) > 0);

-- A ration's animal type belongs to the ration's farm.
CREATE OR REPLACE FUNCTION "rations_check_animal_type_farm"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ration_animal_types" t
    WHERE t."id" = NEW."animal_type_id" AND t."farm_id" = NEW."farm_id"
  ) THEN
    RAISE EXCEPTION 'ration farm does not match animal type farm'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rations_check_animal_type_farm"
  BEFORE INSERT OR UPDATE OF "animal_type_id", "farm_id" ON "rations"
  FOR EACH ROW EXECUTE FUNCTION "rations_check_animal_type_farm"();

ALTER TABLE "ration_items"
  ADD CONSTRAINT "ration_items_daily_chk" CHECK ("daily_per_animal" > 0),
  ADD CONSTRAINT "ration_items_position_chk" CHECK ("position" >= 0);

-- A ration feeds only FEED items of its own farm.
CREATE OR REPLACE FUNCTION "ration_items_check_item"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "inventory_items" i JOIN "rations" r ON r."farm_id" = i."farm_id"
    WHERE i."id" = NEW."inventory_item_id" AND r."id" = NEW."ration_id"
      AND i."category" = 'FEED'
  ) THEN
    RAISE EXCEPTION 'ration item must be a FEED item of the ration farm'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ration_items_check_item"
  BEFORE INSERT OR UPDATE OF "inventory_item_id", "ration_id" ON "ration_items"
  FOR EACH ROW EXECUTE FUNCTION "ration_items_check_item"();

-- =========================================================================
-- ration_issues (append-only)
-- =========================================================================

ALTER TABLE "ration_issues"
  ADD CONSTRAINT "ration_issues_days_chk" CHECK ("days" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "ration_issues_animal_count_chk" CHECK ("animal_count" BETWEEN 1 AND 1000000);

-- An issue is recorded against the farm that owns the ration.
CREATE OR REPLACE FUNCTION "ration_issues_check_farm"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "rations" r
    WHERE r."id" = NEW."ration_id" AND r."farm_id" = NEW."farm_id"
  ) THEN
    RAISE EXCEPTION 'ration issue farm does not match ration farm'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ration_issues_check_farm"
  BEFORE INSERT ON "ration_issues"
  FOR EACH ROW EXECUTE FUNCTION "ration_issues_check_farm"();
CREATE TRIGGER "ration_issues_append_only"
  BEFORE UPDATE OR DELETE ON "ration_issues"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation"();
CREATE TRIGGER "ration_issues_no_truncate"
  BEFORE TRUNCATE ON "ration_issues"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation"();

-- =========================================================================
-- Least-privilege runtime role (see docs/operations/database.md)
-- =========================================================================
-- New tables already received SELECT/INSERT/UPDATE through the default
-- privileges of 20261016000100; stated explicitly here, then tightened:
-- ration_issues is append-only (no UPDATE), and ration_items needs DELETE
-- because PATCH /rations/:id replaces the whole feed list.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meningfermam_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "ration_animal_types", "rations", "ration_items"
      TO meningfermam_app;
    GRANT DELETE ON "ration_items" TO meningfermam_app;
    REVOKE ALL ON "ration_issues" FROM meningfermam_app;
    GRANT SELECT, INSERT ON "ration_issues" TO meningfermam_app;
  END IF;
END;
$$;
