import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

export const options = {
  scenarios: {
    smoke: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 }
      ]
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    plchat_login_success_rate: ['rate>0.95'],
    plchat_message_latency: ['p(95)<300']
  }
};

const baseUrl = __ENV.PLCHAT_API_URL || 'http://localhost:8787';
const loginSuccessRate = new Rate('plchat_login_success_rate');
const messageLatency = new Trend('plchat_message_latency');

export default function () {
  const identity = `${__VU}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const email = `load-${identity}@example.com`;
  const password = `LoadTest${identity}!`;

  const register = http.post(
    `${baseUrl}/api/auth/register`,
    JSON.stringify({ email, password, displayName: `Load ${__VU}` }),
    { headers: { 'content-type': 'application/json' } }
  );
  check(register, { 'registered': (response) => response.status === 201 || response.status === 409 });

  const code = register.json('previewVerificationCode') || '000000';
  http.post(`${baseUrl}/api/auth/verify-email`, JSON.stringify({ email, code }), {
    headers: { 'content-type': 'application/json' }
  });

  const login = http.post(`${baseUrl}/api/auth/login`, JSON.stringify({ email, password, deviceName: 'k6' }), {
    headers: { 'content-type': 'application/json' }
  });
  const token = login.json('accessToken');
  loginSuccessRate.add(login.status === 200 && Boolean(token));
  if (!token) return;

  const authHeaders = { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
  const room = http.post(`${baseUrl}/api/rooms`, JSON.stringify({ type: 'GROUP', title: `Load Room ${__VU}` }), authHeaders);
  const roomId = room.json('id');
  if (!roomId) return;

  const started = Date.now();
  const message = http.post(
    `${baseUrl}/api/messages`,
    JSON.stringify({ roomId, clientNonce: `${identity}-1`, body: 'load test message' }),
    authHeaders
  );
  messageLatency.add(Date.now() - started);
  check(message, { 'message persisted': (response) => response.status === 201 });

  sleep(1);
}
