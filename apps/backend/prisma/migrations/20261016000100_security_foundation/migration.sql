-- Security foundation: identity/session/OTP/audit tables, farm, inventory and
-- veterinary domain, plus database-level integrity guarantees.
--
-- Sections after the Prisma-generated part (CHECK constraints, partial unique
-- indexes, triggers, grants) cannot be expressed in schema.prisma. Prisma
-- ignores these objects when diffing, so later migrations will not drop them.

-- Case-insensitive email uniqueness (trusted extension; no superuser needed).
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'BLOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SessionRevokeReason" AS ENUM ('LOGOUT', 'LOGOUT_ALL', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'ROLE_CHANGED', 'USER_BLOCKED', 'USER_ARCHIVED', 'REFRESH_TOKEN_REUSE', 'MFA_RESET', 'ADMIN_REVOKED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('PHONE_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "Species" AS ENUM ('CATTLE', 'SHEEP', 'GOAT', 'HORSE', 'POULTRY', 'OTHER');

-- CreateEnum
CREATE TYPE "AnimalSex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('MEDICINE', 'FEED', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryUnit" AS ENUM ('PIECE', 'KG', 'G', 'L', 'ML', 'DOSE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateEnum
CREATE TYPE "MedicineStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProtocolVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DoseUnit" AS ENUM ('MG', 'ML');

-- CreateEnum
CREATE TYPE "AdministrationRoute" AS ENUM ('IM', 'IV', 'SC', 'ORAL', 'TOPICAL', 'INTRAMAMMARY', 'OTHER');

-- CreateEnum
CREATE TYPE "TreatmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "blocked_at" TIMESTAMP(3),
ADD COLUMN     "blocked_reason" VARCHAR(500),
ADD COLUMN     "email" CITEXT,
ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_last_used_step" INTEGER,
ADD COLUMN     "mfa_pending_secret_enc" VARCHAR(512),
ADD COLUMN     "mfa_secret_enc" VARCHAR(512),
ADD COLUMN     "password_changed_at" TIMESTAMP(3),
ADD COLUMN     "phone_verified_at" TIMESTAMP(3),
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
ALTER COLUMN "phone" SET DATA TYPE VARCHAR(16),
ALTER COLUMN "full_name" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "password_hash" SET DATA TYPE VARCHAR(255);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "current_refresh_jti" UUID NOT NULL,
    "refresh_count" INTEGER NOT NULL DEFAULT 0,
    "mfa_verified_at" TIMESTAMP(3),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" "SessionRevokeReason",

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "send_count" INTEGER NOT NULL DEFAULT 1,
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL,
    "phone_masked" VARCHAR(20) NOT NULL,
    "purpose" VARCHAR(50) NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" VARCHAR(30) NOT NULL,
    "provider_message_id" VARCHAR(100),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" "UserRole",
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" VARCHAR(100),
    "old_value" JSONB,
    "new_value" JSONB,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(64),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scan_status" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "metadata_stripped" BOOLEAN NOT NULL DEFAULT false,
    "animal_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "region" VARCHAR(100),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animals" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "tag_number" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100),
    "species" "Species" NOT NULL,
    "sex" "AnimalSex" NOT NULL DEFAULT 'UNKNOWN',
    "birth_date" DATE,
    "weight_kg" DECIMAL(8,2),
    "notes" VARCHAR(1000),
    "archived_at" TIMESTAMP(3),
    "archived_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "InventoryCategory" NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "medicine_id" UUID,
    "batch_number" VARCHAR(64),
    "expires_on" DATE,
    "opened_at" TIMESTAMP(3),
    "use_within_days_after_opening" INTEGER,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "balance_after" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(16,2),
    "currency" CHAR(3),
    "reason" VARCHAR(500),
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicines" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "active_ingredient" VARCHAR(150) NOT NULL,
    "form" VARCHAR(50),
    "concentration" VARCHAR(50),
    "withdrawal_meat_days" INTEGER NOT NULL,
    "withdrawal_milk_days" INTEGER NOT NULL,
    "status" "MedicineStatus" NOT NULL DEFAULT 'DRAFT',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocols" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "species" "Species" NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_versions" (
    "id" UUID NOT NULL,
    "protocol_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProtocolVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(200) NOT NULL,
    "condition" VARCHAR(200) NOT NULL,
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "instructions" VARCHAR(5000) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "protocol_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_drugs" (
    "id" UUID NOT NULL,
    "protocol_version_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "dose_per_kg" DECIMAL(10,4) NOT NULL,
    "dose_unit" "DoseUnit" NOT NULL,
    "max_single_dose" DECIMAL(12,4),
    "route" "AdministrationRoute" NOT NULL,
    "frequency_per_day" INTEGER NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "protocol_drugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatments" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "protocol_version_id" UUID NOT NULL,
    "started_by_id" UUID NOT NULL,
    "status" "TreatmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_on" DATE NOT NULL,
    "animal_weight_kg" DECIMAL(8,2) NOT NULL,
    "protocol_snapshot" JSONB NOT NULL,
    "withdrawal_meat_until" DATE NOT NULL,
    "withdrawal_milk_until" DATE NOT NULL,
    "notes" VARCHAR(1000),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_doses" (
    "id" UUID NOT NULL,
    "treatment_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "inventory_item_id" UUID,
    "medicine_name" VARCHAR(150) NOT NULL,
    "dose_per_kg" DECIMAL(10,4) NOT NULL,
    "dose_unit" "DoseUnit" NOT NULL,
    "single_dose" DECIMAL(12,4) NOT NULL,
    "route" "AdministrationRoute" NOT NULL,
    "frequency_per_day" INTEGER NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "withdrawal_meat_days" INTEGER NOT NULL,
    "withdrawal_milk_days" INTEGER NOT NULL,
    "batch_number" VARCHAR(64),
    "item_expires_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treatment_doses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "otp_codes_user_id_purpose_idx" ON "otp_codes"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_provider_message_id_key" ON "sms_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "sms_messages_status_created_at_idx" ON "sms_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_timestamp_idx" ON "audit_logs"("actor_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_scope_key_key" ON "idempotency_keys"("user_id", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "stored_files_owner_id_deleted_at_idx" ON "stored_files"("owner_id", "deleted_at");

-- CreateIndex
CREATE INDEX "stored_files_animal_id_idx" ON "stored_files"("animal_id");

-- CreateIndex
CREATE INDEX "farms_owner_id_archived_at_idx" ON "farms"("owner_id", "archived_at");

-- CreateIndex
CREATE INDEX "animals_farm_id_archived_at_idx" ON "animals"("farm_id", "archived_at");

-- CreateIndex
CREATE INDEX "animals_farm_id_tag_number_idx" ON "animals"("farm_id", "tag_number");

-- CreateIndex
CREATE INDEX "inventory_items_farm_id_archived_at_idx" ON "inventory_items"("farm_id", "archived_at");

-- CreateIndex
CREATE INDEX "inventory_items_medicine_id_idx" ON "inventory_items"("medicine_id");

-- CreateIndex
CREATE INDEX "stock_movements_item_id_created_at_idx" ON "stock_movements"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_farm_id_created_at_idx" ON "stock_movements"("farm_id", "created_at");

-- CreateIndex
CREATE INDEX "medicines_status_idx" ON "medicines"("status");

-- CreateIndex
CREATE UNIQUE INDEX "protocols_code_key" ON "protocols"("code");

-- CreateIndex
CREATE INDEX "protocols_species_idx" ON "protocols"("species");

-- CreateIndex
CREATE INDEX "protocol_versions_status_idx" ON "protocol_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_versions_protocol_id_version_key" ON "protocol_versions"("protocol_id", "version");

-- CreateIndex
CREATE INDEX "protocol_drugs_medicine_id_idx" ON "protocol_drugs"("medicine_id");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_drugs_protocol_version_id_medicine_id_key" ON "protocol_drugs"("protocol_version_id", "medicine_id");

-- CreateIndex
CREATE INDEX "treatments_animal_id_started_at_idx" ON "treatments"("animal_id", "started_at");

-- CreateIndex
CREATE INDEX "treatments_farm_id_status_idx" ON "treatments"("farm_id", "status");

-- CreateIndex
CREATE INDEX "treatment_doses_treatment_id_idx" ON "treatment_doses"("treatment_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "protocols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_drugs" ADD CONSTRAINT "protocol_drugs_protocol_version_id_fkey" FOREIGN KEY ("protocol_version_id") REFERENCES "protocol_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_drugs" ADD CONSTRAINT "protocol_drugs_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_protocol_version_id_fkey" FOREIGN KEY ("protocol_version_id") REFERENCES "protocol_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_doses" ADD CONSTRAINT "treatment_doses_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_doses" ADD CONSTRAINT "treatment_doses_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_doses" ADD CONSTRAINT "treatment_doses_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =========================================================================
-- Data backfill
-- =========================================================================

-- Accounts created before phone verification existed were already active.
UPDATE "users"
SET "status" = 'ACTIVE',
    "phone_verified_at" = COALESCE("phone_verified_at", "created_at")
WHERE "status" = 'PENDING_VERIFICATION';

-- =========================================================================
-- Shared trigger functions
-- =========================================================================

-- Append-only tables: any UPDATE, DELETE or TRUNCATE is rejected.
CREATE OR REPLACE FUNCTION "reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- =========================================================================
-- users
-- =========================================================================

ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_e164_chk" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "users_email_normalized_chk" CHECK (
    "email" IS NULL OR (
      "email"::text = lower(btrim("email"::text))
      AND char_length("email"::text) <= 254
      AND "email"::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  ),
  ADD CONSTRAINT "users_full_name_chk" CHECK (char_length(btrim("full_name")) > 0),
  -- An account is never fully active before its phone is verified.
  ADD CONSTRAINT "users_active_requires_verified_phone_chk" CHECK ("status" <> 'ACTIVE' OR "phone_verified_at" IS NOT NULL),
  ADD CONSTRAINT "users_blocked_chk" CHECK ("status" <> 'BLOCKED' OR "blocked_at" IS NOT NULL),
  ADD CONSTRAINT "users_archived_chk" CHECK ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL),
  ADD CONSTRAINT "users_mfa_enabled_chk" CHECK (NOT "mfa_enabled" OR "mfa_secret_enc" IS NOT NULL),
  ADD CONSTRAINT "users_mfa_step_chk" CHECK ("mfa_last_used_step" IS NULL OR "mfa_last_used_step" >= 0);

-- Defense in depth for "the last active SUPER_ADMIN cannot be demoted,
-- blocked or archived". The application serializes these changes with an
-- advisory lock; this deferred trigger catches any code path that does not.
CREATE OR REPLACE FUNCTION "users_keep_active_super_admin"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."role" = 'SUPER_ADMIN' AND OLD."status" = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1 FROM "users" WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'at least one active SUPER_ADMIN must remain'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "users_keep_active_super_admin"
  AFTER UPDATE OR DELETE ON "users"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "users_keep_active_super_admin"();

-- =========================================================================
-- sessions
-- =========================================================================

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_refresh_count_chk" CHECK ("refresh_count" >= 0),
  ADD CONSTRAINT "sessions_expiry_chk" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "sessions_revocation_chk" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL));

CREATE INDEX "sessions_user_active_idx" ON "sessions"("user_id") WHERE "revoked_at" IS NULL;

-- =========================================================================
-- otp_codes
-- =========================================================================

ALTER TABLE "otp_codes"
  ADD CONSTRAINT "otp_codes_phone_e164_chk" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$'),
  -- Only an HMAC digest is stored, never the code itself.
  ADD CONSTRAINT "otp_codes_code_hash_chk" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "otp_codes_attempts_chk" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts"),
  ADD CONSTRAINT "otp_codes_max_attempts_chk" CHECK ("max_attempts" BETWEEN 1 AND 10),
  ADD CONSTRAINT "otp_codes_send_count_chk" CHECK ("send_count" BETWEEN 1 AND 10),
  ADD CONSTRAINT "otp_codes_expiry_chk" CHECK ("expires_at" > "created_at");

-- At most one live code per user and purpose.
CREATE UNIQUE INDEX "otp_codes_one_live_per_purpose_key"
  ON "otp_codes"("user_id", "purpose")
  WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL;

-- =========================================================================
-- sms_messages
-- =========================================================================

ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_attempts_chk" CHECK ("attempts" >= 0),
  -- Only a masked phone may be stored (e.g. +99890*****11).
  ADD CONSTRAINT "sms_messages_phone_masked_chk" CHECK ("phone_masked" ~ '\*');

-- =========================================================================
-- audit_logs (append-only)
-- =========================================================================

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_action_chk" CHECK ("action" ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$');

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation"();
CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation"();

-- =========================================================================
-- idempotency_keys
-- =========================================================================

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_key_format_chk" CHECK ("key" ~ '^[A-Za-z0-9_-]{8,128}$'),
  ADD CONSTRAINT "idempotency_keys_request_hash_chk" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_keys_expiry_chk" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "idempotency_keys_response_status_chk" CHECK ("response_status" IS NULL OR "response_status" BETWEEN 100 AND 599);

-- =========================================================================
-- stored_files
-- =========================================================================

ALTER TABLE "stored_files"
  ADD CONSTRAINT "stored_files_size_chk" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "stored_files_sha256_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "stored_files_mime_chk" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  -- Server-generated keys only: lowercase segments, no traversal, no
  -- absolute paths, allowlisted extension.
  ADD CONSTRAINT "stored_files_storage_key_chk" CHECK (
    "storage_key" ~ '^[a-z0-9]+(/[a-z0-9-]+)*\.(jpg|png|webp|pdf)$'
    AND position('..' IN "storage_key") = 0
  ),
  -- Display name only: never a path.
  ADD CONSTRAINT "stored_files_original_name_chk" CHECK (
    char_length("original_name") > 0
    AND position('/' IN "original_name") = 0
    AND position(E'\\' IN "original_name") = 0
  );

-- =========================================================================
-- farms, animals
-- =========================================================================

ALTER TABLE "farms"
  ADD CONSTRAINT "farms_name_chk" CHECK (char_length(btrim("name")) > 0);

ALTER TABLE "animals"
  ADD CONSTRAINT "animals_tag_number_chk" CHECK (char_length(btrim("tag_number")) > 0),
  ADD CONSTRAINT "animals_weight_chk" CHECK ("weight_kg" IS NULL OR ("weight_kg" > 0 AND "weight_kg" <= 5000)),
  ADD CONSTRAINT "animals_archive_reason_chk" CHECK ("archived_reason" IS NULL OR "archived_at" IS NOT NULL);

-- Tag numbers are unique per farm among non-archived animals.
CREATE UNIQUE INDEX "animals_farm_tag_active_key"
  ON "animals"("farm_id", "tag_number")
  WHERE "archived_at" IS NULL;

-- A file attached to an animal must belong to that animal's farm owner.
CREATE OR REPLACE FUNCTION "stored_files_check_animal_owner"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."animal_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "animals" a JOIN "farms" f ON f."id" = a."farm_id"
    WHERE a."id" = NEW."animal_id" AND f."owner_id" = NEW."owner_id"
  ) THEN
    RAISE EXCEPTION 'file owner does not own the animal'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "stored_files_check_animal_owner"
  BEFORE INSERT OR UPDATE OF "animal_id", "owner_id" ON "stored_files"
  FOR EACH ROW EXECUTE FUNCTION "stored_files_check_animal_owner"();

