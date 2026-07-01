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
        console.log('RAW MESSAGE:', JSON.stringify(data));

        if (data.txType === 'create' && data.mint) {
          emitter.emit('newToken', data);
        }
        if (data.mint && (data.txType === 'buy' || data.txType === 'sell')) {
          emitter.emit('tokenTrade', data);
        }
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

  // Tune in to / stop tuning in to one specific coin's live trades.
  emitter.subscribeTrades = (mint) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
    }
  };
  emitter.unsubscribeTrades = (mint) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [mint] }));
    }
  };

  connect();
  return emitter;
}
