-- Single-user local mode no longer authenticates through Supabase Auth,
-- so LOCAL_USER_ID (from .env) will not exist in auth.users. Drop the FKs
-- that tied these tables to it.
ALTER TABLE videos        DROP CONSTRAINT IF EXISTS videos_user_id_fkey;
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;
