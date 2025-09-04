/**
 * 스크레이퍼: 네이버 라운지 '세븐나이츠 리버스' 개발자노트 게시판(보드ID=3)
 * - 최신 글 상위 10개를 data/devnotes.json 으로 저장
 * - 형식: [{ title, url, date }]
 */
import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';

const BOARD_URL = 'https://game.naver.com/lounge/sena_rebirth/board/3';
const OUT_DIR = 'data';
const OUT_FILE = path.join(OUT_DIR, 'devnotes.json');

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function normalizeDate(s) {
  if (!s) return '';
  // 예: '2025.09.01' → '2025-09-01'
  const m = s.trim().match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!m) return s.trim();
  const [_, y, mo, d] = m;
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

async function scrape() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  await page.goto(BOARD_URL, { waitUntil: 'networkidle2', timeout: 120000 });

  // 목록이 비동기로 렌더링될 수 있으니, 대표 셀렉터 등장까지 대기 + 소량 슬립
  const selectorCandidates = [
    'a[href*="/lounge/sena_rebirth/board/3/"]',
    'ul li a[class*="title"]',
    'a[class*="post"]',
  ];
  let found = false;
  for (const sel of selectorCandidates) {
    try {
      await page.waitForSelector(sel, { timeout: 4000 });
      found = true;
      break;
    } catch {}
  }
  if (!found) {
    // 그래도 못 찾으면 잠깐 더 대기
    await sleep(2000);
  }

  // 혹시 모를 레이지 로딩 대비 약간 더 대기
  await sleep(1000);

  const items = await page.evaluate(() => {
    const out = [];
    const candidates = [
      'a[href*="/lounge/sena_rebirth/board/3/"]',
      'ul li a[class*="title"]',
      'a[class*="post"]',
    ];

    const seen = new Set();
    for (const sel of candidates) {
      document.querySelectorAll(sel).forEach(a => {
        try {
          const href = a.getAttribute('href');
          if (!href) return;
          // 상세 글 링크만 (board/3/<숫자>)
          if (!/\/lounge\/sena_rebirth\/board\/3\/\d+/.test(href)) return;

          const url = new URL(href, location.origin).href;
          if (seen.has(url)) return;
          seen.add(url);

          let title = (a.textContent || '').trim();
          if (!title) {
            const tEl = a.closest('li,article,div')?.querySelector('strong, .title, .subject, h3');
            if (tEl) title = (tEl.textContent || '').trim();
          }

          let date = '';
          const container = a.closest('li,article,div');
          if (container) {
            const dEl =
              container.querySelector('time') ||
              container.querySelector('[class*="date"]') ||
              container.querySelector('[class*="time"]') ||
              container.querySelector('span[aria-label*="날짜"], span[aria-label*="작성"]');
            if (dEl) date = (dEl.textContent || '').trim();
          }

          out.push({ title, url, rawDate: date });
        } catch {}
      });
    }
    return out;
  });

  await browser.close();

  const cleaned = items
    .filter(it => it.title && it.url)
    .map(it => ({ title: it.title, url: it.url, date: normalizeDate(it.rawDate) }))
    .filter((it, idx, arr) => arr.findIndex(x => x.url === it.url) === idx)
    .slice(0, 10);

  await fs.mkdir(OUT_DIR, { recursive: true });

  let prev = '[]';
  try { prev = await fs.readFile(OUT_FILE, 'utf8'); } catch {}
  const next = JSON.stringify(cleaned, null, 2);

  if (prev.trim() === next.trim()) {
    console.log('No changes in devnotes.json');
    return { changed: false };
  }

  await fs.writeFile(OUT_FILE, next + '\n', 'utf8');
  console.log('Updated devnotes.json');
  return { changed: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrape().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
