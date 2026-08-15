import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadConfig } from '../../src/config.js';
import { sha256Hex } from '../../src/lib/crypto.js';
import { createProjectServices } from '../../src/services/project-services.js';
import { AdminRepositoryError } from '../../src/services/admin-repository.js';

test('real MySQL freezes the reviewed gift snapshot and materializes a durable job', {
  timeout: 30_000,
}, async () => {
  const config = loadConfig();
  const project = config.projects.find(value => value.capabilities.compensations);
  assert.ok(project, 'at least one compensation project is required');
  const services = createProjectServices(config, {
    compensationWorkerFactory: () => ({ start() {}, async stop() {} }),
  });
  const projectServices = services.projects.get(project.id);
  const pool = projectServices.repository.pool;
  const suffix = randomUUID();
  const ids = {};
  const payloadHash = sha256Hex(`integration:${suffix}`);
  const overlapPayloadHash = sha256Hex(`integration-overlap:${suffix}`);

  try {
    const [anchor] = await pool.execute(
      `INSERT INTO platform_user (platform, external_user_id, nickname, avatar_url)
       VALUES (?, ?, ?, '')`,
      [project.platform, `codex-anchor-${suffix}`, `Codex Anchor ${suffix}`],
    );
    ids.anchor = anchor.insertId;
    const [viewer] = await pool.execute(
      `INSERT INTO platform_user (platform, external_user_id, nickname, avatar_url)
       VALUES (?, ?, 'Codex Viewer', '')`,
      [project.platform, `codex-viewer-${suffix}`],
    );
    ids.viewer = viewer.insertId;

    const authenticatedAt = new Date('2026-08-07T08:00:00.000Z');
    const [sourceRoom] = await pool.execute(
      `INSERT INTO live_room
        (platform, external_room_id, anchor_user_id, config_key, last_authenticated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [project.platform, `codex-source-${suffix}`, ids.anchor, project.configKey, authenticatedAt],
    );
    ids.sourceRoom = sourceRoom.insertId;
    const [targetRoom] = await pool.execute(
      `INSERT INTO live_room
        (platform, external_room_id, anchor_user_id, config_key, last_authenticated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        project.platform,
        `codex-target-${suffix}`,
        ids.anchor,
        project.configKey,
        new Date('2026-08-07T08:10:00.000Z'),
      ],
    );
    ids.targetRoom = targetRoom.insertId;
    const [overlapTargetRoom] = await pool.execute(
      `INSERT INTO live_room
        (platform, external_room_id, anchor_user_id, config_key, last_authenticated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        project.platform,
        `codex-target-overlap-${suffix}`,
        ids.anchor,
        project.configKey,
        new Date('2026-08-07T08:11:00.000Z'),
      ],
    );
    ids.overlapTargetRoom = overlapTargetRoom.insertId;

    const [round] = await pool.execute(
      `INSERT INTO game_round
        (room_id, anchor_user_id, anchor_nickname_snapshot,
         anchor_avatar_url_snapshot, anchor_authenticated_at_snapshot,
         external_round_id, status, total_value, started_at, settled_at)
       VALUES (?, ?, ?, '', ?, ?, 'settled', 0, ?, ?)`,
      [
        ids.sourceRoom,
        ids.anchor,
        `Historic Anchor ${suffix}`,
        authenticatedAt,
        `codex-round-${suffix}`,
        new Date('2026-08-07T08:01:00.000Z'),
        new Date('2026-08-07T08:05:00.000Z'),
      ],
    );
    ids.round = round.insertId;

    ids.gifts = [];
    ids.gifts.push(await insertGift(pool, {
      roomId: ids.sourceRoom,
      roundId: ids.round,
      userId: ids.viewer,
      sourceEventId: `codex-gift-direct-${suffix}`,
      count: 1,
      value: 10,
      occurredAt: new Date('2026-08-07T08:02:00.000Z'),
    }));
    ids.gifts.push(await insertGift(pool, {
      roomId: ids.sourceRoom,
      roundId: null,
      userId: ids.viewer,
      sourceEventId: `codex-gift-window-${suffix}`,
      count: 2,
      value: 20,
      occurredAt: new Date('2026-08-07T08:03:00.000Z'),
    }));

    const rounds = await projectServices.adminRepository.listCompensationRounds({
      platform: project.platform,
      anchorNickname: `Historic Anchor ${suffix}`,
      startedFrom: new Date('2026-08-07T00:00:00.000Z'),
      startedTo: new Date('2026-08-08T00:00:00.000Z'),
      limit: 10,
    });
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].anchorNickname, `Historic Anchor ${suffix}`);
    assert.equal(rounds[0].latestTargetRoomId, `codex-target-overlap-${suffix}`);

    const reviewed = await projectServices.adminRepository.listCompensationRoundGifts({
      platform: project.platform,
      roundId: String(ids.round),
    });
    assert.equal(reviewed.snapshotMaxEventId, String(ids.gifts[1]));
    assert.equal(reviewed.totals.eventCount, 2);
    assert.equal(reviewed.totals.totalCount, 3);

    const lateGiftId = await insertGift(pool, {
      roomId: ids.sourceRoom,
      roundId: ids.round,
      userId: ids.viewer,
      sourceEventId: `codex-gift-late-${suffix}`,
      count: 50,
      value: 500,
      occurredAt: new Date('2026-08-07T08:04:00.000Z'),
    });
    ids.gifts.push(lateGiftId);

    const reason = `integration recovery ${suffix}`;
    const job = await projectServices.adminRepository.createCompensationJob({
      platform: project.platform,
      requestId: `codex-request-${suffix}`,
      payloadHash,
      sourceRoundId: String(ids.round),
      sourceSnapshotMaxEventId: reviewed.snapshotMaxEventId,
      targetRoomId: `codex-target-${suffix}`,
      selections: [{ userId: `codex-viewer-${suffix}`, giftId: 'legacy-gift' }],
      seatPlayers: true,
      commentContent: '上车',
      intervalMs: 500,
      reason,
      createdAt: new Date(),
    });
    ids.jobs = [job.id];
    assert.equal(job.sourceSnapshotMaxEventId, reviewed.snapshotMaxEventId);
    assert.equal(job.totalItems, 3);
    assert.equal(job.totalGiftEvents, 2);
    assert.equal(job.totalGiftCount, 3);
    assert.equal(job.totalGiftValue, 30);

    const detail = await projectServices.adminRepository.getCompensationJob({
      platform: project.platform,
      jobId: job.id,
    });
    assert.deepEqual(detail.items.map(item => item.type), ['comment', 'gift', 'gift']);
    assert.deepEqual(detail.items.slice(1).map(item => item.sourceGiftEventId),
      ids.gifts.slice(0, 2).map(String));
    assert.equal(detail.items.some(item => item.sourceGiftEventId === String(lateGiftId)), false);

    const repeated = await projectServices.adminRepository.createCompensationJob({
      platform: project.platform,
      requestId: `codex-request-after-refresh-${suffix}`,
      payloadHash,
      sourceRoundId: String(ids.round),
      sourceSnapshotMaxEventId: reviewed.snapshotMaxEventId,
      targetRoomId: `codex-target-${suffix}`,
      selections: [{ userId: `codex-viewer-${suffix}`, giftId: 'legacy-gift' }],
      seatPlayers: true,
      commentContent: '上车',
      intervalMs: 500,
      reason,
      createdAt: new Date(),
    });
    assert.equal(repeated.id, job.id);
    assert.equal(repeated.requestId, `codex-request-${suffix}`);

    await assert.rejects(
      projectServices.adminRepository.createCompensationJob({
        platform: project.platform,
        requestId: `codex-overlap-${suffix}`,
        payloadHash: overlapPayloadHash,
        sourceRoundId: String(ids.round),
        sourceSnapshotMaxEventId: reviewed.snapshotMaxEventId,
        targetRoomId: `codex-target-overlap-${suffix}`,
        selections: [{ userId: `codex-viewer-${suffix}`, giftId: 'legacy-gift' }],
        seatPlayers: false,
        commentContent: '',
        intervalMs: 500,
        reason: `overlap recovery ${suffix}`,
        createdAt: new Date(),
      }),
      error => error instanceof AdminRepositoryError
        && error.code === 'compensation_source_event_already_claimed',
    );

    const cancelled = await projectServices.adminRepository.cancelCompensationJob({
      platform: project.platform,
      jobId: job.id,
      cancelledAt: new Date(),
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelledItems, 3);

    const replacement = await projectServices.adminRepository.createCompensationJob({
      platform: project.platform,
      requestId: `codex-overlap-after-cancel-${suffix}`,
      payloadHash: overlapPayloadHash,
      sourceRoundId: String(ids.round),
      sourceSnapshotMaxEventId: reviewed.snapshotMaxEventId,
      targetRoomId: `codex-target-overlap-${suffix}`,
      selections: [{ userId: `codex-viewer-${suffix}`, giftId: 'legacy-gift' }],
      seatPlayers: false,
      commentContent: '',
      intervalMs: 500,
      reason: `overlap recovery ${suffix}`,
      createdAt: new Date(),
    });
    ids.jobs.push(replacement.id);
    assert.equal(replacement.totalGiftEvents, 2);
    const replacementCancelled = await projectServices.adminRepository.cancelCompensationJob({
      platform: project.platform,
      jobId: replacement.id,
      cancelledAt: new Date(),
    });
    assert.equal(replacementCancelled.cancelledItems, 2);
  } finally {
    for (const jobId of [...(ids.jobs || [])].reverse()) {
      await pool.execute('DELETE FROM compensation_job_item WHERE job_id = ?', [jobId]);
      await pool.execute('DELETE FROM compensation_job WHERE id = ?', [jobId]);
    }
    await pool.execute(
      `DELETE item FROM compensation_job_item item
       JOIN compensation_job job ON job.id = item.job_id
       WHERE job.payload_hash IN (?, ?)`,
      [payloadHash, overlapPayloadHash],
    );
    await pool.execute(
      'DELETE FROM compensation_job WHERE payload_hash IN (?, ?)',
      [payloadHash, overlapPayloadHash],
    );
    for (const giftId of [...(ids.gifts || [])].reverse()) {
      await pool.execute('DELETE FROM live_gift_event WHERE id = ?', [giftId]);
    }
    if (ids.round) await pool.execute('DELETE FROM game_round WHERE id = ?', [ids.round]);
    for (const roomId of [
      ids.overlapTargetRoom,
      ids.targetRoom,
      ids.sourceRoom,
    ].filter(Boolean)) {
      await pool.execute('DELETE FROM live_room WHERE id = ?', [roomId]);
    }
    for (const userId of [ids.viewer, ids.anchor].filter(Boolean)) {
      await pool.execute('DELETE FROM platform_user WHERE id = ?', [userId]);
    }
    const [remaining] = await pool.execute(
      `SELECT
        (SELECT COUNT(*) FROM compensation_job WHERE payload_hash IN (?, ?)) AS jobs,
        (SELECT COUNT(*) FROM live_gift_event WHERE platform_event_id LIKE ?) AS gifts,
        (SELECT COUNT(*) FROM live_room WHERE external_room_id LIKE ?) AS rooms,
        (SELECT COUNT(*) FROM platform_user WHERE external_user_id LIKE ?) AS users`,
      [
        payloadHash,
        overlapPayloadHash,
        `%${suffix}`,
        `%${suffix}`,
        `%${suffix}`,
      ],
    );
    assert.deepEqual({
      jobs: Number(remaining[0].jobs),
      gifts: Number(remaining[0].gifts),
      rooms: Number(remaining[0].rooms),
      users: Number(remaining[0].users),
    }, { jobs: 0, gifts: 0, rooms: 0, users: 0 });
    await services.close();
  }
});

async function insertGift(pool, {
  roomId,
  roundId,
  userId,
  sourceEventId,
  count,
  value,
  occurredAt,
}) {
  const payload = {
    msg_id: sourceEventId,
    msg_type: 3,
    sec_openid: String(userId),
    nickname: 'Codex Viewer',
    avatar_url: '',
    timestamp: occurredAt.getTime(),
    count,
    sec_gift_id: 'legacy-gift',
    giftname: 'Legacy Gift',
    gift_value: value,
  };
  const [result] = await pool.execute(
    `INSERT INTO live_gift_event
      (room_id, round_id, user_id, platform_event_id, nickname_snapshot,
       avatar_url_snapshot, gift_id, gift_name, gift_count, gift_value,
       occurred_at, payload_json, delivery_status)
     VALUES (?, ?, ?, ?, 'Codex Viewer', '', 'legacy-gift', 'Legacy Gift', ?, ?, ?, ?, 'delivered')`,
    [
      roomId,
      roundId,
      userId,
      sourceEventId,
      count,
      value,
      occurredAt,
      JSON.stringify(payload),
    ],
  );
  return result.insertId;
}
