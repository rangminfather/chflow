-- =============================================================
-- Backup current live member directory state before MDB merge
-- =============================================================

DROP TABLE IF EXISTS public.members_backup;
CREATE TABLE public.members_backup AS
SELECT
  now() AS backup_created_at,
  m.*
FROM public.members m;

DROP TABLE IF EXISTS public.households_backup;
CREATE TABLE public.households_backup AS
SELECT
  now() AS backup_created_at,
  h.*
FROM public.households h;

CREATE INDEX IF NOT EXISTS idx_members_backup_id
  ON public.members_backup (id);

CREATE INDEX IF NOT EXISTS idx_households_backup_id
  ON public.households_backup (id);


-- =============================================================
-- Staging table for MDB-based member import
-- MDB is treated as the source of truth for personal identity data.
-- =============================================================

DROP TABLE IF EXISTS public.staging_members_mdb;
CREATE TABLE public.staging_members_mdb (
  id                        bigserial PRIMARY KEY,
  source_system             text NOT NULL DEFAULT 'kyoin2015_mdb',
  source_file               text,
  source_loaded_at          timestamptz NOT NULL DEFAULT now(),
  source_row_no             int,

  legacy_kyoin_id           text,
  legacy_family_num         text,
  legacy_seq_num            text,

  name                      text NOT NULL,
  english_name              text,
  birth_date                date,
  birth_raw                 text,
  age_raw                   text,
  gender                    text,
  lunar_solar               text,
  relationship_in_household text,

  phone                     text,
  post_num                  text,
  address_line_1            text,
  address_line_2            text,

  life_raw                  text,
  first_registration_date   date,
  baptism_date              date,
  other_date                date,
  yang_raw                  text,
  yangi_raw                 text,

  office_role_raw           text,
  office_role_date_raw      text,
  office_role_note_raw      text,

  picture_ref               text,
  sms_opt_in_raw            text,
  act_raw                   text,
  jong_raw                  text,

  move_out                  boolean,
  deleted_flag              boolean,
  delete_reason             text,

  raw_payload               jsonb
);

CREATE INDEX IF NOT EXISTS idx_staging_members_mdb_legacy_kyoin_id
  ON public.staging_members_mdb (legacy_kyoin_id);

CREATE INDEX IF NOT EXISTS idx_staging_members_mdb_legacy_family_num
  ON public.staging_members_mdb (legacy_family_num);

CREATE INDEX IF NOT EXISTS idx_staging_members_mdb_name_phone
  ON public.staging_members_mdb (name, phone);
