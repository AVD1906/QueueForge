const Redis = require('ioredis');
const { processJob } = require('./processor');
const { getBackoffDelay, shouldMoveToDeadLetter } = require('./retry');
const { Pool } = require('pg');
const { io } = require('socket.io-client');

const redis = new Redis(process.env.REDIS_URL);
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

const WORKER_ID = process.env.WORKER_ID || 'worker-1';
const GROUP_NAME = 'taskqueue-workers';

// Connect to API's Socket.io server
const socket = io('http://api:3000');
socket.on('connect', () => console.log(`[${WORKER_ID}] Connected to event bus`));
socket.on('disconnect', () => console.log(`[${WORKER_ID}] Disconnected from event bus`));

function emit(event, data) {
  socket.emit(event, { ...data, workerId: WORKER_ID, timestamp: new Date().toISOString() });
}

async function setupConsumerGroup(queue) {
  try {
    await redis.xgroup('CREATE', `queue:${queue}`, GROUP_NAME, '$', 'MKSTREAM');
    console.log(`Consumer group created for queue:${queue}`);
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) throw err;
  }
}

async function updateJobStatus(jobId, status, result = null, error = null) {
  await pool.query(
    `UPDATE jobs 
     SET status = $1, result = $2, error = $3, updated_at = NOW()
     WHERE id = $4`,
    [status, result ? JSON.stringify(result) : null, error, jobId]
  );
}

async function incrementAttempts(jobId) {
  const { rows } = await pool.query(
    `UPDATE jobs 
     SET attempts = attempts + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING attempts`,
    [jobId]
  );
  return rows[0].attempts;
}

async function processMessage(queue, messageId, fields) {
  const jobId = fields.jobId;
  const payload = JSON.parse(fields.payload);

  console.log(`[${WORKER_ID}] Picked up job ${jobId} from queue:${queue}`);
  emit('job:active', { jobId, queue, payload });
  await updateJobStatus(jobId, 'active');

  try {
    const result = await processJob(queue, payload);

    await redis.xack(`queue:${queue}`, GROUP_NAME, messageId);
    await updateJobStatus(jobId, 'completed', result);

    emit('job:completed', { jobId, queue, result });
    console.log(`[${WORKER_ID}] Completed job ${jobId}`);
  } catch (err) {
    console.error(`[${WORKER_ID}] Failed job ${jobId}:`, err.message);

    const attempts = await incrementAttempts(jobId);

    if (shouldMoveToDeadLetter(attempts)) {
      await redis.xack(`queue:${queue}`, GROUP_NAME, messageId);
      await redis.xadd(
        'queue:failed',
        '*',
        'jobId', jobId,
        'queue', queue,
        'payload', JSON.stringify(payload),
        'error', err.message,
        'attempts', String(attempts)
      );
      await updateJobStatus(jobId, 'failed', null, err.message);
      emit('job:failed', { jobId, queue, error: err.message, attempts });
      console.log(`[${WORKER_ID}] Job ${jobId} moved to DLQ after ${attempts} attempts`);
    } else {
      const delay = getBackoffDelay(attempts);
      console.log(`[${WORKER_ID}] Retrying job ${jobId} in ${delay}ms (attempt ${attempts})`);
      await redis.xack(`queue:${queue}`, GROUP_NAME, messageId);
      setTimeout(async () => {
        await redis.xadd(
          `queue:${queue}`,
          '*',
          'jobId', jobId,
          'queue', queue,
          'payload', JSON.stringify(payload),
          'attempts', String(attempts)
        );
      }, delay);
      await updateJobStatus(jobId, 'waiting');
      emit('job:retry', { jobId, queue, attempts, delay });
    }
  }
}

async function startConsumer(queues) {
  console.log(`[${WORKER_ID}] Setting up consumer groups...`);
  for (const queue of queues) {
    await setupConsumerGroup(queue);
  }
  console.log(`[${WORKER_ID}] Listening on queues: ${queues.join(', ')}`);

  while (true) {
    for (const queue of queues) {
      try {
        const results = await redis.xreadgroup(
          'GROUP', GROUP_NAME,
          WORKER_ID,
          'COUNT', '1',
          'BLOCK', '1000',
          'STREAMS', `queue:${queue}`, '>'
        );

        if (results && results.length > 0) {
          const [, messages] = results[0];
          for (const [messageId, fieldValues] of messages) {
            const fields = {};
            for (let i = 0; i < fieldValues.length; i += 2) {
              fields[fieldValues[i]] = fieldValues[i + 1];
            }
            await processMessage(queue, messageId, fields);
          }
        }
      } catch (err) {
        console.error(`[${WORKER_ID}] Consumer error on ${queue}:`, err.message);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

module.exports = { startConsumer };