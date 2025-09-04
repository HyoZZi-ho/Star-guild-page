/**
 * 네이버 라운지: 세나 리버스 개발자노트 보드(3)
 * 최신 글 상위 10개를 data/devnotes.json으로 저장
 * - 진단용: 페이지 스크린샷, HTML도 남김(아티팩트 업로드용)
 */
import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';

const BOARD_URL = 'https://game.naver.com/lounge/sena_rebirth/board/3';
const OUT_DIR = 'data';
const OUT_FILE = path.join(OUT_DIR, 'devnotes.json');
const DEBUG_HTML = path.join(OUT_DIR, 'devnotes_debug.html');
const DEBUG_PNG = path.join(OUT_DIR, 'devnotes_debug.png');

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function normalizeDate(s) {
  if (!s) return '';
  const m = s.trim().match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!m) return s.trim();
  const [, y, mo, d] = m;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const distance = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        total += distance;
        if (total >= document.body.scrollHeight * 1.2) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });
}

async function scrape() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36');

  // 이미지/폰트 등은 막아서 속도↑ (필요시 주석 처리)
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (type === 'image' || type === 'font' || type === 'media') req.abort(); else req.continue();
  });

  await page.goto(BOARD_URL, { waitUntil: 'networkidle2', timeout: 120000 });

  // 목록이 JS로 붙는 경우 대비: 대표 셀렉터 기다리고 스크롤도 수행
  const candidates = [
    'a[href*="/lounge/sena_rebirth/board/3/"]',
    'ul li a[class*="title"]',
    'a[class*="post"]'
  ];
  let found = false;
  for (const sel of candidates) {
    try { await page.waitForSelector(sel, { timeout: 15000 }); found = true; break; } catch {}
  }
  await autoScroll(page);
  if (!found) {
    // 스크롤 후 한 번 더 기다림
    for (const sel of candidates) {
      try { await page.waitForSelector(sel, { timeout: 10000 }); found = true; break; } catch {}
    }
  }

  // 진단용 HTML/스크린샷 저장
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(DEBUG_HTML, await page.content(), 'utf8').catch(()=>{});
  await page.screenshot({ path: DEBUG_PNG, fullPage: true }).catch(()=>{});

  const items = await page.evaluate(() => {
    const out = [];
    const sels = [
      'a[href*="/lounge/sena_rebirth/board/3/"]',
      'ul li a[class*="title"]',
      'a[class*="post"]'
    ];
    const seen = new Set();
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach(a => {
        try {
          const href = a.getAttribute('href');
          if (!href) return;
          if (!/\/lounge\/sena_rebirth\/board\/3\/\d+/.test(href)) return;
          const url = new URL(href, location.origin).href;
          if (seen.has(url)) return;
          seen.add(url);

          let title = (a.textContent || '').trim();
          if (!title) {
            const t = a.closest('li,article,div')?.querySelector('strong,.title,.subject,h3');
            if (t) title = (t.textContent || '').trim();
          }
          if (!title) return;

          let date = '';
          const c = a.closest('li,article,div');
          if (c) {
            const d =
              c.querySelector('time')?.textContent?.trim() ||
              c.querySelector('[class*="date"]')?.textContent?.trim() ||
              c.querySelector('[class*="time"]')?.textContent?.trim() ||
              c.querySelector('span[aria-label*="날짜"], span[aria-label*="작성"]')?.textContent?.trim() ||
              '';
            date = d;
          }
          out.push({ title, url, rawDate: date });
        } catch {}
      });
    }
    return out;
  });

  await browser.close();

  const cleaned = items
    .filter(x => x.title && x.url)
    .map(x => ({ title: x.title, url: x.url, date: normalizeDate(x.rawDate) }))
    .filter((x, i, a) => a.findIndex(y => y.url === x.url) === i)
    .slice(0, 10);

  let prev = '[]';
  try { prev = await fs.readFile(OUT_FILE, 'utf8'); } catch {}
  const next = JSON.stringify(cleaned, null, 2);

  if (prev.trim() === next.trim()) {
    console.log(`No changes in devnotes.json (parsed=${cleaned.length})`);
  } else {
    await fs.writeFile(OUT_FILE, next + '\n', 'utf8');
    console.log(`Updated devnotes.json (parsed=${cleaned.length})`);
  }

  // 진단 로그
  console.log('DEBUG files:', { html: DEBUG_HTML, screenshot: DEBUG_PNG });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrape().catch(err => { console.error('[scrape error]', err); process.exit(1); });
}
