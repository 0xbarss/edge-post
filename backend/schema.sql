CREATE TABLE devices (
  device_id   INTEGER PRIMARY KEY
              CHECK (device_id BETWEEN 1 AND 65535),
  name        TEXT NOT NULL,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'offline'
              CHECK (status IN ('online', 'offline')),
  sample_rate SMALLINT NOT NULL DEFAULT 5
              CHECK (sample_rate BETWEEN 1 AND 255)
);

CREATE TABLE readings (
  id          BIGSERIAL PRIMARY KEY,
  device_id   INTEGER NOT NULL
              REFERENCES devices (device_id) ON DELETE CASCADE,
  sequence    INTEGER NOT NULL
              CHECK (sequence BETWEEN 0 AND 65535),
  ts          TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  temperature NUMERIC(6,2) NOT NULL
              CHECK (temperature BETWEEN -100.0 AND 150.0),
  gpio_state  SMALLINT NOT NULL
              CHECK (gpio_state BETWEEN 0 AND 255),
  sample_rate SMALLINT NOT NULL
              CHECK (sample_rate BETWEEN 1 AND 255)
);

CREATE INDEX idx_readings_device_ts ON readings (device_id, ts DESC);

CREATE TABLE commands (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id    INTEGER NOT NULL
               REFERENCES devices (device_id) ON DELETE CASCADE,
  type         TEXT NOT NULL
               CHECK (type IN ('toggle_gpio', 'set_sample_rate')),
  payload      JSONB NOT NULL
               CHECK (jsonb_typeof(payload) = 'object'),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'delivered', 'executed', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  executed_at  TIMESTAMPTZ
);

CREATE INDEX idx_commands_pending ON commands (device_id, id)
  WHERE status = 'pending';

CREATE INDEX idx_commands_device_created ON commands (device_id, created_at DESC);
