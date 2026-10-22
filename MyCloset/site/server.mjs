import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createWeatherService, validateCityQuery, validateWeatherQuery, WeatherError } from './weather.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const LAN = process.argv.includes('--lan');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const PORT = 4173;
const ADDRESS = 'http://127.0.0.1:' + PORT;
const weather = createWeatherService();
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/model.mjs', ['model.mjs', 'text/javascript; charset=utf-8']],
  ['/stylist.mjs', ['stylist.mjs', 'text/javascript; charset=utf-8']],
  ['/shopping.mjs', ['shopping.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/style-editorial.webp', ['assets/style-editorial.webp', 'image/webp']],
  ['/assets/fonts/manrope.ttf', ['assets/fonts/manrope.ttf', 'font/ttf']],
  ['/assets/fonts/cormorant-garamond.ttf', ['assets/fonts/cormorant-garamond.ttf', 'font/ttf']],
  ['/assets/fonts/cormorant-garamond-italic.ttf', ['assets/fonts/cormorant-garamond-italic.ttf', 'font/ttf']],
]);

function openBrowser() {
  if (!process.argv.includes('--open')) return;
  if (process.platform === 'win32') {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', ADDRESS], {
      detached: true, windowsHide: true, stdio: 'ignore'
    });
    child.on('error', () => console.log('Open ' + ADDRESS + ' in your browser.'));
    child.unref();
  }
}

function showAddresses() {
  console.log('На компьютере: ' + ADDRESS);
  if (!LAN) return;
  const addresses = new Set(Object.values(networkInterfaces()).flat()
    .filter(address => address && address.family === 'IPv4' && !address.internal)
    .map(address => address.address)
    .filter(address => /^10\./.test(address) || /^192\.168\./.test(address)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(address)));
  for (const address of addresses) console.log('На телефоне (та же Wi-Fi сеть): http://' + address + ':' + PORT);
  if (!addresses.size) console.log('Чтобы открыть сайт на телефоне, подключите компьютер к домашней сети Wi-Fi.');
}

const server = http.createServer(async (request, response) => {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
  const json = (status, payload, extraHeaders = {}) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body), ...extraHeaders });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  let url;
  try { url = new URL(request.url, ADDRESS); }
  catch { response.writeHead(400, headers); response.end('Bad request'); return; }
  const pathname = url.pathname;
  const isWeatherApi = pathname === '/api/cities' || pathname === '/api/weather';
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (isWeatherApi) json(405, { error: 'Разрешены только запросы GET и HEAD.' }, { Allow: 'GET, HEAD' });
    else { response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); response.end('Method not allowed'); }
    return;
  }
  if (isWeatherApi) {
    try {
      const value = pathname === '/api/cities'
        ? await weather.searchCities(validateCityQuery(url.searchParams))
        : await weather.forecast(validateWeatherQuery(url.searchParams));
      json(200, value);
    } catch (error) {
      json(error instanceof WeatherError ? error.status : 500,
        { error: error instanceof WeatherError ? error.message : 'Не удалось обработать запрос погоды. Попробуйте позже.' });
    }
    return;
  }
  if (pathname === '/__mycloset_health') {
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ app: 'mycloset-local', version: 1, lan: LAN }));
    return;
  }
  const file = files.get(pathname);
  if (!file) { response.writeHead(404, headers); response.end('Not found'); return; }
  try {
    const content = await readFile(join(ROOT, file[0]));
    response.writeHead(200, { ...headers, 'Content-Type': file[1], 'Content-Length': content.byteLength });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404, headers);
    response.end('File not found');
  }
});

server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    try {
      const health = await fetch(ADDRESS + '/__mycloset_health', { signal: AbortSignal.timeout(1500) });
      const result = await health.json();
      if (result.app === 'mycloset-local') {
        console.log('MyCloset уже запущен.');
        if (LAN && !result.lan) console.log('Для телефона закройте прежнее окно запуска и запустите MyCloset заново.');
        else showAddresses();
        openBrowser();
        return;
      }
    } catch { /* A different process owns the port. */ }
    console.error('Port ' + PORT + ' is busy. Close the other application and try again.');
  } else {
    console.error('Cannot start MyCloset: ' + error.message);
  }
  process.exitCode = 1;
});
server.listen(PORT, HOST, () => {
  console.log('MyCloset готов.');
  showAddresses();
  console.log('Оставьте это окно открытым. Для остановки нажмите Ctrl+C.');
  openBrowser();
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
export { server };
