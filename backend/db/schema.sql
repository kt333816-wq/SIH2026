-- Serviso authentication schema
-- This runs automatically on every Render deploy (via the build command),
-- so every statement here is safe to run repeatedly without erroring out.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('donor', 'receiver', 'admin');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE user_sub_role AS ENUM (
        'civilian',                 -- donor: normal individual, no documents required
        'restaurant_canteen',       -- donor: restaurant / govt canteen, license required
        'ngo_head',                 -- receiver: heads a registered NGO, registration doc required
        'social_worker_politician', -- receiver: individual, Aadhaar required
        'admin'                     -- platform reviewer
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE account_status AS ENUM (
        'pending_email_verification', -- signed up, OTP not yet confirmed
        'active',                      -- email verified, can log in immediately
        'suspended',                   -- temporarily locked by admin (e.g. flagged document/Aadhaar)
        'terminated'                   -- permanently locked by admin (confirmed false info)
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(150) NOT NULL,
    email             VARCHAR(255) NOT NULL UNIQUE,
    mobile            VARCHAR(20)  NOT NULL,
    password_hash     TEXT NOT NULL,
    role              user_role NOT NULL,
    sub_role          user_sub_role NOT NULL,
    aadhaar_last4     CHAR(4),           -- store only last 4 digits for display, never full number in plaintext
    aadhaar_hash      TEXT,              -- sha256 hash of full aadhaar number, used only to detect duplicate signups
    email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    account_status    account_status NOT NULL DEFAULT 'pending_email_verification',
    status_reason     TEXT,              -- why an admin suspended/terminated this account
    status_changed_by UUID REFERENCES users(id),
    status_changed_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_aadhaar_hash ON users (aadhaar_hash) WHERE aadhaar_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type      VARCHAR(50) NOT NULL, -- 'ngo_registration' | 'aadhaar_card' | 'fssai_license' etc
    file_path     TEXT NOT NULL,        -- server-side storage path, never web-accessible directly
    original_name VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100) NOT NULL,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    purpose     VARCHAR(30) NOT NULL DEFAULT 'email_verification', -- or 'login_2fa'
    expires_at  TIMESTAMPTZ NOT NULL,
    attempts    INT NOT NULL DEFAULT 0,
    consumed    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_user_purpose ON otp_codes (user_id, purpose, consumed);

CREATE TABLE IF NOT EXISTS login_attempts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) NOT NULL,
    ip_address  VARCHAR(64),
    success     BOOLEAN NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts (email, created_at);

CREATE TABLE IF NOT EXISTS food_listings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donor_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_quantity VARCHAR(255) NOT NULL,
    address       TEXT NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'available', -- 'available' | 'claimed' | 'completed'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_listings_donor ON food_listings (donor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_food_listings_status ON food_listings (status, created_at);
-- Enable cube & earthdistance extensions for distance math (in meters)
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- Table to store receiver preferences and location coordinates
CREATE TABLE IF NOT EXISTS receiver_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    full_address TEXT NOT NULL,
    feed_preference VARCHAR(20) NOT NULL DEFAULT 'human', -- 'human' | 'animal' | 'both'
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add feed_type, expiration timer, coordinates, and match tracking to food_listings
ALTER TABLE food_listings 
    ADD COLUMN IF NOT EXISTS feed_type VARCHAR(20) NOT NULL DEFAULT 'human', -- 'human' | 'animal'
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 8),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 8),
    ADD COLUMN IF NOT EXISTS matched_receiver_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS expires_for_human_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '2 hours');

-- ============================================================
-- Phase 2-4: PostGIS distance-matching, OTP handoff, ratings,
-- and surplus-prediction storage. Append this to schema.sql -
-- every statement here is idempotent like the rest of the file.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- Geography columns for real distance queries (kept alongside the existing
-- plain lat/long columns, which stay useful for display/debugging)
ALTER TABLE receiver_profiles
    ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

UPDATE receiver_profiles
    SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receiver_profiles_location ON receiver_profiles USING GIST (location);

ALTER TABLE food_listings
    ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

UPDATE food_listings
    SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_food_listings_location ON food_listings USING GIST (location);

-- Matching + pickup-confirmation state machine
DO $$ BEGIN
    CREATE TYPE listing_match_status AS ENUM (
        'searching_human',
        'searching_animal',
        'matched_pending_pickup',
        'completed',
        'expired_unmatched'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE food_listings
    ADD COLUMN IF NOT EXISTS match_status listing_match_status NOT NULL DEFAULT 'searching_human',
    ADD COLUMN IF NOT EXISTS pickup_otp_hash TEXT,
    ADD COLUMN IF NOT EXISTS pickup_otp_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pickup_otp_attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_food_listings_match_status ON food_listings (match_status, feed_type, expires_for_human_at);

-- Ratings: driven off a simple completed-donations counter, scaled 0-5 in code
-- (utils/rating.js) rather than stored as a column, so the scale can be
-- retuned later without a migration.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS completed_donations_count INT NOT NULL DEFAULT 0;

-- AI surplus-prediction history, restaurant/govt canteen donors only.
-- Starts as a heuristic (see utils prediction logic) - this table exists so a
-- real trained model can be swapped in later without changing the API shape.
CREATE TABLE IF NOT EXISTS surplus_predictions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donor_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    predicted_for_date       DATE NOT NULL,
    predicted_quantity_hint  VARCHAR(255),
    confidence               NUMERIC(3,2),
    method                   VARCHAR(30) NOT NULL DEFAULT 'heuristic_avg', -- swap to 'ml_model' later
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (donor_id, predicted_for_date)
);
-- ============================================================
-- Live GPS tracking (donor pickup-view map). Append to schema.sql
-- alongside schema_additions_phase2.sql.
-- ============================================================
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS live_latitude NUMERIC(10,8),
    ADD COLUMN IF NOT EXISTS live_longitude NUMERIC(11,8),
    ADD COLUMN IF NOT EXISTS live_location_updated_at TIMESTAMPTZ;