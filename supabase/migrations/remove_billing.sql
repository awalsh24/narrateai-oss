-- Billing integration removed: drop the plan/quota/webhook schema.
-- user_profiles held nothing but plan + quota columns, so it goes entirely.
DROP FUNCTION IF EXISTS increment_video_count(uuid);
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS processed_webhooks;
