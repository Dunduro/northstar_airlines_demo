-- Observed state. Git stays the source of truth for intent (registry, exceptions, manifests).
-- events is append-only; the other tables are projections that workers keep up to date.

CREATE TABLE IF NOT EXISTS events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL,
  source       text NOT NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_type_idx ON events (type, received_at DESC);

CREATE TABLE IF NOT EXISTS targets (
  id                text PRIMARY KEY,
  name              text NOT NULL UNIQUE,
  cloud             text NOT NULL DEFAULT 'aws',
  environment       text NOT NULL,
  team              text NOT NULL,
  owner             text NOT NULL,
  ou                text NOT NULL,
  flavours          jsonb NOT NULL DEFAULT '[]',
  baseline_version  text NOT NULL,
  module_versions   jsonb NOT NULL DEFAULT '{}',
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS findings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id   text NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  source      text NOT NULL,
  rule        text NOT NULL,
  severity    text NOT NULL,
  resource    text NOT NULL,
  status      text NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  link        text NOT NULL DEFAULT '',
  UNIQUE (target_id, source, rule, resource)
);

CREATE TABLE IF NOT EXISTS exceptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id             text NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  rule                  text NOT NULL,
  owner                 text NOT NULL,
  reason                text NOT NULL,
  compensating_control  text NOT NULL,
  expires_at            timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rollouts (
  id          text PRIMARY KEY,
  change      jsonb NOT NULL,
  waves       jsonb NOT NULL,
  status      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS people (
  id      text PRIMARY KEY,
  name    text NOT NULL,
  email   text NOT NULL,
  team    text NOT NULL,
  role    text NOT NULL,
  status  text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS onboarding (
  person_id     text PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  steps         jsonb NOT NULL,
  closed_doors  jsonb NOT NULL DEFAULT '[]',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_grants (
  person_id       text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  target_id       text NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  permission_set  text NOT NULL,
  status          text NOT NULL,
  PRIMARY KEY (person_id, target_id)
);

-- Alerts sent (or queued for the digest). dedupe_key makes re-sends idempotent.
CREATE TABLE IF NOT EXISTS alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key   text NOT NULL,
  team         text NOT NULL,
  severity     text NOT NULL,
  delivery     text NOT NULL,           -- now | digest
  status       text NOT NULL,           -- sent | digest_pending | digest_sent
  title        text NOT NULL,
  link         text NOT NULL,
  ticket       text,
  count        integer NOT NULL DEFAULT 1,
  first_at     timestamptz NOT NULL DEFAULT now(),
  last_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_dedupe_idx ON alerts (dedupe_key, last_at DESC);

-- Daily compliance per environment x team, for the 30-day trend on the overview.
CREATE TABLE IF NOT EXISTS compliance_snapshots (
  day          date NOT NULL,
  environment  text NOT NULL,
  team         text NOT NULL,
  total        integer NOT NULL,
  compliant    integer NOT NULL,
  PRIMARY KEY (day, environment, team)
);
