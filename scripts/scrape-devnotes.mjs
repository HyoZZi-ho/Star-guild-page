/**
 * 네이버 라운지: 세나 리버스 개발자노트 보드(3)에서
 * 최신 글 상위 10개를 data/devnotes.json으로 저장
 * 형식: [{ title, url, date }]
 */
import fs from 'fs/promises';
import path from 'path';
import cheerio from 'cheerio';

const BOARD_URL = 'https://game.naver.com/lounge/sena_rebirth/board/3';
const OUT_DIR = 'data';
const OUT_FILE = path.join(OUT_DIR, 'devnotes.json');

function normalizeDate(s) {
  if (!s) return '';
  const m = s.trim().match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!m) return s.trim();
  const [, y, mo, d] = m;
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept-Language': 'ko,en;q=0.9'
    }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

async function scrape() {
  // 1) HTML 가져오기
  const html = await fetchHtml(BOARD_URL);

  // 2) 파싱
  const $ = cheerio.load(html);
  const items = [];

  // 링크 패턴: /lounge/sena_rebirth/board/3/<글번호>
  $('a[href*="/lounge/sena_rebirth/board/3/"]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    const m = href.match(/\/lounge\/sena_rebirth\/board\/3\/(\d+)/);
    if (!m) return;

    // 절대 URL
    const url = new URL(href, 'https://game.naver.com').href;

    // 제목
    let title = $(a).text().trim();
    if (!title) {
      const tEl = $(a).closest('li,article,div').find('strong, .title, .subject, h3').first();
      if (tEl.length) title = tEl.text().trim();
    }
    if (!title) return;

    // 날짜 후보(같은 카드/행 안)
    let date = '';
    const container = $(a).closest('li,article,div');
    if (container.length) {
      const dEl =
        container.find('time').first().text().trim() ||
        container.find('[class*="date"]').first().text().trim() ||
        container.find('[class*="time"]').first().text().trim() ||
        container
          .find('span[aria-label*="날짜"], span[aria-label*="작성"]')
          .first()
          .text()
          .trim();
      date = dEl || '';
    }

    items.push({ title, url, rawDate: date });
  });

  // 3) 정제 & 상위 10개
  const cleaned = items
    .filter(it => it.title && it.url)
    .map(it => ({ title: it.title, url: it.url, date: normalizeDate(it.rawDate) }))
    .filter((it, idx, arr) => arr.findIndex(x => x.url === it.url) === idx)
    .slice(0, 10);

  // 4) 파일 저장(변경 시에만)
  await fs.mkdir(OUT_DIR, { recursive: true });
  let prev = '[]';
  try { prev = await fs.readFile(OUT_FILE, 'utf8'); } catch {}
  const next = JSON.stringify(cleaned, null, 2);

  if (prev.trim() === next.trim()) {
    console.log('No changes in devnotes.json');
    return;
  }
  await fs.writeFile(OUT_FILE, next + '\n', 'utf8');
  console.log('Updated devnotes.json');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrape().catch(err => {
    console.error('[scrape error]', err.message);
    process.exit(1);
  });
}
