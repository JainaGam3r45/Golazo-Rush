import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT || 8080);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'golazo-compute-probe' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ t: 'welcome', service: 'golazo-compute-probe' }));
  socket.on('message', (raw) => {
    let msg = {};
    try {
      msg = JSON.parse(String(raw));
    } catch {
      socket.send(JSON.stringify({ t: 'error', error: 'invalid_json' }));
      return;
    }
    if (msg.t === 'ping') {
      socket.send(JSON.stringify({ t: 'pong', at: Date.now() }));
    }
  });
});

server.listen(port, () => {
  console.log(`golazo-compute-probe listening on ${port}`);
});
