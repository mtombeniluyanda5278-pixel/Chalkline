ALTER TABLE teaching_classes ADD COLUMN timetable jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(timetable) = 'array');
