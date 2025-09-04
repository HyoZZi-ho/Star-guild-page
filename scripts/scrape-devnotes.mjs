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
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  await page.goto(BOARD_URL, { waitUntil: 'networkidle2', timeout: 120000 });

  // 일부 라운지 페이지는 리스트가 비동기로 추가됨 → 약간 대기
  await page.waitForTimeout(2000);

  // 가능한 여러 셀렉터를 시도 (네이버 라운지 마크업 변경 대비)
  const items = await page.evaluate(() => {
    const out = [];

    // 후보 셀렉터들
    const candidates = [
      // 공통 리스트 카드형
      'a[href*="/lounge/sena_rebirth/board/3/"]',
      // 게시글 타이틀 전용 클래스(변경 가능성 있으니 백업용)
      'a[class*="title"], a[class*="post"], a[class*="BoardList"] a'
    ];

    const seen = new Set();
    for (const sel of candidates) {
      document.querySelectorAll(sel).forEach(a => {
        try {
          const href = a.getAttribute('href');
          if (!href) return;
          // 상세 글 링크만 걸러내기 (board/3/<숫자> 형태 예상)
          if (!/\/lounge\/sena_rebirth\/board\/3\/\d+/.test(href)) return;

          const url = new URL(href, location.origin).href;
          if (seen.has(url)) return;
          seen.add(url);

          let title = (a.textContent || '').trim();
          // 타이틀이 빈 경우, 부모에서 한 번 더 찾아보기
          if (!title) {
            const tEl = a.closest('li,article,div')?.querySelector('strong, .title, .subject, h3');
            if (tEl) title = (tEl.textContent || '').trim();
          }

          // 날짜 후보: 같은 카드 내부에서 date 관련 요소 찾기
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

  // 정제: 타이틀/날짜 다듬고 상위 10개만
  const cleaned = items
    .filter(it => it.title && it.url)
    .map(it => ({ title: it.title, url: it.url, date: normalizeDate(it.rawDate) }))
    // 중복 제거
    .filter((it, idx, arr) => arr.findIndex(x => x.url === it.url) === idx)
    .slice(0, 10);

  // 출력 디렉토리 생성
  await fs.mkdir(OUT_DIR, { recursive: true });

  // 기존 파일과 비교해서 변경 없으면 그대로 종료
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
