-- Store per-student display privacy preferences for lists and exports.
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS hidden_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_hidden_fields_is_array'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
    ADD CONSTRAINT students_hidden_fields_is_array
    CHECK (jsonb_typeof(hidden_fields) = 'array');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_hidden_fields_allowlist'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
    ADD CONSTRAINT students_hidden_fields_allowlist
    CHECK (
      hidden_fields <@ '["birth_date", "school", "enrollment_date", "custom_fee", "student_contact", "parent_contact", "notes"]'::jsonb
    );
  END IF;
END
$$;

COMMENT ON COLUMN public.students.hidden_fields IS
  'Allowlisted student columns hidden from list views and spreadsheet exports.';