-- =========================================================================
-- inventory_items, stock_movements
-- =========================================================================

ALTER TABLE "inventory_items"
  -- Stock can never go negative, even if two requests race.
  ADD CONSTRAINT "inventory_items_quantity_non_negative_chk" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "inventory_items_name_chk" CHECK (char_length(btrim("name")) > 0),
  ADD CONSTRAINT "inventory_items_open_shelf_life_chk" CHECK ("use_within_days_after_opening" IS NULL OR "use_within_days_after_opening" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "inventory_items_medicine_category_chk" CHECK ("medicine_id" IS NULL OR "category" = 'MEDICINE');

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_positive_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "stock_movements_balance_non_negative_chk" CHECK ("balance_after" >= 0),
  ADD CONSTRAINT "stock_movements_unit_cost_chk" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0),
  ADD CONSTRAINT "stock_movements_currency_chk" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "stock_movements_cost_currency_chk" CHECK (("unit_cost" IS NULL) = ("currency" IS NULL));

-- A movement must be recorded against the farm that owns the item.
CREATE OR REPLACE FUNCTION "stock_movements_check_farm"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "inventory_items" i
    WHERE i."id" = NEW."item_id" AND i."farm_id" = NEW."farm_id"
  ) THEN
    RAISE EXCEPTION 'stock movement farm does not match item farm'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "stock_movements_check_farm"
  BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_check_farm"();
