-- Add a `pending` claim state so alert dispatch can reserve a notification
-- row (under an advisory lock) BEFORE sending, eliminating duplicate sends.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'sent';
