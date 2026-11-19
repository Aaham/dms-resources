import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';

// Exercise Express's real middleware and HTTP response objects without opening
// a network socket. This also works in environments that prohibit local binds.
export function inject(app, { path, method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
    socket.remoteAddress = '127.0.0.1';
    const req = new IncomingMessage(socket);
    req.url = path;
    req.method = method;
    req.httpVersion = '1.1';
    req.complete = true;
    req.headers = { host: 'localhost', ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])) };
    const bytes = body === undefined ? null : Buffer.from(body);
    if (bytes) req.headers['content-length'] = String(bytes.length);
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    // A real HTTP server forwards the socket's 'drain' to the response. Without
    // this, a streamed file larger than one buffer never finishes.
    socket.on('drain', () => res.emit('drain'));
    const chunks = [];
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    res.write = (chunk, ...args) => { if (chunk) chunks.push(Buffer.from(chunk)); return write(chunk, ...args); };
    res.end = (chunk, ...args) => { if (chunk) chunks.push(Buffer.from(chunk)); return end(chunk, ...args); };
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error(`Request timed out: ${method} ${path}`)); }, 10_000);
    res.once('finish', () => {
      clearTimeout(timeout);
      const buffer = Buffer.concat(chunks);
      const text = buffer.toString();
      let json;
      try { json = JSON.parse(text); } catch { /* file or text response */ }
      resolve({ status: res.statusCode, headers: new Headers(res.getHeaders()), text, json, buffer });
      socket.destroy();
    });
    res.on('error', reject);
    app(req, res);
    if (bytes) req.push(bytes);
    req.push(null);
  });
}
