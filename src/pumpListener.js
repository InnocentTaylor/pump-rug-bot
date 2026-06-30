import WebSocket from 'ws';
import { EventEmitter } from 'events';

const PUMP_WS_URL = 'wss://pumpportal.fun/api/data';

/**
 * Opens a persistent WebSocket connection to PumpPortal's free real-time
 * feed and emits a 'newToken' event the moment a new pump.fun token is
 * created on-chain — no polling, no waiting on an aggregator to index it.
 */
export function startPumpListener() {
  const emitter = new EventEmitter();
  let ws;

  function connect() {
    ws = new WebSocket(PUMP_WS_URL);

    ws.on('open', () => {
      console.log('Connected to PumpPortal — subscribing to new tokens');
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.txType === 'create' && data.mint) {
          emitter.emit('newToken', data);
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
