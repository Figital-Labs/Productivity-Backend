-- BE-23: attendees who have no account (vendor, consultant, doctor from another hospital).
-- They cannot go in "attendeeIds": that array is an ACL (being listed grants read access) and
-- every entry must resolve to a real same-org User.
--
-- JSONB, NOT NULL with a default, so existing rows read back as [] without being rewritten.
ALTER TABLE "Meeting" ADD COLUMN "externalAttendees" JSONB NOT NULL DEFAULT '[]';
