// 스도쿠 엔진: 풀이, 퍼즐 생성 (UI 무관)
const Sudoku = (() => {
  const ROW = [], COL = [], BOX = [];
  for (let i = 0; i < 81; i++) {
    ROW[i] = Math.floor(i / 9);
    COL[i] = i % 9;
    BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
  }

  const ALL = 0x3fe; // 비트 1~9
  const CLUES = [40, 34, 30, 26, 22]; // 난이도별 목표 힌트(주어진 숫자) 개수

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function bitCount(m) {
    let n = 0;
    while (m) { m &= m - 1; n++; }
    return n;
  }

  // 백트래킹 풀이. 해를 limit개까지 센다. random이면 숫자 시도 순서를 섞는다.
  function solve(cells, { limit = 2, random = false } = {}) {
    const g = cells.slice();
    const rows = new Array(9).fill(0);
    const cols = new Array(9).fill(0);
    const boxes = new Array(9).fill(0);
    for (let i = 0; i < 81; i++) {
      if (!g[i]) continue;
      const b = 1 << g[i];
      rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
    }

    let count = 0;
    let first = null;
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    (function rec() {
      // 후보가 가장 적은 칸 선택
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
        const n = bitCount(m);
        if (n < bestN) {
          best = i; bestMask = m; bestN = n;
          if (n <= 1) break;
        }
      }
      if (best < 0) {
        count++;
        if (!first) first = g.slice();
        return;
      }
      if (bestN === 0) return;

      const r = ROW[best], c = COL[best], b = BOX[best];
      for (const v of random ? shuffle(digits.slice()) : digits) {
        if (count >= limit) return;
        const bit = 1 << v;
        if (!(bestMask & bit)) continue;
        g[best] = v;
        rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
        rec();
        g[best] = 0;
        rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      }
    })();

    return { count, solution: first };
  }

  // 유일해를 보장하는 퍼즐 생성. level: 0(쉬움) ~ 4(지옥)
  function generate(level) {
    const solution = solve(new Array(81).fill(0), { limit: 1, random: true }).solution;
    const puzzle = solution.slice();
    const target = CLUES[level];
    let clues = 81;
    for (const i of shuffle([...Array(81).keys()])) {
      if (clues <= target) break;
      const v = puzzle[i];
      puzzle[i] = 0;
      if (solve(puzzle).count === 1) clues--;
      else puzzle[i] = v;
    }
    return { puzzle, solution };
  }

  return { ROW, COL, BOX, CLUES, solve, generate };
})();

if (typeof module !== 'undefined') module.exports = Sudoku;
