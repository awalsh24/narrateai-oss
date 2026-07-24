-- Minimal stand-in for Supabase Auth's auth.users table. It only needs to
-- exist long enough for supabase/migrations.sql's original FK reference to
-- it to succeed at CREATE TABLE time — supabase/migrations/local_single_user.sql
-- (run right after) drops that FK immediately, since this app no longer
-- uses Supabase Auth (single-user local mode). A real Supabase project
-- already has this table, so this file is only needed for this local stack.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
