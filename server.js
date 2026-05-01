const express = require('express');
const { chromium } = require('playwright');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// IPRoyal residential proxy
const IPROYAL_USER = process.env.IPROYAL_USER;
const IPROYAL_PASS = process.env.IPROYAL_PASS;
const IPROYAL_HOST = process.env.IPROYAL_HOST || 'geo.iproyal.com';
const IPROYAL_PORT = parseInt(process.env.IPROYAL_PORT || '12321');

const GEO_MAP = {
  2826: { country: 'GB', domain: 'google.co.uk', hl: 'en', gl: 'gb' },
  2840: { country: 'US', domain: 'google.com',    hl: 'en', gl: 'us' },
  2124: { country: 'CA', domain: 'google.ca',     hl: 'en', gl: 'ca' },
  2036: { country: 'AU', domain: 'google.com.au', hl: 'en', gl: 'au' },
  2276: { country: 'DE', domain: 'google.de',     hl: 'de', gl: 'de' },
  2616: { country: 'PL', domain: 'google.pl',     hl: 'pl', gl: 'pl' },
  2356: { country: 'IN', domain: 'google.co.in',  hl: 'en', gl: 'in' },
  2076: { country: 'BR', domain: 'google.com.br', hl: 'pt', gl: 'br' },
  2484: { country: 'MX', domain: 'google.com.mx', hl: 'es', gl: 'mx' },
  2784: { country: 'AE', domain: 'google.ae',     hl: 'en', gl: 'ae' },
  2724: { country: 'ES', domain: 'google.es',     hl: 'es', gl: 'es' },
  2380: { country: 'IT', domain: 'google.it',     hl: 'it', gl: 'it' },
  2250: { country: 'FR', domain: 'google.fr',     hl: 'fr', gl: 'fr' },
  2528: { country: 'NL', domain: 'google.nl',     hl: 'nl', gl: 'nl' },
  2804: { country: 'UA', domain: 'google.com.ua', hl: 'uk', gl: 'ua' },
  2566: { country: 'NG', domain: 'google.com.ng', hl: 'en', gl: 'ng' },
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

  // IPRoyal proxy username format: user_country_XX_session_ID
  const proxyUser = `${IPROYAL_USER}_country_${geo.country}_session_${sessionId}`;
  console.log(`Scraping: "${query}" geo=${geo.country} pages=${actualPages}`);
  console.log(`Proxy: ${proxyUser.slice(0, 40)}...`);

  let browser;
  const allAds = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
      ],
    });

    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true,
      proxy: {
        server: `http://${BRIGHT_HOST}:${BRIGHT_PORT}`,
        username: proxyUser,
        password: BRIGHT_PASS,
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

    for (let p = 0; p < actualPages; p++) {
      const searchQuery = mode === 'domain' ? `site:${query}` : query;
      const url = `https://www.${geo.domain}/search?q=${encodeURIComponent(searchQuery)}&hl=${geo.hl}&gl=${geo.gl}&start=${p * 10}&num=10`;

      console.log(`Page ${p + 1}: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2000 + Math.random() * 1500);
      } catch(e) {
        console.log(`Page ${p + 1} timeout, retrying...`);
        await sleep(3000);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2000);
      }

      // Debug: save HTML snippet to check structure
      const pageTitle = await page.title();
      const pageUrl = await page.url();
      console.log(`Page ${p + 1} title: ${pageTitle} url: ${pageUrl}`);
      
      // Check if Google returned results or blocked
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200));
      console.log(`Page ${p + 1} body preview: ${bodyText?.replace(/\n/g, ' ')}`);

      // Check what ad-related elements exist
      const adElements = await page.evaluate(() => {
        const checks = {
          'data-text-ad': document.querySelectorAll('[data-text-ad]').length,
          'uEierd': document.querySelectorAll('.uEierd').length,
          '#tads': document.querySelectorAll('#tads').length,
          '#bottomads': document.querySelectorAll('#bottomads').length,
          'role=heading': document.querySelectorAll('[role="heading"]').length,
          'aria-label-ad': document.querySelectorAll('[aria-label*="Ad"]').length,
        };
        return checks;
      });
      console.log(`Page ${p + 1} elements:`, JSON.stringify(adElements));

      const ads = await page.evaluate(() => {
        const results = [];

        // Try multiple Google ad selectors
        const selectors = [
          '[data-text-ad]',
          '#tads [data-text-ad]',
          '#bottomads [data-text-ad]',
          '.uEierd',
          '#tads .uEierd',
        ];

        const seen = new Set();
        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            const link = el.querySelector('a[href]');
            if (!link) return;
            const url = link.href;
            if (!url || url.startsWith('javascript') || seen.has(url)) return;
            seen.add(url);

            const title = el.querySelector('[role="heading"], h3')?.textContent?.trim() || '';
            if (!title) return;

            const desc = el.querySelector('.MUxGbd, .VwiC3b, .yDYNvb, [data-sncf]')?.textContent?.trim() || '';
            const display = el.querySelector('cite, .qzEoUe, .UdQCqe')?.textContent?.trim() || '';

            let domain = '';
            try { domain = new URL(url).hostname.replace('www.', ''); } catch(e) {}

            const sitelinks = [];
            el.querySelectorAll('.GzSMEe a, .qPaLIc a').forEach(sl => {
              if (sl.textContent?.trim()) {
                sitelinks.push({ title: sl.textContent.trim(), url: sl.href });
              }
            });

            results.push({ title, description: desc, display_url: display, url, domain, sitelinks, format: 'search' });
          });
        });

        return results;
      });

      console.log(`Page ${p + 1}: ${ads.length} ads found`);
      allAds.push(...ads.map((ad, i) => ({ ...ad, position: p * 10 + i + 1, page: p + 1, source: 'playwright_brightdata' })));

      if (p < actualPages - 1) await sleep(2000 + Math.random() * 2000);
    }

    await browser.close();

    // Deduplicate
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

app.get('/', (req, res) => res.json({ status: 'ok', service: 'KeySpy Scraper (IPRoyal)' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`KeySpy Scraper running on port ${PORT}`));