CREATE TRIGGER "stock_movements_append_only"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation"();
CREATE TRIGGER "stock_movements_no_truncate"
  BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation"();

-- =========================================================================
-- medicines
-- =========================================================================

ALTER TABLE "medicines"
  ADD CONSTRAINT "medicines_name_chk" CHECK (char_length(btrim("name")) > 0 AND char_length(btrim("active_ingredient")) > 0),
  ADD CONSTRAINT "medicines_withdrawal_chk" CHECK ("withdrawal_meat_days" BETWEEN 0 AND 3650 AND "withdrawal_milk_days" BETWEEN 0 AND 3650),
  ADD CONSTRAINT "medicines_approval_chk" CHECK ("status" <> 'APPROVED' OR ("approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL)),
  -- Demo clinical data must never look validated.
  ADD CONSTRAINT "medicines_demo_not_approved_chk" CHECK (NOT ("is_demo" AND "status" = 'APPROVED'));

-- Only a VET approves; approved clinical content is immutable; only DRAFT
-- rows can be deleted; ARCHIVED is terminal.
CREATE OR REPLACE FUNCTION "medicines_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  approver_role "UserRole";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft medicines can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'medicines are created as DRAFT' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" <> 'DRAFT' THEN
    IF NEW."name" IS DISTINCT FROM OLD."name"
       OR NEW."active_ingredient" IS DISTINCT FROM OLD."active_ingredient"
       OR NEW."form" IS DISTINCT FROM OLD."form"
       OR NEW."concentration" IS DISTINCT FROM OLD."concentration"
       OR NEW."withdrawal_meat_days" IS DISTINCT FROM OLD."withdrawal_meat_days"
       OR NEW."withdrawal_milk_days" IS DISTINCT FROM OLD."withdrawal_milk_days"
       OR NEW."is_demo" IS DISTINCT FROM OLD."is_demo"
       OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
       OR NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id"
       OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at" THEN
      RAISE EXCEPTION 'approved medicine is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'ARCHIVED' AND NEW."status" <> 'ARCHIVED' THEN
      RAISE EXCEPTION 'archived medicine cannot be restored' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'invalid medicine status transition' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW."status" = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD."status" <> 'APPROVED') THEN
    SELECT "role" INTO approver_role FROM "users" WHERE "id" = NEW."approved_by_id";
    IF approver_role IS DISTINCT FROM 'VET' THEN
      RAISE EXCEPTION 'only a VET can approve a medicine' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "medicines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "medicines"
  FOR EACH ROW EXECUTE FUNCTION "medicines_guard"();

-- =========================================================================
-- protocols, protocol_versions, protocol_drugs
-- =========================================================================

ALTER TABLE "protocols"
  ADD CONSTRAINT "protocols_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$');

ALTER TABLE "protocol_versions"
  ADD CONSTRAINT "protocol_versions_version_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "protocol_versions_approval_chk" CHECK ("status" NOT IN ('APPROVED', 'SUPERSEDED') OR ("approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL)),
  ADD CONSTRAINT "protocol_versions_text_chk" CHECK (
    char_length(btrim("title")) > 0
    AND char_length(btrim("condition")) > 0
    AND char_length(btrim("instructions")) > 0
  );

