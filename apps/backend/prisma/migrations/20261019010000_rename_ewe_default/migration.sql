-- Data only: the EWE default animal type is called "Qo‘y" (it was "Sovliq").
--
-- A farm that already has a non-archived type named "Qo‘y" (any case) keeps
-- "Sovliq": the rename would violate the partial unique index
-- ration_animal_types_farm_name_active_key (farm_id, lower(name)).
-- updated_at holds UTC wall-clock time, whatever the session time zone.
UPDATE "ration_animal_types" t
SET "name" = 'Qo‘y',
    "updated_at" = (now() AT TIME ZONE 'UTC')
WHERE t."is_default"
  AND t."profile" = 'EWE'
  AND t."name" = 'Sovliq'
  AND NOT EXISTS (
    SELECT 1 FROM "ration_animal_types" o
    WHERE o."farm_id" = t."farm_id"
      AND o."archived_at" IS NULL
      AND lower(o."name") = lower('Qo‘y')
  );
