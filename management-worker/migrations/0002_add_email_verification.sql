-- Add email verification fields to Users table
ALTER TABLE Users ADD COLUMN emailVerified INTEGER DEFAULT 0;
ALTER TABLE Users ADD COLUMN verificationCode TEXT;
