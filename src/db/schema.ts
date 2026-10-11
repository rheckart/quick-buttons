/**
 * Migrations, applied in order and recorded in `schema_migrations`. Append new ones; never edit old ones.
 * Plain Postgres SQL that runs on both `pg` and PGlite. Dates are stored as 'YYYY-MM-DD' text (local dates),
 * instants as timestamptz. Telegram chat/user ids are bigint (they exceed int32); repos convert to number.
 */
export const migrations: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE meds (
  id               serial PRIMARY KEY,
  pet_id           text        NOT NULL,
  name             text        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('ongoing','course','monthly','as_needed')),
  dose_note        text,
  round_keys       text[]      NOT NULL DEFAULT '{}',
  days             integer,
  started_on       text,
  seed_last_given  text,
  created_at       timestamptz NOT NULL,
  stopped_at       timestamptz
);
CREATE INDEX meds_pet_idx ON meds (pet_id);

CREATE TABLE log_entries (
  id                  serial PRIMARY KEY,
  pet_id              text        NOT NULL,
  round_key           text,
  for_date            text        NOT NULL,
  given_at            timestamptz NOT NULL,
  logged_at           timestamptz NOT NULL,
  logged_by_id        bigint      NOT NULL,
  logged_by_name      text        NOT NULL,
  undone              boolean     NOT NULL DEFAULT false,
  last_rev_kind       text        NOT NULL,
  last_rev_by_id      bigint      NOT NULL,
  last_rev_by_name    text        NOT NULL,
  last_rev_at         timestamptz NOT NULL,
  record_message_id   integer
);
CREATE INDEX log_entries_pet_date_idx ON log_entries (pet_id, for_date);

CREATE TABLE log_entry_items (
  entry_id  integer NOT NULL REFERENCES log_entries (id),
  med_id    integer NOT NULL REFERENCES meds (id),
  status    text    NOT NULL CHECK (status IN ('given','skipped')),
  PRIMARY KEY (entry_id, med_id)
);
CREATE INDEX log_entry_items_med_idx ON log_entry_items (med_id);

-- Append-only: a full snapshot after every create / edit / undo. Never updated or deleted.
CREATE TABLE log_entry_revisions (
  entry_id  integer     NOT NULL REFERENCES log_entries (id),
  rev       integer     NOT NULL,
  kind      text        NOT NULL CHECK (kind IN ('create','edit','undo')),
  by_id     bigint      NOT NULL,
  by_name   text        NOT NULL,
  at        timestamptz NOT NULL,
  given_at  timestamptz NOT NULL,
  items     jsonb       NOT NULL,
  undone    boolean     NOT NULL,
  PRIMARY KEY (entry_id, rev)
);

CREATE TABLE bot_messages (
  id           serial PRIMARY KEY,
  kind         text        NOT NULL,
  pet_id       text,
  round_key    text,
  med_id       integer,
  for_date     text,
  chat_id      bigint      NOT NULL,
  thread_id    integer,
  message_id   integer     NOT NULL,
  render_hash  text        NOT NULL,
  created_at   timestamptz NOT NULL,
  deleted_at   timestamptz
);
CREATE INDEX bot_messages_lookup_idx ON bot_messages (kind, pet_id, for_date);

CREATE TABLE ui_state (
  key         text PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL
);
`,
  },
];
