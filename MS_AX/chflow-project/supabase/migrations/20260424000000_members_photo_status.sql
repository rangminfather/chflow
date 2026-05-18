-- members.photo_status: matched | no_photo_in_pdf | match_failed
ALTER TABLE members ADD COLUMN IF NOT EXISTS photo_status text;

UPDATE members SET photo_status = CASE
  WHEN photo_url IS NOT NULL THEN 'matched'
  WHEN photo_page IS NULL THEN 'no_photo_in_pdf'
  ELSE 'match_failed'
END;

CREATE INDEX IF NOT EXISTS idx_members_photo_status ON members(photo_status);
