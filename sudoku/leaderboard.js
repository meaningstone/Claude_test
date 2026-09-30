// 공용 순위표: Firebase Firestore REST API (SDK 없이 fetch만 사용)
// 접근 권한은 Firestore 보안 규칙(읽기 허용 / 생성만 허용 / 값 검증)이 결정한다.
const Leaderboard = (() => {
  const PROJECT_ID = 'claude-test-4c0a5';
  const API_KEY = 'AIzaSyAKr6ZfVzOx5N3esT5iRwHOIU_oZ2NZod4'; // 웹용 공개 키
  const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const TIMEOUT_MS = 8000;

  async function post(url, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${url}?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const int = (n) => ({ integerValue: String(Math.round(n)) });

  // 기록 1건 저장. 저장된 문서 id를 돌려준다.
  async function submit({ nick, score, time, level, date }) {
    const doc = await post(`${BASE}/leaderboard`, {
      fields: {
        nick: { stringValue: nick },
        score: int(score),
        time: int(time),
        level: int(level),
        date: int(date),
      },
    });
    return doc.name.split('/').pop();
  }

  // level < 0: 전체(점수 상위 100개), 그 외: 해당 난이도 최대 200개 (정렬은 호출한 쪽에서)
  async function fetchTop(level) {
    const query = { from: [{ collectionId: 'leaderboard' }] };
    if (level < 0) {
      query.orderBy = [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }];
      query.limit = 100;
    } else {
      query.where = { fieldFilter: { field: { fieldPath: 'level' }, op: 'EQUAL', value: int(level) } };
      query.limit = 200;
    }
    const rows = await post(`${BASE}:runQuery`, { structuredQuery: query });
    return rows
      .filter((r) => r.document)
      .map(({ document: d }) => ({
        id: d.name.split('/').pop(),
        nick: d.fields.nick.stringValue,
        score: Number(d.fields.score.integerValue),
        time: Number(d.fields.time.integerValue),
        level: Number(d.fields.level.integerValue),
        date: Number(d.fields.date.integerValue),
      }));
  }

  return { submit, fetchTop };
})();
