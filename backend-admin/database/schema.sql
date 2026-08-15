SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS guild (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  join_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_name (name),
  UNIQUE KEY uq_guild_join_code (join_code),
  KEY idx_guild_enabled (enabled, updated_at DESC),
  CONSTRAINT chk_guild_version CHECK (version > 0),
  CONSTRAINT chk_guild_join_code CHECK (CHAR_LENGTH(join_code) > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gift_compensation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  platform ENUM('dy', 'ks') NOT NULL,
  event_id VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  room_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  external_user_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  nickname VARCHAR(200) NOT NULL,
  gift_id VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  gift_name VARCHAR(200) NOT NULL,
  gift_count INT UNSIGNED NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_json JSON NOT NULL,
  reason VARCHAR(255) NOT NULL,
  status ENUM('pending', 'enqueued', 'duplicate', 'failed') NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NOT NULL DEFAULT '',
  enqueued_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_gift_compensation_event (event_id),
  KEY idx_gift_compensation_status (status, updated_at DESC),
  KEY idx_gift_compensation_user (platform, external_user_id, created_at DESC),
  CONSTRAINT chk_gift_compensation_count CHECK (gift_count > 0),
  CONSTRAINT chk_gift_compensation_attempts CHECK (attempt_count >= 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS compensation_job (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_round_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_max_event_id BIGINT UNSIGNED NOT NULL,
  target_room_id BIGINT UNSIGNED NOT NULL,
  interval_ms INT UNSIGNED NOT NULL DEFAULT 1000,
  seat_players BOOLEAN NOT NULL DEFAULT FALSE,
  comment_content VARCHAR(2000) NOT NULL DEFAULT '',
  reason VARCHAR(255) NOT NULL,
  status ENUM('pending', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  active_target_room_id BIGINT UNSIGNED GENERATED ALWAYS AS (
    IF(status IN ('pending', 'running'), target_room_id, NULL)
  ) STORED,
  total_items INT UNSIGNED NOT NULL DEFAULT 0,
  completed_items INT UNSIGNED NOT NULL DEFAULT 0,
  failed_items INT UNSIGNED NOT NULL DEFAULT 0,
  cancelled_items INT UNSIGNED NOT NULL DEFAULT 0,
  total_gift_events INT UNSIGNED NOT NULL DEFAULT 0,
  total_gift_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_gift_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_seat_events INT UNSIGNED NOT NULL DEFAULT 0,
  next_run_at DATETIME(3) NULL,
  last_error VARCHAR(500) NOT NULL DEFAULT '',
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_compensation_job_request (request_id),
  UNIQUE KEY uq_compensation_job_payload (payload_hash),
  UNIQUE KEY uq_compensation_job_active_target (active_target_room_id),
  KEY idx_compensation_job_due (status, next_run_at, id),
  KEY idx_compensation_job_source (source_round_id, created_at DESC),
  CONSTRAINT fk_compensation_job_source_round FOREIGN KEY (source_round_id) REFERENCES game_round (id),
  CONSTRAINT fk_compensation_job_target_room FOREIGN KEY (target_room_id) REFERENCES live_room (id),
  CONSTRAINT chk_compensation_job_interval CHECK (interval_ms BETWEEN 500 AND 60000),
  CONSTRAINT chk_compensation_job_counts CHECK (
    completed_items + failed_items + cancelled_items <= total_items
  )
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS compensation_job_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  item_type ENUM('comment', 'gift') NOT NULL,
  source_gift_event_id BIGINT UNSIGNED NULL,
  event_id VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  external_user_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  nickname_snapshot VARCHAR(200) NOT NULL,
  avatar_url_snapshot VARCHAR(2048) NOT NULL DEFAULT '',
  gift_id VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  gift_name VARCHAR(200) NULL,
  gift_count BIGINT UNSIGNED NULL,
  gift_value BIGINT UNSIGNED NULL,
  payload_json JSON NOT NULL,
  status ENUM('pending', 'processing', 'enqueued', 'duplicate', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  cancel_releases_source BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_source_gift_event_id BIGINT UNSIGNED GENERATED ALWAYS AS (
    IF(
      item_type = 'gift' AND NOT(status = 'cancelled' AND cancel_releases_source),
      source_gift_event_id,
      NULL
    )
  ) STORED,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  last_error VARCHAR(500) NOT NULL DEFAULT '',
  enqueued_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_compensation_job_item_sequence (job_id, sequence_no),
  UNIQUE KEY uq_compensation_job_item_event (event_id),
  UNIQUE KEY uq_compensation_job_source_event (job_id, source_gift_event_id),
  UNIQUE KEY uq_compensation_job_source_claim (claimed_source_gift_event_id),
  KEY idx_compensation_job_item_claim (job_id, status, sequence_no, lease_expires_at),
  CONSTRAINT fk_compensation_job_item_job FOREIGN KEY (job_id) REFERENCES compensation_job (id),
  CONSTRAINT fk_compensation_job_item_source FOREIGN KEY (source_gift_event_id) REFERENCES live_gift_event (id),
  CONSTRAINT chk_compensation_job_item_sequence CHECK (sequence_no > 0),
  CONSTRAINT chk_compensation_job_item_attempts CHECK (attempt_count >= 0),
  CONSTRAINT chk_compensation_job_item_payload CHECK (
    (item_type = 'comment' AND source_gift_event_id IS NULL AND gift_id IS NULL
      AND gift_name IS NULL AND gift_count IS NULL AND gift_value IS NULL)
    OR
    (item_type = 'gift' AND source_gift_event_id IS NOT NULL AND gift_id IS NOT NULL
      AND gift_name IS NOT NULL AND gift_count > 0 AND gift_value >= 0)
  )
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS guild_member (
  guild_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('member', 'manager') NOT NULL DEFAULT 'member',
  manager_slot TINYINT GENERATED ALWAYS AS (IF(role = 'manager', 1, NULL)) STORED,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (guild_id, user_id),
  UNIQUE KEY uq_guild_member_user (user_id),
  UNIQUE KEY uq_guild_manager (guild_id, manager_slot),
  CONSTRAINT fk_guild_member_guild FOREIGN KEY (guild_id) REFERENCES guild (id),
  CONSTRAINT fk_guild_member_user FOREIGN KEY (user_id) REFERENCES platform_user (id)
) ENGINE = InnoDB;
