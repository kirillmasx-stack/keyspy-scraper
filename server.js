const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;
const GOOGLE_COOKIES = process.env.GOOGLE_COOKIES || '';

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
  2710: { country: 'za', domain: 'google.co.za',  hl: 'en', gl: 'za' },
};

function parseGoogleAds(html) {
  const $ = cheerio.load(html);
  const ads = [];
  const seen = new Set();

  // Process each ad block inside #tads and #bottomads
  $('#tads, #bottomads').find('[data-text-ad], .uEierd').each((idx, el) => {
    const $el = $(el);

    // Find clickable ad URL — prefer data-rw (tracking) or first external href
    let url = '';
    $el.find('a').each((i, a) => {
      const href = $(a).attr('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      if (href.includes('google.com/aclk') || href.includes('/aclk?')) {
        // This is the tracking URL — extract destination from data-adurl or just use it
        url = href;
        return false;
      }
      if (href.startsWith('http') && !href.includes('google.')) {
        url = href;
        return false;
      }
    });

    if (!url) return;
    if (seen.has(url)) return;
    seen.add(url);

    // Title — inside heading or h3
    const title = $el.find('[role="heading"]').first().text().trim() ||
                  $el.find('h3').first().text().trim();
    if (!title) return;

    // Description — various Google classes
    const desc = $el.find('.MUxGbd').not('.qzEoUe').first().text().trim() ||
                 $el.find('[data-sncf="1"]').first().text().trim() ||
                 $el.find('.VwiC3b').first().text().trim() ||
                 $el.find('.yDYNvb').first().text().trim();

    // Display URL (cite or breadcrumb)
    const display = $el.find('cite').first().text().trim() ||
                    $el.find('.qzEoUe').first().text().trim() ||
                    $el.find('.UdQCqe').first().text().trim();

    // Domain from display URL or actual URL
    let domain = '';
    const displayClean = display.replace(/\s+/g, '').split('›')[0].split('>')[0].trim();
    if (displayClean && !displayClean.includes(' ')) {
      domain = displayClean.replace(/^https?:\/\//, '').replace(/\/.*/, '').replace('www.', '');
    }
    if (!domain) {
      try { domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace('www.', ''); } catch(e) {}
    }

    // Sitelinks
    const sitelinks = [];
    $el.find('.GzSMEe a, .qPaLIc a, .OkkX2d a').each((i, sl) => {
      const t = $(sl).text().trim();
      const href = $(sl).attr('href') || '';
      if (t && t.length > 1) sitelinks.push({ title: t, url: href });
    });

    ads.push({
      position: ads.length + 1,
      title,
      description: desc,
      display_url: display || domain,
      url,
      domain,
      sitelinks,
      callouts: [],
      format: 'search',
      source: 'scraperapi',
    });
  });

  return ads;
}

app.post('/api/scrape/google', async (req, res) => {
  const { query, location_code = 2826, pages = 1, mode = 'keyword' } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  if (!SCRAPERAPI_KEY) return res.status(503).json({ error: 'SCRAPERAPI_KEY not configured' });

  const geo = GEO_MAP[location_code] || GEO_MAP[2826];
  const actualPages = Math.min(parseInt(pages) || 1, 5);
  const searchQuery = mode === 'domain' ? `site:${query}` : query;
  const allAds = [];

  console.log(`Scraping: "${searchQuery}" geo=${geo.country} pages=${actualPages}`);

  for (let page = 0; page < actualPages; page++) {
    const targetUrl = `https://www.${geo.domain}/search?q=${encodeURIComponent(searchQuery)}&hl=${geo.hl}&gl=${geo.gl}&start=${page * 10}&num=10&pws=0`;

    const params = {
      api_key: SCRAPERAPI_KEY,
      url: targetUrl,
      country_code: geo.country,
      device_type: 'desktop',
      render: 'false', // faster, JS not needed for basic ads
      keep_headers: 'true',
    };

    // Add cookies if available
    const headers = {
      'Accept-Language': `${geo.hl},en;q=0.9`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (GOOGLE_COOKIES) {
      headers['Cookie'] = GOOGLE_COOKIES;
      console.log('Using cookies');
    }

    try {
      console.log(`Page ${page + 1}: ${targetUrl}`);
      const response = await axios.get('https://api.scraperapi.com/', {
        params,
        headers,
        timeout: 60000,
      });

      const html = response.data;
      const ads = parseGoogleAds(html);
      console.log(`Page ${page + 1}: ${ads.length} ads found`);

      // Debug first page
      if (page === 0) {
        console.log(`HTML size: ${html.length}`);
        // Find first data-text-ad block and log it
        const $ = require('cheerio').load(html);
        const firstAd = $('#tads [data-text-ad]').first();
        if (firstAd.length) {
          console.log('First ad HTML:', firstAd.html()?.slice(0, 800));
        } else {
          console.log('No [data-text-ad] in #tads found');
          // Try uEierd
          const firstUE = $('#tads .uEierd').first();
          if (firstUE.length) console.log('First uEierd HTML:', firstUE.html()?.slice(0, 800));
        }
      }

      allAds.push(...ads);
    } catch(err) {
      console.error(`Page ${page + 1} error:`, err.response?.status, err.message);
    }

    if (page < actualPages - 1) await new Promise(r => setTimeout(r, 1000));
  }

  // Deduplicate
  const seen = new Set();
  const unique = allAds.filter(ad => {
    if (!ad.url || seen.has(ad.url)) return false;
    seen.add(ad.url);
    return true;
  });

  console.log(`Total unique ads: ${unique.length}`);
  res.json({ success: true, data: { query: searchQuery, geo: geo.country, ads: unique, total: unique.length } });
});

// Screenshot via ScraperAPI
app.post('/api/screenshot', async (req, res) => {
  const { url, location_code = 2826 } = req.body;
  if (!url || !SCRAPERAPI_KEY) return res.status(400).json({ error: 'url and SCRAPERAPI_KEY required' });

  const geo = GEO_MAP[location_code] || GEO_MAP[2826];
  try {
    const response = await axios.get('https://api.scraperapi.com/screenshot', {
      params: { api_key: SCRAPERAPI_KEY, url, country_code: geo.country, full_page: 'false' },
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    const base64 = Buffer.from(response.data).toString('base64');
    res.json({ success: true, screenshot: base64, url });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'KeySpy Scraper (ScraperAPI)' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`KeySpy Scraper running on port ${PORT}`));
