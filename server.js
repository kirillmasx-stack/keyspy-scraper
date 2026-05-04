const express = require('express');
const { chromium } = require('playwright');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const IPROYAL_USER = process.env.IPROYAL_USER;
const IPROYAL_PASS = process.env.IPROYAL_PASS;
const IPROYAL_HOST = process.env.IPROYAL_HOST || 'geo.iproyal.com';
const IPROYAL_PORT = parseInt(process.env.IPROYAL_PORT || '12321');

const GEO_MAP = {
  2826: { country: 'gb', domain: 'google.co.uk', hl: 'en', gl: 'gb' },
  2840: { country: 'us', domain: 'google.com',    hl: 'en', gl: 'us' },
  2124: { country: 'ca', domain: 'google.ca',     hl: 'en', gl: 'ca' },
  2036: { country: 'au', domain: 'google.com.au', hl: 'en', gl: 'au' },
  2276: { country: 'de', domain: 'google.de',     hl: 'de', gl: 'de' },
  2616: { country: 'pl', domain: 'google.pl',     hl: 'pl', gl: 'pl' },
  2356: { country: 'in', domain: 'google.co.in',  hl: 'en', gl: 'in' },
  2076: { country: 'br', domain: 'google.com.br', hl: 'pt', gl: 'br' },
  2484: { country: 'mx', domain: 'google.com.mx', hl: 'es', gl: 'mx' },
  2784: { country: 'ae', domain: 'google.ae',     hl: 'en', gl: 'ae' },
  2724: { country: 'es', domain: 'google.es',     hl: 'es', gl: 'es' },
  2380: { country: 'it', domain: 'google.it',     hl: 'it', gl: 'it' },
  2250: { country: 'fr', domain: 'google.fr',     hl: 'fr', gl: 'fr' },
  2528: { country: 'nl', domain: 'google.nl',     hl: 'nl', gl: 'nl' },
  2804: { country: 'ua', domain: 'google.com.ua', hl: 'uk', gl: 'ua' },
  2566: { country: 'ng', domain: 'google.com.ng', hl: 'en', gl: 'ng' },
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.post('/api/scrape/google', async (req, res) => {
  const { query, location_code = 2826, pages = 1, mode = 'keyword' } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  if (!IPROYAL_USER) return res.status(503).json({ error: 'IPROYAL_USER not configured' });

  const geo = GEO_MAP[location_code] || GEO_MAP[2826];
  const actualPages = Math.min(parseInt(pages) || 1, 5);
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const sessionId = Math.random().toString(36).slice(2, 10);

  // IPRoyal format: user_country_XX_session_ID_streaming_1
  const proxyUser = `${IPROYAL_USER}_country_${geo.country.toUpperCase()}_session_${sessionId}_streaming_1`;
  console.log(`Scraping: "${query}" geo=${geo.country} pages=${actualPages}`);
  console.log(`Proxy user: ${proxyUser.slice(0, 50)}...`);

  let browser;
  const allAds = [];

  try {
    // Encode credentials in proxy URL to avoid ERR_PROXY_AUTH_UNSUPPORTED
    const proxyUrl = `http://${encodeURIComponent(proxyUser)}:${encodeURIComponent(IPROYAL_PASS)}@${IPROYAL_HOST}:${IPROYAL_PORT}`;

    browser = await chromium.launch({
      headless: true,
      proxy: { server: `http://${IPROYAL_HOST}:${IPROYAL_PORT}` },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--ignore-certificate-errors',
        `--proxy-server=http://${IPROYAL_HOST}:${IPROYAL_PORT}`,
      ],
    });

    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true,
      proxy: {
        server: `http://${IPROYAL_HOST}:${IPROYAL_PORT}`,
        username: proxyUser,
        password: IPROYAL_PASS,
      },
      extraHTTPHeaders: {
        'Accept-Language': `${geo.hl},en;q=0.9`,
      },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    // Handle proxy authentication challenge
    await page.route('**', route => route.continue());
    page.on('request', request => {
      // Log first request for debugging
      if (request.url().includes('google')) {
        console.log('Request headers sent to:', request.url().slice(0, 50));
      }
    });

    for (let p = 0; p < actualPages; p++) {
      const searchQuery = mode === 'domain' ? `site:${query}` : query;
      const url = `https://www.${geo.domain}/search?q=${encodeURIComponent(searchQuery)}&hl=${geo.hl}&gl=${geo.gl}&start=${p * 10}&num=10`;

      console.log(`Page ${p + 1}: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2000 + Math.random() * 1500);
      } catch(e) {
        console.log(`Retry page ${p + 1}...`);
        await sleep(3000);
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await sleep(2000);
        } catch(e2) {
          console.log(`Page ${p + 1} failed: ${e2.message}`);
          continue;
        }
      }

      const pageTitle = await page.title();
      const bodyPreview = await page.evaluate(() => document.body?.innerText?.slice(0, 150)?.replace(/\n/g, ' '));
      console.log(`Page ${p + 1} title: "${pageTitle}" | body: ${bodyPreview}`);

      const ads = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        const containers = [
          ...document.querySelectorAll('[data-text-ad]'),
          ...document.querySelectorAll('#tads .uEierd'),
          ...document.querySelectorAll('#bottomads .uEierd'),
        ];

        containers.forEach((el, idx) => {
          const link = el.querySelector('a[data-rw], a[href]');
          const url = link?.href || '';
          if (!url || url.startsWith('javascript') || seen.has(url)) return;
          seen.add(url);

          const title = el.querySelector('[role="heading"], h3')?.textContent?.trim() || '';
          if (!title) return;

          const desc = el.querySelector('.MUxGbd, .VwiC3b, .yDYNvb')?.textContent?.trim() || '';
          const display = el.querySelector('cite, .qzEoUe')?.textContent?.trim() || '';

          let domain = '';
          try { domain = new URL(url).hostname.replace('www.', ''); } catch(e) {}

          const sitelinks = [];
          el.querySelectorAll('.GzSMEe a, .qPaLIc a').forEach(sl => {
            const t = sl.textContent?.trim();
            if (t) sitelinks.push({ title: t, url: sl.href });
          });

          results.push({ title, description: desc, display_url: display, url, domain, sitelinks, callouts: [] });
        });

        return results;
      });

      console.log(`Page ${p + 1}: ${ads.length} ads`);
      allAds.push(...ads.map((ad, i) => ({
        ...ad,
        position: p * 10 + i + 1,
        page: p + 1,
        source: 'playwright_iproyal',
        format: 'search'
      })));

      if (p < actualPages - 1) await sleep(2000 + Math.random() * 2000);
    }

    await browser.close();

    const seen = new Set();
    const unique = allAds.filter(ad => {
      if (!ad.url || seen.has(ad.url)) return false;
      seen.add(ad.url);
      return true;
    });

    console.log(`Total unique ads: ${unique.length}`);
    res.json({ success: true, data: { query, geo: geo.country, ads: unique, total: unique.length } });

  } catch(err) {
    console.error('Error:', err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// Screenshot endpoint
app.post('/api/screenshot', async (req, res) => {
  const { url, location_code = 2826 } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!IPROYAL_USER) return res.status(503).json({ error: 'IPROYAL_USER not configured' });

  const geo = GEO_MAP[location_code] || GEO_MAP[2826];
  const sessionId = Math.random().toString(36).slice(2, 10);
  const proxyUser = `${IPROYAL_USER}_country_${geo.country.toUpperCase()}_session_${sessionId}_streaming_1`;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    });

    const context = await browser.newContext({
      userAgent: USER_AGENTS[0],
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      proxy: {
        server: `http://${IPROYAL_HOST}:${IPROYAL_PORT}`,
        username: proxyUser,
        password: IPROYAL_PASS,
      },
    });

    const page = await context.newPage();

    // Handle proxy authentication challenge
    await page.route('**', route => route.continue());
    page.on('request', request => {
      // Log first request for debugging
      if (request.url().includes('google')) {
        console.log('Request headers sent to:', request.url().slice(0, 50));
      }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    const screenshot = await page.screenshot({ type: 'png', fullPage: false, clip: { x: 0, y: 0, width: 1280, height: 800 } });
    await browser.close();

    res.json({ success: true, screenshot: screenshot.toString('base64'), url });
  } catch(err) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'KeySpy Scraper (IPRoyal)' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`KeySpy Scraper running on port ${PORT}`));