-- At most one APPROVED and one DRAFT version per protocol.
CREATE UNIQUE INDEX "protocol_versions_one_approved_key"
  ON "protocol_versions"("protocol_id") WHERE "status" = 'APPROVED';
CREATE UNIQUE INDEX "protocol_versions_one_draft_key"
  ON "protocol_versions"("protocol_id") WHERE "status" = 'DRAFT';

-- Approved protocol content is immutable: a change means a new version.
-- Only a VET approves, demo protocols are never approved, and only DRAFT
-- versions can be deleted.
CREATE OR REPLACE FUNCTION "protocol_versions_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  approver_role "UserRole";
  protocol_is_demo boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft protocol versions can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'protocol versions are created as DRAFT' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" <> 'DRAFT' THEN
    IF NEW."protocol_id" IS DISTINCT FROM OLD."protocol_id"
       OR NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."title" IS DISTINCT FROM OLD."title"
       OR NEW."condition" IS DISTINCT FROM OLD."condition"
       OR NEW."is_emergency" IS DISTINCT FROM OLD."is_emergency"
       OR NEW."instructions" IS DISTINCT FROM OLD."instructions"
       OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
       OR NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id"
       OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at" THEN
      RAISE EXCEPTION 'approved protocol version is immutable; create a new version'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (
      (OLD."status" = 'APPROVED' AND NEW."status" IN ('APPROVED', 'SUPERSEDED', 'ARCHIVED'))
      OR (OLD."status" = 'SUPERSEDED' AND NEW."status" IN ('SUPERSEDED', 'ARCHIVED'))
      OR (OLD."status" = 'ARCHIVED' AND NEW."status" = 'ARCHIVED')
    ) THEN
      RAISE EXCEPTION 'invalid protocol version status transition' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW."status" = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD."status" <> 'APPROVED') THEN
    SELECT "role" INTO approver_role FROM "users" WHERE "id" = NEW."approved_by_id";
    IF approver_role IS DISTINCT FROM 'VET' THEN
      RAISE EXCEPTION 'only a VET can approve a protocol version' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT "is_demo" INTO protocol_is_demo FROM "protocols" WHERE "id" = NEW."protocol_id";
    IF protocol_is_demo THEN
      RAISE EXCEPTION 'demo protocols cannot be approved' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "protocol_versions_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "protocol_versions"
  FOR EACH ROW EXECUTE FUNCTION "protocol_versions_guard"();

