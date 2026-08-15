import { sha256Hex } from '../lib/crypto.js';

export class AdminRepositoryError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AdminRepositoryError';
    this.code = code;
    this.status = status;
  }
}

export class AdminRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listLeaderboard({ platform, periodStart, limit }) {
    const [rows] = await this.pool.query(
      `SELECT pu.external_user_id, pu.nickname, pu.avatar_url,
        lps.score, totals.score AS total_score
       FROM leaderboard_period_score lps
       JOIN platform_user pu ON pu.id = lps.user_id
       LEFT JOIN leaderboard_period_score totals
         ON totals.period_type = 'all'
        AND totals.period_start = '1970-01-01'
        AND totals.user_id = lps.user_id
       WHERE lps.period_type = 'week'
         AND lps.period_start = ?
         AND pu.platform = ?
       ORDER BY lps.score DESC, pu.external_user_id ASC
       LIMIT ?`,
      [periodStart, platform, limit],
    );
    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.external_user_id,
      nickname: row.nickname,
      avatarUrl: row.avatar_url,
      score: jsonInteger(row.score),
      totalScore: jsonInteger(row.total_score || 0),
    }));
  }

  async listUserRounds({ platform, userId, startAt, endAt, limit = 100 }) {
    const databaseUserId = await this.#platformUserId(platform, userId);
    const filters = ['rps.user_id = ?'];
    const params = [databaseUserId];
    if (startAt && endAt) {
      filters.push('gr.started_at >= ? AND gr.started_at < ?');
      params.push(startAt, endAt);
    }
    params.push(limit);
    const [rows] = await this.pool.query(
      `SELECT gr.external_round_id, lr.external_room_id, gr.status,
        rps.score, rps.base_score, gr.total_value, gr.started_at, gr.settled_at
       FROM round_player_score rps
       JOIN game_round gr ON gr.id = rps.round_id
       JOIN live_room lr ON lr.id = gr.room_id
       WHERE ${filters.join(' AND ')}
       ORDER BY gr.started_at DESC, gr.id DESC
       LIMIT ?`,
      params,
    );
    return rows.map(row => ({
      roundId: row.external_round_id,
      roomId: row.external_room_id,
      status: row.status,
      score: jsonInteger(row.score),
      baseScore: jsonInteger(row.base_score),
      totalValue: jsonInteger(row.total_value),
      startedAt: row.started_at,
      settledAt: row.settled_at,
    }));
  }

  async listGiftCompensations({ platform, status, limit }) {
    const filters = ['platform = ?'];
    const params = [platform];
    if (status) {
      filters.push('status = ?');
      params.push(status);
    }
    params.push(limit);
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const [rows] = await this.pool.query(
      `SELECT id, platform, event_id, room_id, external_user_id, nickname,
        gift_id, gift_name, gift_count, payload_hash, payload_json, reason,
        status, attempt_count, last_error, enqueued_at, created_at, updated_at
       FROM gift_compensation
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      params,
    );
    return rows.map(mapCompensationRow);
  }

  async prepareGiftCompensation(input) {
    return withTransaction(this.pool, async connection => {
      await connection.execute(
        `INSERT INTO gift_compensation
          (platform, event_id, room_id, external_user_id, nickname,
           gift_id, gift_name, gift_count, payload_hash, payload_json,
           reason, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON DUPLICATE KEY UPDATE event_id = gift_compensation.event_id`,
        [
          input.platform,
          input.eventId,
          input.roomId,
          input.userId,
          input.nickname,
          input.giftId,
          input.giftName,
          input.count,
          input.payloadHash,
          JSON.stringify(input.event),
          input.reason,
          input.createdAt,
          input.createdAt,
        ],
      );
      const [rows] = await connection.execute(
        `SELECT id, platform, event_id, room_id, external_user_id, nickname,
          gift_id, gift_name, gift_count, payload_hash, payload_json, reason,
          status, attempt_count, last_error, enqueued_at, created_at, updated_at
         FROM gift_compensation
         WHERE event_id = ?
         FOR UPDATE`,
        [input.eventId],
      );
      const row = rows[0];
      if (!row) throw new Error('gift compensation insert did not return a record');
      if (row.payload_hash !== input.payloadHash) {
        throw new AdminRepositoryError(
          'event id already belongs to a different compensation payload',
          'compensation_payload_conflict',
          409,
        );
      }

      if (row.status === 'failed') {
        await connection.execute(
          `UPDATE gift_compensation
           SET status = 'pending', last_error = '', updated_at = ?
           WHERE id = ?`,
          [new Date(), row.id],
        );
        row.status = 'pending';
        row.last_error = '';
      }

      return {
        shouldEnqueue: row.status === 'pending',
        event: parseJsonColumn(row.payload_json),
        compensation: mapCompensationRow(row),
      };
    });
  }

  async retryGiftCompensation({ platform, eventId, retriedAt = new Date() }) {
    return withTransaction(this.pool, async connection => {
      const [rows] = await connection.execute(
        `SELECT id, platform, event_id, room_id, external_user_id, nickname,
          gift_id, gift_name, gift_count, payload_hash, payload_json, reason,
          status, attempt_count, last_error, enqueued_at, created_at, updated_at
         FROM gift_compensation
         WHERE platform = ? AND event_id = ?
         FOR UPDATE`,
        [platform, eventId],
      );
      if (rows.length === 0) throw notFound('compensation_not_found');
      const row = rows[0];
      if (['enqueued', 'duplicate'].includes(row.status)) {
        throw new AdminRepositoryError(
          'terminal compensation cannot be retried',
          'compensation_not_retryable',
          409,
        );
      }
      if (row.status === 'failed') {
        await connection.execute(
          `UPDATE gift_compensation
           SET status = 'pending', last_error = '', updated_at = ?
           WHERE id = ?`,
          [retriedAt, row.id],
        );
        row.status = 'pending';
        row.last_error = '';
        row.updated_at = retriedAt;
      }
      return {
        event: parseJsonColumn(row.payload_json),
        compensation: mapCompensationRow(row),
      };
    });
  }

  async finishGiftCompensation({ eventId, status, completedAt = new Date() }) {
    if (!['enqueued', 'duplicate'].includes(status)) {
      throw new TypeError('compensation status must be enqueued or duplicate');
    }
    await this.pool.execute(
      `UPDATE gift_compensation
       SET status = ?,
         attempt_count = attempt_count + 1,
         last_error = '',
         enqueued_at = COALESCE(enqueued_at, ?),
         updated_at = ?
       WHERE event_id = ? AND status IN ('pending', 'failed')`,
      [status, completedAt, completedAt, eventId],
    );
    return this.#giftCompensation(eventId);
  }

  async failGiftCompensation({ eventId, error, failedAt = new Date() }) {
    const message = String(error?.message || error || 'event enqueue failed').slice(0, 500);
    await this.pool.execute(
      `UPDATE gift_compensation
       SET status = 'failed',
         attempt_count = attempt_count + 1,
         last_error = ?,
         updated_at = ?
       WHERE event_id = ? AND status IN ('pending', 'failed')`,
      [message, failedAt, eventId],
    );
  }

  async listCompensationRounds({ platform, anchorNickname, startedFrom, startedTo, limit }) {
    const [rows] = await this.pool.query(
      `${COMPENSATION_ROUND_SELECT}
       WHERE source_room.platform = ?
         AND COALESCE(
           NULLIF(gr.anchor_nickname_snapshot, ''),
           round_anchor.nickname,
           room_anchor.nickname
         ) LIKE ?
         AND gr.started_at >= ?
         AND gr.started_at < ?
       ORDER BY gr.started_at DESC, gr.id DESC
       LIMIT ?`,
      [platform, likeContains(anchorNickname), startedFrom, startedTo, limit],
    );
    return rows.map(mapCompensationRoundRow);
  }

  async listCompensationRoundGifts({ platform, roundId }) {
    const round = await this.#compensationRound(platform, roundId);
    const [snapshotRows] = await this.pool.execute(
      `WITH round_window AS (
         SELECT gr.id, gr.room_id, gr.started_at,
           COALESCE(
             gr.settled_at,
             (
               SELECT next_round.started_at
               FROM game_round next_round
               WHERE next_round.room_id = gr.room_id
                 AND (next_round.started_at > gr.started_at
                   OR (next_round.started_at = gr.started_at AND next_round.id > gr.id))
               ORDER BY next_round.started_at ASC, next_round.id ASC
               LIMIT 1
             ),
             UTC_TIMESTAMP(3)
           ) AS ended_at
         FROM game_round gr
         WHERE gr.id = ?
       )
       SELECT COALESCE(MAX(gift.id), 0) AS snapshot_max_event_id
       FROM live_gift_event gift
       JOIN round_window rw ON (
         gift.round_id = rw.id
         OR (
           gift.round_id IS NULL
           AND gift.room_id = rw.room_id
           AND gift.occurred_at >= rw.started_at
           AND gift.occurred_at < rw.ended_at
         )
       )`,
      [roundId],
    );
    const snapshotMaxEventId = String(snapshotRows[0]?.snapshot_max_event_id || 0);
    const [rows] = await this.pool.execute(
      `WITH round_window AS (
         SELECT gr.id, gr.room_id, gr.started_at,
           COALESCE(
             gr.settled_at,
             (
               SELECT next_round.started_at
               FROM game_round next_round
               WHERE next_round.room_id = gr.room_id
                 AND (next_round.started_at > gr.started_at
                   OR (next_round.started_at = gr.started_at AND next_round.id > gr.id))
               ORDER BY next_round.started_at ASC, next_round.id ASC
               LIMIT 1
             ),
             UTC_TIMESTAMP(3)
           ) AS ended_at
         FROM game_round gr
         WHERE gr.id = ?
       ), matching_events AS (
         SELECT gift.*
         FROM live_gift_event gift
         JOIN round_window rw ON (
           gift.round_id = rw.id
           OR (
             gift.round_id IS NULL
             AND gift.room_id = rw.room_id
             AND gift.occurred_at >= rw.started_at
             AND gift.occurred_at < rw.ended_at
           )
         )
         WHERE gift.id <= ?
       ), ranked AS (
         SELECT gift_event.*,
           ROW_NUMBER() OVER (
             PARTITION BY gift_event.user_id, gift_event.gift_id
             ORDER BY gift_event.occurred_at DESC, gift_event.id DESC
           ) AS snapshot_rank
         FROM matching_events gift_event
       ), aggregated AS (
         SELECT user_id, gift_id, COUNT(*) AS event_count,
           SUM(gift_count) AS total_count, SUM(gift_value) AS total_value,
           MIN(occurred_at) AS first_at, MAX(occurred_at) AS last_at
         FROM matching_events
         GROUP BY user_id, gift_id
       )
       SELECT pu.external_user_id, snapshot.nickname_snapshot,
         snapshot.avatar_url_snapshot, gift_group.gift_id, snapshot.gift_name,
         gift_group.event_count, gift_group.total_count, gift_group.total_value,
         gift_group.first_at, gift_group.last_at
       FROM aggregated gift_group
       JOIN ranked snapshot
         ON snapshot.user_id = gift_group.user_id
        AND snapshot.gift_id = gift_group.gift_id
        AND snapshot.snapshot_rank = 1
       JOIN platform_user pu ON pu.id = gift_group.user_id
       ORDER BY gift_group.first_at ASC, pu.external_user_id ASC, gift_group.gift_id ASC`,
      [roundId, snapshotMaxEventId],
    );
    const items = rows.map(mapCompensationGiftGroupRow);
    return {
      round,
      snapshotMaxEventId,
      items,
      totals: items.reduce((totals, item) => ({
        eventCount: totals.eventCount + item.eventCount,
        totalCount: addJsonIntegers(totals.totalCount, item.totalCount),
        totalValue: addJsonIntegers(totals.totalValue, item.totalValue),
      }), { eventCount: 0, totalCount: 0, totalValue: 0 }),
    };
  }

  async createCompensationJob(input) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const existing = await selectCompensationJobByRequest(
        connection,
        input.platform,
        input.requestId,
        true,
      );
      if (existing) {
        assertJobPayload(existing, input.payloadHash);
        await connection.commit();
        return mapCompensationJobRow(existing);
      }
      const existingPayload = await selectCompensationJobByPayloadHash(
        connection,
        input.platform,
        input.payloadHash,
        true,
      );
      if (existingPayload) {
        await connection.commit();
        return mapCompensationJobRow(existingPayload);
      }

      const source = await selectCompensationSourceRound(
        connection,
        input.platform,
        input.sourceRoundId,
      );
      const target = await selectCompensationTargetRoom(
        connection,
        input.platform,
        input.targetRoomId,
      );
      if (!source.anchor_user_id || String(source.anchor_user_id) !== String(target.anchor_user_id)) {
        throw new AdminRepositoryError(
          'target room must belong to the source round anchor',
          'compensation_target_mismatch',
          409,
        );
      }

      const sourceEvents = await selectCompensationSourceEvents(
        connection,
        input.sourceRoundId,
        input.sourceSnapshotMaxEventId,
        input.selections,
      );
      assertAllSelectionsFound(input.selections, sourceEvents);
      const items = buildCompensationItems({
        requestId: input.requestId,
        sourceEvents,
        seatPlayers: input.seatPlayers,
        commentContent: input.commentContent,
        createdAt: input.createdAt,
      });
      const totals = compensationItemTotals(items);
      const [result] = await connection.execute(
        `INSERT INTO compensation_job
          (request_id, payload_hash, source_round_id, source_snapshot_max_event_id,
           target_room_id, interval_ms,
           seat_players, comment_content, reason, status, total_items,
           total_gift_events, total_gift_count, total_gift_value, total_seat_events,
           next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.requestId,
          input.payloadHash,
          input.sourceRoundId,
          input.sourceSnapshotMaxEventId,
          target.id,
          input.intervalMs,
          input.seatPlayers,
          input.commentContent,
          input.reason,
          items.length,
          totals.giftEvents,
          totals.giftCount.toString(),
          totals.giftValue.toString(),
          totals.seatEvents,
          input.createdAt,
          input.createdAt,
          input.createdAt,
        ],
      );
      await insertCompensationItems(connection, result.insertId, items, input.createdAt);
      const job = await selectCompensationJob(connection, input.platform, result.insertId, false);
      await connection.commit();
      return mapCompensationJobRow(job);
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        const existing = await selectCompensationJobByRequest(
          this.pool,
          input.platform,
          input.requestId,
          false,
        );
        if (existing) {
          assertJobPayload(existing, input.payloadHash);
          return mapCompensationJobRow(existing);
        }
        const existingPayload = await selectCompensationJobByPayloadHash(
          this.pool,
          input.platform,
          input.payloadHash,
          false,
        );
        if (existingPayload) return mapCompensationJobRow(existingPayload);
        if (duplicateIndex(error, 'uq_compensation_job_source_claim')) {
          throw new AdminRepositoryError(
            'one or more source gift events already belong to another recovery job',
            'compensation_source_event_already_claimed',
            409,
          );
        }
        throw new AdminRepositoryError(
          'another recovery job is already active for the target room',
          'compensation_target_busy',
          409,
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async listCompensationJobs({ platform, limit }) {
    const [rows] = await this.pool.query(
      `${COMPENSATION_JOB_SELECT}
       WHERE source_room.platform = ?
       ORDER BY job.created_at DESC, job.id DESC
       LIMIT ?`,
      [platform, limit],
    );
    return rows.map(mapCompensationJobRow);
  }

  async getCompensationJob({ platform, jobId }) {
    const job = await this.#compensationJob(platform, jobId);
    const [rows] = await this.pool.execute(
      `${COMPENSATION_ITEM_SELECT}
       WHERE item.job_id = ?
       ORDER BY item.sequence_no ASC`,
      [jobId],
    );
    return { ...job, items: rows.map(mapCompensationItemRow) };
  }

  async retryCompensationJob({ platform, jobId, retriedAt = new Date() }) {
    try {
      return await withTransaction(this.pool, async connection => {
        const job = await selectCompensationJob(connection, platform, jobId, true);
        if (job.status !== 'failed') {
          throw new AdminRepositoryError(
            'only failed recovery jobs can be retried',
            'compensation_job_not_retryable',
            409,
          );
        }
        const [result] = await connection.execute(
          `UPDATE compensation_job_item
           SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
             last_error = '', updated_at = ?
           WHERE job_id = ? AND status = 'failed'`,
          [retriedAt, jobId],
        );
        if (result.affectedRows === 0) {
          throw new AdminRepositoryError(
            'recovery job has no failed item',
            'compensation_job_not_retryable',
            409,
          );
        }
        await connection.execute(
          `UPDATE compensation_job
           SET status = 'pending', failed_items = 0, last_error = '',
             next_run_at = ?, finished_at = NULL, updated_at = ?
           WHERE id = ?`,
          [retriedAt, retriedAt, jobId],
        );
        return mapCompensationJobRow(
          await selectCompensationJob(connection, platform, jobId, false),
        );
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new AdminRepositoryError(
          'another recovery job is already active for the target room',
          'compensation_target_busy',
          409,
        );
      }
      throw error;
    }
  }

  async cancelCompensationJob({ platform, jobId, cancelledAt = new Date() }) {
    return withTransaction(this.pool, async connection => {
      const job = await selectCompensationJob(connection, platform, jobId, true);
      if (job.status === 'completed') {
        throw new AdminRepositoryError(
          'completed recovery job cannot be cancelled',
          'compensation_job_not_cancellable',
          409,
        );
      }
      if (job.status === 'cancelled') return mapCompensationJobRow(job);
      await connection.execute(
        `UPDATE compensation_job_item
         SET cancel_releases_source = IF(status = 'pending', TRUE, cancel_releases_source),
           status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
           updated_at = ?
         WHERE job_id = ? AND status IN ('pending', 'failed')`,
        [cancelledAt, jobId],
      );
      const [counts] = await connection.execute(
        `SELECT
          SUM(status = 'failed') AS failed_items,
          SUM(status = 'cancelled') AS cancelled_items
         FROM compensation_job_item
         WHERE job_id = ?`,
        [jobId],
      );
      await connection.execute(
        `UPDATE compensation_job
         SET status = 'cancelled', failed_items = ?, cancelled_items = ?,
           next_run_at = NULL, finished_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          Number(counts[0]?.failed_items || 0),
          Number(counts[0]?.cancelled_items || 0),
          cancelledAt,
          cancelledAt,
          jobId,
        ],
      );
      return mapCompensationJobRow(
        await selectCompensationJob(connection, platform, jobId, false),
      );
    });
  }

  async claimNextCompensationItem({ claimedAt, leaseToken, leaseExpiresAt }) {
    return withTransaction(this.pool, async connection => {
      const [cancelledJobs] = await connection.execute(
        `${COMPENSATION_JOB_SELECT}
         WHERE job.status = 'cancelled'
           AND EXISTS (
             SELECT 1
             FROM compensation_job_item cancelled_item
             WHERE cancelled_item.job_id = job.id
               AND cancelled_item.status = 'processing'
               AND (cancelled_item.lease_expires_at IS NULL
                 OR cancelled_item.lease_expires_at <= ?)
           )
         ORDER BY job.updated_at ASC, job.id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [claimedAt],
      );
      if (cancelledJobs.length > 0) {
        const job = cancelledJobs[0];
        const [items] = await connection.execute(
          `${COMPENSATION_ITEM_SELECT}
           WHERE item.job_id = ?
             AND item.status = 'processing'
             AND (item.lease_expires_at IS NULL OR item.lease_expires_at <= ?)
           ORDER BY item.sequence_no ASC
           LIMIT 1
           FOR UPDATE`,
          [job.id, claimedAt],
        );
        if (items.length === 0) return null;
        const item = items[0];
        await connection.execute(
          `UPDATE compensation_job_item
           SET attempt_count = attempt_count + 1, lease_token = ?,
             lease_expires_at = ?, last_error = '', updated_at = ?
           WHERE id = ? AND status = 'processing'`,
          [leaseToken, leaseExpiresAt, claimedAt, item.id],
        );
        return claimedCompensationItem(job, item, claimedAt, true);
      }

      const [jobs] = await connection.execute(
        `${COMPENSATION_JOB_SELECT}
         WHERE job.status IN ('pending', 'running')
           AND job.next_run_at <= ?
         ORDER BY job.next_run_at ASC, job.id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [claimedAt],
      );
      if (jobs.length === 0) return null;
      const job = jobs[0];
      const [items] = await connection.execute(
        `${COMPENSATION_ITEM_SELECT}
         WHERE item.job_id = ?
           AND item.status IN ('pending', 'processing')
         ORDER BY item.sequence_no ASC
         LIMIT 1
         FOR UPDATE`,
        [job.id],
      );
      if (items.length === 0) {
        await connection.execute(
          `UPDATE compensation_job
           SET status = 'completed', next_run_at = NULL,
             finished_at = COALESCE(finished_at, ?), updated_at = ?
           WHERE id = ? AND status IN ('pending', 'running')`,
          [claimedAt, claimedAt, job.id],
        );
        return null;
      }
      const item = items[0];
      if (item.status === 'processing'
        && item.lease_expires_at
        && utcDate(item.lease_expires_at) > claimedAt) {
        return null;
      }
      await connection.execute(
        `UPDATE compensation_job_item
         SET status = 'processing', attempt_count = attempt_count + 1,
           lease_token = ?, lease_expires_at = ?, last_error = '', updated_at = ?
         WHERE id = ?`,
        [leaseToken, leaseExpiresAt, claimedAt, item.id],
      );
      await connection.execute(
        `UPDATE compensation_job
         SET status = 'running', started_at = COALESCE(started_at, ?),
           next_run_at = ?, updated_at = ?
         WHERE id = ?`,
        [claimedAt, leaseExpiresAt, claimedAt, job.id],
      );
      return claimedCompensationItem(job, item, claimedAt, false);
    });
  }

  async completeCompensationItem({ itemId, leaseToken, status, completedAt }) {
    if (!new Set(['enqueued', 'duplicate']).has(status)) {
      throw new TypeError('compensation item status must be enqueued or duplicate');
    }
    return withTransaction(this.pool, async connection => {
      const [rows] = await connection.execute(
        `SELECT item.id, item.job_id, job.status AS job_status, job.interval_ms
         FROM compensation_job_item item
         JOIN compensation_job job ON job.id = item.job_id
         WHERE item.id = ? AND item.status = 'processing' AND item.lease_token = ?
         FOR UPDATE`,
        [itemId, leaseToken],
      );
      if (rows.length === 0) return false;
      const row = rows[0];
      await connection.execute(
        `UPDATE compensation_job_item
         SET status = ?, lease_token = NULL, lease_expires_at = NULL,
           last_error = '', enqueued_at = COALESCE(enqueued_at, ?), updated_at = ?
         WHERE id = ?`,
        [status, completedAt, completedAt, itemId],
      );
      const [remainingRows] = await connection.execute(
        `SELECT COUNT(*) AS remaining
         FROM compensation_job_item
         WHERE job_id = ? AND status IN ('pending', 'processing')`,
        [row.job_id],
      );
      const remaining = Number(remainingRows[0].remaining);
      if (row.job_status === 'cancelled') {
        await connection.execute(
          `UPDATE compensation_job
           SET completed_items = completed_items + 1, updated_at = ?
           WHERE id = ?`,
          [completedAt, row.job_id],
        );
      } else if (remaining === 0) {
        await connection.execute(
          `UPDATE compensation_job
           SET status = 'completed', completed_items = completed_items + 1,
             next_run_at = NULL, last_error = '', finished_at = ?, updated_at = ?
           WHERE id = ?`,
          [completedAt, completedAt, row.job_id],
        );
      } else {
        const nextRunAt = new Date(completedAt.getTime() + Number(row.interval_ms));
        await connection.execute(
          `UPDATE compensation_job
           SET completed_items = completed_items + 1, next_run_at = ?, updated_at = ?
           WHERE id = ?`,
          [nextRunAt, completedAt, row.job_id],
        );
      }
      return true;
    });
  }

  async failCompensationItem({
    itemId,
    leaseToken,
    error,
    failedAt,
    releaseOnCancel = false,
  }) {
    const message = String(error?.message || error || 'event enqueue failed').slice(0, 500);
    return withTransaction(this.pool, async connection => {
      const [rows] = await connection.execute(
        `SELECT item.id, item.job_id, job.status AS job_status
         FROM compensation_job_item item
         JOIN compensation_job job ON job.id = item.job_id
         WHERE item.id = ? AND item.status = 'processing' AND item.lease_token = ?
         FOR UPDATE`,
        [itemId, leaseToken],
      );
      if (rows.length === 0) return false;
      const row = rows[0];
      const releasedCancellation = row.job_status === 'cancelled' && releaseOnCancel;
      const storedError = releasedCancellation ? '' : message;
      await connection.execute(
        `UPDATE compensation_job_item
         SET status = ?, cancel_releases_source = ?, lease_token = NULL,
           lease_expires_at = NULL, last_error = ?, updated_at = ?
         WHERE id = ?`,
        [
          releasedCancellation ? 'cancelled' : 'failed',
          releaseOnCancel,
          storedError,
          failedAt,
          itemId,
        ],
      );
      if (row.job_status === 'cancelled') {
        const counter = releasedCancellation ? 'cancelled_items' : 'failed_items';
        await connection.execute(
          `UPDATE compensation_job
           SET ${counter} = ${counter} + 1, last_error = ?, updated_at = ?
           WHERE id = ?`,
          [storedError, failedAt, row.job_id],
        );
      } else {
        await connection.execute(
          `UPDATE compensation_job
           SET status = 'failed', failed_items = failed_items + 1,
             next_run_at = NULL, last_error = ?, finished_at = ?, updated_at = ?
           WHERE id = ?`,
          [message, failedAt, failedAt, row.job_id],
        );
      }
      return true;
    });
  }

  async listGuilds({ query, limit }) {
    const filters = [];
    const params = [];
    if (query) {
      filters.push('(g.name LIKE ? OR g.description LIKE ?)');
      const pattern = `%${query}%`;
      params.push(pattern, pattern);
    }
    params.push(limit);
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const [rows] = await this.pool.query(
      `SELECT g.id, g.name, g.join_code, g.description, g.enabled, g.version,
        g.created_at, g.updated_at, COUNT(gm.user_id) AS member_count
       FROM guild g
       LEFT JOIN guild_member gm ON gm.guild_id = g.id
       ${where}
       GROUP BY g.id
       ORDER BY g.updated_at DESC, g.id DESC
       LIMIT ?`,
      params,
    );
    return rows.map(mapGuildRow);
  }

  async createGuild({ name, joinCode, description, enabled, createdAt = new Date() }) {
    try {
      const [result] = await this.pool.execute(
        `INSERT INTO guild
          (name, join_code, description, enabled, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [name, joinCode, description, enabled, createdAt, createdAt],
      );
      return this.#guild(String(result.insertId));
    } catch (error) {
      throw guildWriteError(error);
    }
  }

  async updateGuild({
    guildId,
    version,
    name,
    joinCode,
    description,
    enabled,
    updatedAt = new Date(),
  }) {
    try {
      return await withTransaction(this.pool, async connection => {
        const [rows] = await connection.execute(
          `SELECT id, name, join_code, description, enabled, version, created_at, updated_at
           FROM guild
           WHERE id = ?
           FOR UPDATE`,
          [guildId],
        );
        if (rows.length === 0) throw notFound('guild_not_found');
        const current = rows[0];
        if (Number(current.version) !== version) {
          throw new AdminRepositoryError('guild version is stale', 'guild_version_conflict', 409);
        }
        const nextVersion = version + 1;
        await connection.execute(
          `UPDATE guild
           SET name = ?, join_code = ?, description = ?, enabled = ?, version = ?, updated_at = ?
           WHERE id = ?`,
          [
            name ?? current.name,
            joinCode ?? current.join_code,
            description ?? current.description,
            enabled ?? Boolean(current.enabled),
            nextVersion,
            updatedAt,
            guildId,
          ],
        );
        return selectGuild(connection, guildId);
      });
    } catch (error) {
      throw guildWriteError(error);
    }
  }

  async listGuildMembers({ guildId }) {
    await this.#guildDatabaseId(guildId);
    const [rows] = await this.pool.execute(
      `SELECT pu.external_user_id, pu.nickname, pu.avatar_url,
        gm.role, gm.joined_at
       FROM guild_member gm
       JOIN platform_user pu ON pu.id = gm.user_id
       WHERE gm.guild_id = ?
       ORDER BY gm.role DESC, gm.joined_at ASC, pu.external_user_id ASC`,
      [guildId],
    );
    return rows.map(mapGuildMemberRow);
  }

  async putGuildMember({ platform, guildId, userId, role, joinedAt = new Date() }) {
    return withTransaction(this.pool, async connection => {
      const databaseGuildId = await selectEnabledGuildId(connection, guildId);
      const databaseUserId = await selectPlatformUserId(connection, platform, userId, true);
      const [memberships] = await connection.execute(
        'SELECT guild_id FROM guild_member WHERE user_id = ? FOR UPDATE',
        [databaseUserId],
      );
      if (memberships.length > 0 && String(memberships[0].guild_id) !== String(databaseGuildId)) {
        throw new AdminRepositoryError(
          'user already belongs to another guild',
          'user_already_in_guild',
          409,
        );
      }
      if (role === 'manager') {
        await connection.execute(
          `UPDATE guild_member
           SET role = 'member', updated_at = ?
           WHERE guild_id = ? AND role = 'manager' AND user_id <> ?`,
          [joinedAt, databaseGuildId, databaseUserId],
        );
      }
      if (memberships.length > 0) {
        await connection.execute(
          'UPDATE guild_member SET role = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
          [role, joinedAt, databaseGuildId, databaseUserId],
        );
      } else {
        await connection.execute(
          `INSERT INTO guild_member (guild_id, user_id, role, joined_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [databaseGuildId, databaseUserId, role, joinedAt, joinedAt],
        );
      }
      const [rows] = await connection.execute(
        `SELECT pu.external_user_id, pu.nickname, pu.avatar_url,
          gm.role, gm.joined_at
         FROM guild_member gm
         JOIN platform_user pu ON pu.id = gm.user_id
         WHERE gm.guild_id = ? AND gm.user_id = ?`,
        [databaseGuildId, databaseUserId],
      );
      return mapGuildMemberRow(rows[0]);
    });
  }

  async deleteGuildMember({ platform, guildId, userId }) {
    const [result] = await this.pool.execute(
      `DELETE gm
       FROM guild_member gm
       JOIN platform_user pu ON pu.id = gm.user_id
       WHERE gm.guild_id = ? AND pu.platform = ? AND pu.external_user_id = ?`,
      [guildId, platform, userId],
    );
    if (result.affectedRows === 0) throw notFound('guild_member_not_found');
  }

  async listConfigRevisions({ configKey }) {
    const [rows] = await this.pool.execute(
      `SELECT config_key, version, config_json, enabled, remark, changed_at
       FROM game_config_revision
       WHERE config_key = ?
       ORDER BY version DESC`,
      [configKey],
    );
    return rows.map(row => ({
      configKey: row.config_key,
      version: Number(row.version),
      config: parseJsonColumn(row.config_json),
      enabled: Boolean(row.enabled),
      remark: row.remark || '',
      changedAt: row.changed_at,
    }));
  }

  async #platformUserId(platform, userId) {
    return selectPlatformUserId(this.pool, platform, userId, false);
  }

  async #compensationRound(platform, roundId) {
    const [rows] = await this.pool.execute(
      `${COMPENSATION_ROUND_SELECT}
       WHERE source_room.platform = ? AND gr.id = ?`,
      [platform, roundId],
    );
    if (rows.length === 0) throw notFound('compensation_round_not_found');
    return mapCompensationRoundRow(rows[0]);
  }

  async #compensationJob(platform, jobId) {
    return mapCompensationJobRow(
      await selectCompensationJob(this.pool, platform, jobId, false),
    );
  }

  async #giftCompensation(eventId) {
    const [rows] = await this.pool.execute(
      `SELECT id, platform, event_id, room_id, external_user_id, nickname,
        gift_id, gift_name, gift_count, payload_hash, payload_json, reason,
        status, attempt_count, last_error, enqueued_at, created_at, updated_at
       FROM gift_compensation
       WHERE event_id = ?`,
      [eventId],
    );
    if (rows.length === 0) throw notFound('compensation_not_found');
    return mapCompensationRow(rows[0]);
  }

  async #guild(guildId) {
    return selectGuild(this.pool, guildId);
  }

  async #guildDatabaseId(guildId) {
    return selectGuildId(this.pool, guildId, false);
  }
}

function claimedCompensationItem(job, item, claimedAt, reconcileCancelled) {
  const payload = parseJsonColumn(item.payload_json);
  return {
    jobId: String(job.id),
    itemId: String(item.id),
    reconcileCancelled,
    event: {
      platform: job.platform,
      roomId: job.target_external_room_id,
      eventId: item.event_id,
      gift: item.item_type === 'gift',
      priority: true,
      payload: { ...payload, timestamp: claimedAt.getTime() },
    },
  };
}

const COMPENSATION_ROUND_SELECT = `SELECT gr.id AS round_db_id, gr.external_round_id,
  gr.status, gr.started_at, gr.settled_at, source_room.id AS room_db_id,
  source_room.external_room_id,
  COALESCE(round_anchor.external_user_id, room_anchor.external_user_id)
    AS anchor_external_user_id,
  COALESCE(NULLIF(gr.anchor_nickname_snapshot, ''), round_anchor.nickname, room_anchor.nickname)
    AS anchor_nickname,
  COALESCE(NULLIF(gr.anchor_avatar_url_snapshot, ''), round_anchor.avatar_url,
    room_anchor.avatar_url, '') AS anchor_avatar_url,
  latest_room.external_room_id AS latest_target_room_id,
  latest_room.last_authenticated_at AS latest_target_room_authenticated_at
 FROM game_round gr
 JOIN live_room source_room ON source_room.id = gr.room_id
 LEFT JOIN platform_user round_anchor ON round_anchor.id = gr.anchor_user_id
 LEFT JOIN platform_user room_anchor ON room_anchor.id = source_room.anchor_user_id
 LEFT JOIN live_room latest_room ON latest_room.id = (
   SELECT candidate.id
   FROM live_room candidate
   WHERE candidate.platform = source_room.platform
     AND candidate.anchor_user_id = COALESCE(gr.anchor_user_id, source_room.anchor_user_id)
   ORDER BY candidate.last_authenticated_at DESC, candidate.id DESC
   LIMIT 1
 )`;

const COMPENSATION_JOB_SELECT = `SELECT job.id, job.request_id, job.payload_hash,
  job.source_round_id, job.source_snapshot_max_event_id,
  source_round.external_round_id AS source_external_round_id,
  source_room.external_room_id AS source_external_room_id,
  target_room.external_room_id AS target_external_room_id,
  target_room.platform, job.interval_ms, job.seat_players, job.comment_content,
  job.reason, job.status, job.total_items, job.completed_items, job.failed_items,
  job.cancelled_items, job.total_gift_events, job.total_gift_count,
  job.total_gift_value, job.total_seat_events, job.next_run_at, job.last_error,
  job.started_at, job.finished_at, job.created_at, job.updated_at
 FROM compensation_job job
 JOIN game_round source_round ON source_round.id = job.source_round_id
 JOIN live_room source_room ON source_room.id = source_round.room_id
 JOIN live_room target_room ON target_room.id = job.target_room_id`;

const COMPENSATION_ITEM_SELECT = `SELECT item.id, item.job_id, item.sequence_no,
  item.item_type, item.source_gift_event_id, item.event_id, item.external_user_id,
  item.nickname_snapshot, item.avatar_url_snapshot, item.gift_id, item.gift_name,
  item.gift_count, item.gift_value, item.payload_json, item.status,
  item.cancel_releases_source, item.attempt_count, item.lease_expires_at,
  item.last_error, item.enqueued_at,
  item.created_at, item.updated_at
 FROM compensation_job_item item`;

async function selectCompensationSourceRound(connection, platform, roundId) {
  const [rows] = await connection.execute(
    `SELECT gr.id, gr.room_id, gr.external_round_id, source_room.platform,
      source_room.external_room_id,
      COALESCE(gr.anchor_user_id, source_room.anchor_user_id) AS anchor_user_id
     FROM game_round gr
     JOIN live_room source_room ON source_room.id = gr.room_id
     WHERE source_room.platform = ? AND gr.id = ?
     FOR UPDATE`,
    [platform, roundId],
  );
  if (rows.length === 0) throw notFound('compensation_round_not_found');
  if (!rows[0].anchor_user_id) {
    throw new AdminRepositoryError(
      'source round room has no anchor identity',
      'compensation_source_anchor_missing',
      409,
    );
  }
  return rows[0];
}

async function selectCompensationTargetRoom(connection, platform, roomId) {
  const [rows] = await connection.execute(
    `SELECT id, platform, external_room_id, anchor_user_id
     FROM live_room
     WHERE platform = ? AND external_room_id = ?
     FOR UPDATE`,
    [platform, roomId],
  );
  if (rows.length === 0) throw notFound('compensation_target_room_not_found');
  return rows[0];
}

async function selectCompensationSourceEvents(
  connection,
  roundId,
  snapshotMaxEventId,
  selections,
) {
  const selectionSql = selections.map(() => (
    '(pu.external_user_id = ? AND gift.gift_id = ?)'
  )).join(' OR ');
  const selectionParams = selections.flatMap(selection => [selection.userId, selection.giftId]);
  const [rows] = await connection.execute(
    `WITH round_window AS (
       SELECT gr.id, gr.room_id, gr.started_at,
         COALESCE(
           gr.settled_at,
           (
             SELECT next_round.started_at
             FROM game_round next_round
             WHERE next_round.room_id = gr.room_id
               AND (next_round.started_at > gr.started_at
                 OR (next_round.started_at = gr.started_at AND next_round.id > gr.id))
             ORDER BY next_round.started_at ASC, next_round.id ASC
             LIMIT 1
           ),
           UTC_TIMESTAMP(3)
         ) AS ended_at
       FROM game_round gr
       WHERE gr.id = ?
     )
     SELECT gift.id AS source_gift_event_id, pu.external_user_id,
       gift.nickname_snapshot, gift.avatar_url_snapshot, gift.gift_id,
       gift.gift_name, gift.gift_count, gift.gift_value, gift.occurred_at
     FROM live_gift_event gift
     JOIN round_window rw ON (
       gift.round_id = rw.id
       OR (
         gift.round_id IS NULL
         AND gift.room_id = rw.room_id
         AND gift.occurred_at >= rw.started_at
         AND gift.occurred_at < rw.ended_at
       )
     )
     JOIN platform_user pu ON pu.id = gift.user_id
     WHERE gift.id <= ? AND (${selectionSql})
     ORDER BY gift.occurred_at ASC, gift.id ASC`,
    [roundId, snapshotMaxEventId, ...selectionParams],
  );
  return rows;
}

function assertAllSelectionsFound(selections, sourceEvents) {
  const found = new Set(sourceEvents.map(event => selectionKey(
    event.external_user_id,
    event.gift_id,
  )));
  const missing = selections.filter(selection => !found.has(selectionKey(
    selection.userId,
    selection.giftId,
  )));
  if (missing.length > 0) {
    throw new AdminRepositoryError(
      'one or more selected gift groups do not exist in the source round',
      'compensation_selection_not_found',
      404,
    );
  }
}

function buildCompensationItems({
  requestId,
  sourceEvents,
  seatPlayers,
  commentContent,
  createdAt,
}) {
  const items = [];
  const seatUserOrder = [];
  const seatUsers = new Map();
  for (const event of sourceEvents) {
    const userId = String(event.external_user_id);
    if (!seatUsers.has(userId)) seatUserOrder.push(userId);
    seatUsers.set(userId, event);
  }

  if (seatPlayers) {
    for (const userId of seatUserOrder) {
      const source = seatUsers.get(userId);
      const eventId = compensationEventId(requestId, 'comment', userId);
      items.push({
        type: 'comment',
        sourceGiftEventId: null,
        eventId,
        userId,
        nickname: source.nickname_snapshot,
        avatarUrl: source.avatar_url_snapshot,
        giftId: null,
        giftName: null,
        count: null,
        value: null,
        payload: {
          msg_id: eventId,
          msg_type: 1,
          sec_openid: userId,
          nickname: source.nickname_snapshot,
          avatar_url: source.avatar_url_snapshot,
          timestamp: createdAt.getTime() + items.length,
          source: 'operator',
          content: commentContent,
        },
      });
    }
  }

  for (const source of sourceEvents) {
    const sourceId = String(source.source_gift_event_id);
    const eventId = compensationEventId(requestId, 'gift', sourceId);
    const count = safeDatabaseInteger(source.gift_count, 'gift_count');
    const value = safeDatabaseInteger(source.gift_value, 'gift_value');
    items.push({
      type: 'gift',
      sourceGiftEventId: sourceId,
      eventId,
      userId: String(source.external_user_id),
      nickname: source.nickname_snapshot,
      avatarUrl: source.avatar_url_snapshot,
      giftId: source.gift_id,
      giftName: source.gift_name,
      count,
      value,
      payload: {
        msg_id: eventId,
        msg_type: 3,
        sec_openid: String(source.external_user_id),
        nickname: source.nickname_snapshot,
        avatar_url: source.avatar_url_snapshot,
        timestamp: utcDate(source.occurred_at).getTime(),
        source: 'operator',
        count,
        sec_gift_id: source.gift_id,
        giftname: source.gift_name,
        gift_value: value,
      },
    });
  }
  return items.map((item, index) => ({ ...item, sequence: index + 1 }));
}

function compensationEventId(requestId, type, sourceId) {
  return `recovery:${sha256Hex(`${requestId}\u0000${type}\u0000${sourceId}`)}`;
}

function compensationItemTotals(items) {
  return items.reduce((totals, item) => {
    if (item.type === 'comment') {
      totals.seatEvents += 1;
    } else {
      totals.giftEvents += 1;
      totals.giftCount += BigInt(item.count);
      totals.giftValue += BigInt(item.value);
    }
    return totals;
  }, { giftEvents: 0, giftCount: 0n, giftValue: 0n, seatEvents: 0 });
}

async function insertCompensationItems(connection, jobId, items, createdAt) {
  const columns = `(job_id, sequence_no, item_type, source_gift_event_id, event_id,
    external_user_id, nickname_snapshot, avatar_url_snapshot, gift_id, gift_name,
    gift_count, gift_value, payload_json, status, created_at, updated_at)`;
  for (let offset = 0; offset < items.length; offset += 200) {
    const chunk = items.slice(offset, offset + 200);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'pending\', ?, ?)');
    const params = chunk.flatMap(item => [
      jobId,
      item.sequence,
      item.type,
      item.sourceGiftEventId,
      item.eventId,
      item.userId,
      item.nickname,
      item.avatarUrl,
      item.giftId,
      item.giftName,
      item.count,
      item.value,
      JSON.stringify(item.payload),
      createdAt,
      createdAt,
    ]);
    await connection.query(
      `INSERT INTO compensation_job_item ${columns} VALUES ${placeholders.join(', ')}`,
      params,
    );
  }
}

async function selectCompensationJob(connection, platform, jobId, forUpdate) {
  const [rows] = await connection.execute(
    `${COMPENSATION_JOB_SELECT}
     WHERE source_room.platform = ? AND job.id = ?${forUpdate ? '\n     FOR UPDATE' : ''}`,
    [platform, jobId],
  );
  if (rows.length === 0) throw notFound('compensation_job_not_found');
  return rows[0];
}

async function selectCompensationJobByRequest(
  connection,
  platform,
  requestId,
  forUpdate,
) {
  const [rows] = await connection.execute(
    `${COMPENSATION_JOB_SELECT}
     WHERE source_room.platform = ? AND job.request_id = ?${forUpdate ? '\n     FOR UPDATE' : ''}`,
    [platform, requestId],
  );
  return rows[0] || null;
}

async function selectCompensationJobByPayloadHash(
  connection,
  platform,
  payloadHash,
  forUpdate,
) {
  const [rows] = await connection.execute(
    `${COMPENSATION_JOB_SELECT}
     WHERE source_room.platform = ? AND job.payload_hash = ?${forUpdate ? '\n     FOR UPDATE' : ''}`,
    [platform, payloadHash],
  );
  return rows[0] || null;
}

function assertJobPayload(job, payloadHash) {
  if (job.payload_hash !== payloadHash) {
    throw new AdminRepositoryError(
      'request id already belongs to a different recovery payload',
      'compensation_job_payload_conflict',
      409,
    );
  }
}

function duplicateIndex(error, indexName) {
  return String(error?.message || '').includes(indexName);
}

function mapCompensationRoundRow(row) {
  return {
    roundDbId: String(row.round_db_id),
    roomDbId: String(row.room_db_id),
    roomId: row.external_room_id,
    externalRoundId: row.external_round_id,
    status: row.status,
    sourceClaimReleased: row.item_type === 'gift'
      ? row.status === 'cancelled' && Boolean(row.cancel_releases_source)
      : null,
    startedAt: row.started_at,
    settledAt: row.settled_at,
    anchorUserId: row.anchor_external_user_id,
    anchorNickname: row.anchor_nickname,
    anchorAvatarUrl: row.anchor_avatar_url,
    latestTargetRoomId: row.latest_target_room_id || '',
    latestTargetRoomAuthenticatedAt: row.latest_target_room_authenticated_at,
  };
}

function mapCompensationGiftGroupRow(row) {
  return {
    userId: row.external_user_id,
    nickname: row.nickname_snapshot,
    avatarUrl: row.avatar_url_snapshot,
    giftId: row.gift_id,
    giftName: row.gift_name,
    eventCount: Number(row.event_count),
    totalCount: jsonInteger(row.total_count),
    totalValue: jsonInteger(row.total_value),
    firstAt: row.first_at,
    lastAt: row.last_at,
  };
}

function mapCompensationJobRow(row) {
  const totalItems = Number(row.total_items);
  const completedItems = Number(row.completed_items);
  const failedItems = Number(row.failed_items);
  const cancelledItems = Number(row.cancelled_items);
  return {
    id: String(row.id),
    requestId: row.request_id,
    sourceRoundId: String(row.source_round_id),
    sourceSnapshotMaxEventId: String(row.source_snapshot_max_event_id),
    sourceRoomId: row.source_external_room_id,
    sourceExternalRoundId: row.source_external_round_id,
    targetRoomId: row.target_external_room_id,
    status: row.status,
    seatPlayers: Boolean(row.seat_players),
    commentContent: row.comment_content,
    intervalMs: Number(row.interval_ms),
    reason: row.reason,
    totalItems,
    completedItems,
    failedItems,
    cancelledItems,
    pendingItems: Math.max(0, totalItems - completedItems - failedItems - cancelledItems),
    totalGiftEvents: Number(row.total_gift_events),
    totalGiftCount: jsonInteger(row.total_gift_count),
    totalGiftValue: jsonInteger(row.total_gift_value),
    totalSeatEvents: Number(row.total_seat_events),
    lastError: row.last_error || '',
    nextRunAt: row.next_run_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCompensationItemRow(row) {
  return {
    id: String(row.id),
    sequence: Number(row.sequence_no),
    type: row.item_type,
    sourceGiftEventId: row.source_gift_event_id === null
      ? null
      : String(row.source_gift_event_id),
    eventId: row.event_id,
    userId: row.external_user_id,
    nickname: row.nickname_snapshot,
    avatarUrl: row.avatar_url_snapshot,
    giftId: row.gift_id,
    giftName: row.gift_name,
    count: row.gift_count === null ? null : jsonInteger(row.gift_count),
    value: row.gift_value === null ? null : jsonInteger(row.gift_value),
    status: row.status,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error || '',
    leaseExpiresAt: row.lease_expires_at,
    enqueuedAt: row.enqueued_at,
  };
}

function selectionKey(userId, giftId) {
  return `${userId}\u0000${giftId}`;
}

function likeContains(value) {
  return `%${String(value).replace(/[\\%_]/gu, match => `\\${match}`)}%`;
}

function safeDatabaseInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AdminRepositoryError(
      `${field} cannot be represented safely in an event payload`,
      'compensation_event_value_too_large',
      409,
    );
  }
  return parsed;
}

function addJsonIntegers(left, right) {
  return jsonInteger((BigInt(left) + BigInt(right)).toString());
}

function utcDate(value) {
  if (value instanceof Date) return value;
  const source = String(value).trim().replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/iu.test(source) ? source : `${source}Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid UTC timestamp: ${value}`);
  return date;
}

async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function selectPlatformUserId(connection, platform, userId, forUpdate) {
  const [rows] = await connection.execute(
    `SELECT id
     FROM platform_user
     WHERE platform = ? AND external_user_id = ?${forUpdate ? '\n     FOR UPDATE' : ''}`,
    [platform, userId],
  );
  if (rows.length === 0) throw notFound('user_not_found');
  return rows[0].id;
}

async function selectGuildId(connection, guildId, forUpdate) {
  const [rows] = await connection.execute(
    `SELECT id FROM guild WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [guildId],
  );
  if (rows.length === 0) throw notFound('guild_not_found');
  return rows[0].id;
}

async function selectEnabledGuildId(connection, guildId) {
  const [rows] = await connection.execute(
    'SELECT id, enabled FROM guild WHERE id = ? FOR UPDATE',
    [guildId],
  );
  if (rows.length === 0) throw notFound('guild_not_found');
  if (!rows[0].enabled) {
    throw new AdminRepositoryError('guild is disabled', 'guild_disabled', 409);
  }
  return rows[0].id;
}

async function selectGuild(connection, guildId) {
  const [rows] = await connection.execute(
    `SELECT g.id, g.name, g.join_code, g.description, g.enabled, g.version,
      g.created_at, g.updated_at, COUNT(gm.user_id) AS member_count
     FROM guild g
     LEFT JOIN guild_member gm ON gm.guild_id = g.id
     WHERE g.id = ?
     GROUP BY g.id`,
    [guildId],
  );
  if (rows.length === 0) throw notFound('guild_not_found');
  return mapGuildRow(rows[0]);
}

function mapCompensationRow(row) {
  return {
    id: String(row.id),
    platform: row.platform,
    eventId: row.event_id,
    roomId: row.room_id,
    userId: row.external_user_id,
    nickname: row.nickname,
    giftId: row.gift_id,
    giftName: row.gift_name,
    count: Number(row.gift_count),
    status: row.status,
    reason: row.reason,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    enqueuedAt: row.enqueued_at,
  };
}

function mapGuildRow(row) {
  return {
    guildId: String(row.id),
    name: row.name,
    joinCode: row.join_code,
    description: row.description,
    enabled: Boolean(row.enabled),
    version: Number(row.version),
    memberCount: Number(row.member_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGuildMemberRow(row) {
  return {
    userId: row.external_user_id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedAt: row.joined_at,
  };
}

function parseJsonColumn(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function jsonInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : String(value);
}

function notFound(code) {
  return new AdminRepositoryError(code.replaceAll('_', ' '), code, 404);
}

function guildWriteError(error) {
  if (error instanceof AdminRepositoryError) return error;
  if (error?.code === 'ER_DUP_ENTRY') {
    if (String(error.message).includes('uq_guild_join_code')) {
      return new AdminRepositoryError('guild join code already exists', 'guild_join_code_conflict', 409);
    }
    return new AdminRepositoryError('guild name already exists', 'guild_name_conflict', 409);
  }
  return error;
}
