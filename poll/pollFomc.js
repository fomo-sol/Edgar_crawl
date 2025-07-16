import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import pool from "../config/db.js";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import { handleFomcFileUpload } from "../s3/load.js";
import { summarizeAndUploadFomcFile } from "../openai/summarize_analyze.js";
// 플러그인 등록
dayjs.extend(utc);
dayjs.extend(timezone);

const TARGET_URL =
  "https://www.federalreserve.gov/monetarypolicy/fomcminutes20250618.htm";
const INTERVAL = 30 * 1000; // 30초마다 요청
const MAX_ATTEMPTS = 40; // 최대 20회 시도

const KST_START_TIME = dayjs.tz("2025-07-10 03:00:10", "Asia/Seoul"); // 시작 시각 (KST)

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

let attempt = 0;

const pollFomcPage = async () => {
  attempt++;
  console.log(
    `[⏱️ ${attempt}/${MAX_ATTEMPTS}] ${new Date().toLocaleString()} - Fetching...`
  );

  try {
    const res = await fetch(TARGET_URL, {
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.log(
        `⚠️ HTTP error: ${res.status} ${res.statusText}, 다시 시도합니다.`
      );
      return; // 다음 인터벌에 재시도
    }

    const html = await res.text();

    if (html.includes("Page Not Found") || html.includes("404")) {
      console.log("⚠️ 페이지가 존재하지 않음, 다시 시도합니다.");
      return;
    }

    if (html.includes("<html")) {
      const conn = await pool.getConnection();
      const id = uuidv4();

      await conn.query(`INSERT INTO fomc_save (id, html_link) VALUES (?, ?)`, [
        id,
        TARGET_URL,
      ]);

      conn.release();

      console.log("✅ HTML 저장 성공, 종료합니다.");

      await handleFomcFileUpload(id, TARGET_URL);

      await summarizeAndUploadFomcFile(id, `fomc_files/${id}.htm`); // pdf 일대는 우짤껴

      process.exit(0);
    } else {
      console.log("⚠️ HTML 정상 로드되지 않음.");
    }
  } catch (err) {
    console.error("❌ 요청 실패:", err.message);
  }

  if (attempt >= MAX_ATTEMPTS) {
    console.error("❌ 최대 시도 횟수 초과. 종료합니다.");
    process.exit(1);
  }
};
// 시작 딜레이 계산
const now = dayjs();
const delayMs = KST_START_TIME.diff(now);

if (delayMs > 0) {
  console.log(
    `⏳ ${now.format("YYYY-MM-DD HH:mm:ss")} → ${KST_START_TIME.format(
      "YYYY-MM-DD HH:mm:ss"
    )} 에 시작합니다 (${Math.round(delayMs / 1000)}초 대기)...`
  );
  setTimeout(() => {
    pollFomcPage(); // 첫 실행
    setInterval(pollFomcPage, INTERVAL); // 반복 실행
  }, delayMs);
} else {
  console.log("⚠️ 이미 지정 시간이 지났습니다. 즉시 실행합니다.");
  pollFomcPage();
  setInterval(pollFomcPage, INTERVAL);
}

// 1초마다 콘솔 찍기 (추가 요청 사항)
setInterval(() => {
  console.log(`⏰ 1초마다 찍힘: ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`);
}, 1000);
