import WebSocket from 'ws';
import { EventEmitter } from 'events';

const PUMP_WS_URL = 'wss://pumpportal.fun/api/data';

export function startPumpListener() {
  const emitter = new EventEmitter();
  let ws;

  function connect() {
    ws = new WebSocket(PUMP_WS_URL);

    ws.on('open', () => {
      console.log('Connected to PumpPortal — subscribing to new tokens and migrations');
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        // TEMPORARY — logs every raw message so we can confirm the real
        // shape of graduation/migration events before trusting the
        // parsing below. We'll remove this once confirmed.
        console.log('RAW MESSAGE:', JSON.stringify(data));

        if (data.txType === 'create' && data.mint) {
          emitter.emit('newToken', data);
        }

        // Best-guess detection of a graduation event — to be confirmed
        // against real messages and adjusted if needed.
        if (data.mint && (data.txType === 'migrate' || data.pool === 'raydium')) {
          emitter.emit('tokenGraduated', data);
        }
      } catch (err) {
        console.error('Failed to parse PumpPortal message:', err.message);
      }
    });

    ws.on('close', () => {
      console.warn('PumpPortal connection closed — reconnecting in 5s');
      setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
      console.error('PumpPortal WS error:', err.message);
      ws.close();
    });
  }

  connect();
  return emitter;
}
