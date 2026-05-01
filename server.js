const express = require('express');
const { chromium } = require('playwright');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8081;

// Oxylabs residential proxy config
const OXYLABS_USER = process.env.OXYLABS_USER;
const OXYLABS_PASS = process.env.OXYLABS_PASS;
const PROXY_HOST = 'pr.oxylabs.io';
const PROXY_PORT = 7777;

// GEO to Google domain mapping
const GEO_CONFIG = {
  2826: { domain: 'google.co.uk', hl: 'en', gl: 'gb', country: 'GB' },
  2840: { domain: 'google.com',    hl: 'en', gl: 'us', country: 'US' },
  2124: { domain: 'google.ca',     hl: 'en', gl: 'ca', country: 'CA' },
  2036: { domain: 'google.com.au', hl: 'en', gl: 'au', country: 'AU' },
  2276: { domain: 'google.de',     hl: 'de', gl: 'de', country: 'DE' },
  2616: { domain: 'google.pl',     hl: 'pl', gl: 'pl', country: 'PL' },
  2356: { domain: 'google.co.in',  hl: 'en', gl: 'in', country: 'IN' },
  2076: { domain: 'google.com.br', hl: 'pt', gl: 'br', country: 'BR' },
  2484: { domain: 'google.com.mx', hl: 'es', gl: 'mx', country: 'MX' },
  2784: { domain: 'google.ae',     hl: 'en', gl: 'ae', country: 'AE' },
  2566: { domain: 'google.com.ng', hl: 'en', gl: 'ng', country: 'NG' },
  2710: { domain: 'google.co.za',  hl: 'en', gl: 'za', country: 'ZA' },
};

// Random user agents
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── GOOGLE ADS SCRAPER ────────────────────────────────────────────────────────
app.post('/api/scrape/google', async (req, res) => {
  const {
    query, location_code = 2826, mode = 'keyword', pages = 1
  } = req.body;

  if (!query) return res.status(400).json({ error: 'query is required' });

  const geo = GEO_CONFIG[location_code] || GEO_CONFIG[2826];
  const ua = randomUA();

  console.log(`Scraping Google: "${query}" geo=${geo.country} pages=${pages}`);

  const proxyConfig = OXYLABS_USER ? {
    server: `http://${PROXY_HOST}:${PROXY_PORT}`,
    username: `${OXYLABS_USER}-cc-${geo.country}`,
    password: OXYLABS_PASS,
  } : undefined;

  let browser;
  const allAds = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1366 + Math.floor(Math.random()*200), height: 768 + Math.floor(Math.random()*100) },
      locale: geo.hl === 'en' ? 'en-US' : geo.hl,
      timezoneId: 'Europe/London',
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
      extraHTTPHeaders: {
        'Accept-Language': `${geo.hl}-${geo.country},${geo.hl};q=0.9,en;q=0.8`,
      },
    });

    // Anti-detection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    for (let pageNum = 0; pageNum < pages; pageNum++) {
      const start = pageNum * 10;
      let url;

      if (mode === 'domain') {
        url = `https://www.${geo.domain}/search?q=site:${encodeURIComponent(query)}&hl=${geo.hl}&gl=${geo.gl}&start=${start}`;
      } else {
        url = `https://www.${geo.domain}/search?q=${encodeURIComponent(query)}&hl=${geo.hl}&gl=${geo.gl}&start=${start}`;
      }

      console.log(`Loading: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Random delay to simulate human behavior
      await sleep(1500 + Math.random() * 2000);

      // Wait for ads to load
      await page.waitForSelector('body', { timeout: 10000 }).catch(() => {});

      // Extract paid ads
      const ads = await page.evaluate(() => {
        const results = [];

        // Google Ads selectors (multiple formats)
        const adContainers = document.querySelectorAll(
          '[data-text-ad], .uEierd, .commercial-unit-desktop-top, .commercial-unit-desktop-rhs, [aria-label="Ads"] > div, .pla-unit, #tads .uEierd, #tads [data-text-ad], #bottomads [data-text-ad]'
        );

        adContainers.forEach((container, idx) => {
          // Skip if already processed parent
          const adLink = container.querySelector('a[href]') || container.closest('a[href]');
          const url = adLink?.href || '';
          if (!url || url.startsWith('javascript')) return;

          // Title
          const titleEl = container.querySelector('[role="heading"], h3, .CCgQ5, .vvjwJb');
          const title = titleEl?.textContent?.trim() || '';
          if (!title) return;

          // Description
          const descEl = container.querySelector('.MUxGbd, .yDYNvb, .VwiC3b, .lyLwlc, [data-sncf="1"]');
          const description = descEl?.textContent?.trim() || '';

          // Display URL
          const displayEl = container.querySelector('.qzEoUe, .UdQCqe, cite, .oBu5B');
          const displayUrl = displayEl?.textContent?.trim() || '';

          // Domain
          let domain = '';
          try { domain = new URL(url).hostname.replace('www.', ''); } catch(e) {}

          // Sitelinks
          const sitelinks = [];
          container.querySelectorAll('.GzSMEe a, .qPaLIc a, .fl a').forEach(sl => {
            const slTitle = sl.textContent?.trim();
            if (slTitle && slTitle.length > 0) {
              sitelinks.push({ title: slTitle, url: sl.href });
            }
          });

          // Callouts / extensions
          const callouts = [];
          container.querySelectorAll('.MUxGbd.wuuuid, .oST1qe').forEach(c => {
            const text = c.textContent?.trim();
            if (text) callouts.push(text);
          });

          results.push({
            position: idx + 1,
            title,
            description,
            display_url: displayUrl,
            url,
            domain,
            sitelinks,
            callouts,
            format: 'search',
          });
        });

        return results;
      });

      console.log(`Page ${pageNum + 1}: found ${ads.length} ads`);
      allAds.push(...ads);

      if (pageNum < pages - 1) {
        await sleep(2000 + Math.random() * 3000);
      }
    }

    await browser.close();

    // Deduplicate by URL
    const seen = new Set();
    const unique = allAds.filter(ad => {
      if (seen.has(ad.url)) return false;
      seen.add(ad.url);
      return true;
    });

    console.log(`Total unique ads: ${unique.length}`);
    res.json({ success: true, data: { query, geo: geo.country, ads: unique, total: unique.length } });

  } catch (err) {
    console.error('Scraper error:', err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'KeySpy Scraper' }));

app.listen(PORT, () => console.log(`KeySpy Scraper running on port ${PORT}`));