ALTER TABLE "protocol_drugs"
  ADD CONSTRAINT "protocol_drugs_dose_chk" CHECK ("dose_per_kg" > 0),
  ADD CONSTRAINT "protocol_drugs_max_dose_chk" CHECK ("max_single_dose" IS NULL OR "max_single_dose" > 0),
  ADD CONSTRAINT "protocol_drugs_frequency_chk" CHECK ("frequency_per_day" BETWEEN 1 AND 24),
  ADD CONSTRAINT "protocol_drugs_duration_chk" CHECK ("duration_days" BETWEEN 1 AND 365);

-- Drugs can only change while their version is a DRAFT. FOR SHARE blocks a
-- concurrent approval until this change commits.
CREATE OR REPLACE FUNCTION "protocol_drugs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_status "ProtocolVersionStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO version_status FROM "protocol_versions"
    WHERE "id" = OLD."protocol_version_id" FOR SHARE;
    IF version_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'drugs of a non-draft protocol version are immutable' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO version_status FROM "protocol_versions"
    WHERE "id" = NEW."protocol_version_id" FOR SHARE;
    IF version_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'drugs of a non-draft protocol version are immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "protocol_drugs_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "protocol_drugs"
  FOR EACH ROW EXECUTE FUNCTION "protocol_drugs_guard"();

