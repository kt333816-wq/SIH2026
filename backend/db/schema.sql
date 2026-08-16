-- Serviso authentication schema
-- Run once against your PostgreSQL database (psql $DATABASE_URL -f db/schema.sql)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM ('donor', 'receiver', 'admin');

CREATE TYPE user_sub_role AS ENUM (
    'civilian',                 -- donor: normal individual, no documents required
    'restaurant_canteen',       -- donor: restaurant / govt canteen, license required
    'ngo_head',                 -- receiver: heads a registered NGO, registration doc required
    'social_worker_politician', -- receiver: individual, Aadhaar required
    'admin'                     -- platform reviewer
);

CREATE TYPE account_status AS ENUM (
    'pending_email_verification', -- signed up, OTP not yet confirmed
    'active',                      -- email verified, can log in immediately
    'suspended',                   -- temporarily locked by admin (e.g. flagged document/Aadhaar)
    'terminated'                   -- permanently locked by admin (confirmed false info)
);

CREATE TABLE users (
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

CREATE UNIQUE INDEX idx_users_aadhaar_hash ON users (aadhaar_hash) WHERE aadhaar_hash IS NOT NULL;

CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type      VARCHAR(50) NOT NULL, -- 'ngo_registration' | 'aadhaar_card' | 'fssai_license' etc
    file_path     TEXT NOT NULL,        -- server-side storage path, never web-accessible directly
    original_name VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100) NOT NULL,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    purpose     VARCHAR(30) NOT NULL DEFAULT 'email_verification', -- or 'login_2fa'
    expires_at  TIMESTAMPTZ NOT NULL,
    attempts    INT NOT NULL DEFAULT 0,
    consumed    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_user_purpose ON otp_codes (user_id, purpose, consumed);

CREATE TABLE login_attempts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) NOT NULL,
    ip_address  VARCHAR(64),
    success     BOOLEAN NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_attempts_email_time ON login_attempts (email, created_at);