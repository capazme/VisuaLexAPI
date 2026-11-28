import http from 'node:http';

export interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

export interface Call {
  method?: string;
  path?: string;
  /** Sent as given; `host` defaults to `127.0.0.1:<port>`, and `host: null` sends none. */
  headers?: Record<string, string | null>;
  body?: unknown;
}

/** A raw HTTP request to 127.0.0.1, with the headers exactly as a test wants them (Host, Origin, Sec-Fetch-*). */
export function call(port: number, { method = 'GET', path = '/', headers = {}, body }: Call = {}): Promise<Answer> {
  const sent: Record<string, string> = {};
  const host = headers.host === undefined ? `127.0.0.1:${port}` : headers.host;
  for (const [name, value] of Object.entries(headers)) if (name !== 'host' && value !== null) sent[name] = value;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) {
    sent['content-type'] = 'application/json';
    sent['content-length'] = String(Buffer.byteLength(payload));
  }
  if (host !== null) sent.host = host;
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path, headers: sent, setHost: false, agent: false }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text }));
    });
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

/** The `Cookie` header for a set of cookies, as the window would send them. */
export const cookieHeader = (cookies: Array<{ name: string; value: string }>): string => cookies.map((c) => `${c.name}=${c.value}`).join('; ');