-- =========================================================================
-- treatments, treatment_doses
-- =========================================================================

ALTER TABLE "treatments"
  ADD CONSTRAINT "treatments_weight_chk" CHECK ("animal_weight_kg" > 0 AND "animal_weight_kg" <= 5000),
  ADD CONSTRAINT "treatments_ends_on_chk" CHECK ("ends_on" >= "started_at"::date),
  ADD CONSTRAINT "treatments_withdrawal_chk" CHECK ("withdrawal_meat_until" >= "ends_on" AND "withdrawal_milk_until" >= "ends_on"),
  ADD CONSTRAINT "treatments_status_chk" CHECK (
    (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL))
    AND (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL))
  );

-- The snapshot taken at treatment start is immutable; only the status may
-- move from ACTIVE to COMPLETED or CANCELLED. Treatments are never deleted.
CREATE OR REPLACE FUNCTION "treatments_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'treatments cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "animals" a
      WHERE a."id" = NEW."animal_id" AND a."farm_id" = NEW."farm_id"
    ) THEN
      RAISE EXCEPTION 'treatment farm does not match animal farm'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."farm_id" IS DISTINCT FROM OLD."farm_id"
     OR NEW."animal_id" IS DISTINCT FROM OLD."animal_id"
     OR NEW."protocol_version_id" IS DISTINCT FROM OLD."protocol_version_id"
     OR NEW."started_by_id" IS DISTINCT FROM OLD."started_by_id"
     OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
     OR NEW."ends_on" IS DISTINCT FROM OLD."ends_on"
     OR NEW."animal_weight_kg" IS DISTINCT FROM OLD."animal_weight_kg"
     OR NEW."protocol_snapshot" IS DISTINCT FROM OLD."protocol_snapshot"
     OR NEW."withdrawal_meat_until" IS DISTINCT FROM OLD."withdrawal_meat_until"
     OR NEW."withdrawal_milk_until" IS DISTINCT FROM OLD."withdrawal_milk_until" THEN
    RAISE EXCEPTION 'treatment snapshot is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'ACTIVE' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'finished treatment cannot change status' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "treatments_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "treatments"
  FOR EACH ROW EXECUTE FUNCTION "treatments_guard"();

