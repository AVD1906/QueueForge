import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 10 },  // ramp up to 10 users
    { duration: '30s', target: 50 },  // ramp up to 50 users
    { duration: '20s', target: 50 },  // hold at 50 users
    { duration: '10s', target: 0  },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed:   ['rate<0.01'], // less than 1% failure rate
  },
};

const BASE_URL = 'http://127.0.0.1:3000';

export default function () {
  const queues = ['email', 'image', 'report'];
  const queue = queues[Math.floor(Math.random() * queues.length)];

  const payload = JSON.stringify({
    queue,
    payload: {
      to: 'test@gmail.com',
      subject: `Load test job ${Date.now()}`,
      userId: Math.floor(Math.random() * 1000),
    },
  });

  const res = http.post(`${BASE_URL}/jobs`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status was 201': (r) => r.status === 201,
    'has jobId': (r) => JSON.parse(r.body).jobId !== undefined,
  });

  sleep(0.1);
}