ALTER TABLE "treatment_doses"
  ADD CONSTRAINT "treatment_doses_dose_chk" CHECK ("dose_per_kg" > 0 AND "single_dose" > 0),
  ADD CONSTRAINT "treatment_doses_schedule_chk" CHECK ("frequency_per_day" BETWEEN 1 AND 24 AND "duration_days" BETWEEN 1 AND 365),
  ADD CONSTRAINT "treatment_doses_withdrawal_chk" CHECK ("withdrawal_meat_days" >= 0 AND "withdrawal_milk_days" >= 0);

-- A dose may only draw on stock from the treatment's own farm.
CREATE OR REPLACE FUNCTION "treatment_doses_check_item_farm"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "inventory_items" i JOIN "treatments" t ON t."farm_id" = i."farm_id"
    WHERE i."id" = NEW."inventory_item_id" AND t."id" = NEW."treatment_id"
  ) THEN
    RAISE EXCEPTION 'inventory item does not belong to the treatment farm'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "treatment_doses_check_item_farm"
  BEFORE INSERT ON "treatment_doses"
  FOR EACH ROW EXECUTE FUNCTION "treatment_doses_check_item_farm"();
CREATE TRIGGER "treatment_doses_append_only"
  BEFORE UPDATE OR DELETE ON "treatment_doses"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation"();
CREATE TRIGGER "treatment_doses_no_truncate"
  BEFORE TRUNCATE ON "treatment_doses"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation"();

-- =========================================================================
-- Least-privilege runtime role (see docs/operations/database.md)
-- =========================================================================
-- Production runs migrations as the schema owner and the API as
-- `meningfermam_app`. When that role exists, it gets DML only: no DDL, no
-- TRUNCATE, no DELETE on business tables (soft delete/archive instead), and
-- INSERT/SELECT only on the append-only tables. Skipped when the role does
-- not exist (e.g. a single-role local database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meningfermam_app') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM meningfermam_app;
    GRANT USAGE ON SCHEMA public TO meningfermam_app;

    GRANT SELECT, INSERT, UPDATE ON
      "users", "sessions", "otp_codes", "sms_messages", "idempotency_keys",
      "stored_files", "farms", "animals", "inventory_items", "medicines",
      "protocols", "protocol_versions", "protocol_drugs", "treatments"
      TO meningfermam_app;
    GRANT SELECT, INSERT ON "audit_logs", "stock_movements", "treatment_doses"
      TO meningfermam_app;
    -- Ephemeral rows (expired sessions/codes/keys) and draft drug lines are
    -- the only hard deletes the application performs.
    GRANT DELETE ON "sessions", "otp_codes", "idempotency_keys", "protocol_drugs"
      TO meningfermam_app;

    -- Tables added by later migrations (run by this owner) get DML too;
    -- tighten them in their own migration where needed.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE ON TABLES TO meningfermam_app;
  END IF;
END;
$$;
