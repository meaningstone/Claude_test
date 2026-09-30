(() => {
  'use strict';

  const LEVEL_NAMES = ['쉬움', '보통', '어려움', '전문가', '지옥'];
  const BASE_SCORE = [1000, 2000, 3500, 5500, 8000]; // 난이도별 기본 점수
  const PAR_SECONDS = [300, 480, 720, 1000, 1500];   // 기준 시간(이 시간에 풀면 기본 점수)
  const HINT_FACTOR = 0.85;                          // 힌트 1회당 점수 배율
  const MISTAKE_FACTOR = 0.9;                        // 실수 1회당 점수 배율
  const MAX_MISTAKES = 3;

  const $ = (sel) => document.querySelector(sel);
  const el = {
    board: $('#board'),
    pad: $('#pad'),
    levels: $('#levels'),
    mistakes: $('#mistakes'),
    timer: $('#timer'),
    best: $('#best'),
    msg: $('#msg'),
    theme: $('#themeBtn'),
    newBtn: $('#newBtn'),
    hintBtn: $('#hintBtn'),
    checkBtn: $('#checkBtn'),
    revealBtn: $('#revealBtn'),
    dialog: $('#dialog'),
    dTitle: $('#dTitle'),
    dBody: $('#dBody'),
    dNew: $('#dNew'),
    dClose: $('#dClose'),
  };

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 시 무시 */ }
    },
  };

  let g;                                   // 현재 게임 상태
  let timerId = null;
  let bestRecords = store.get('sudoku-best', {}); // { [level]: { score, time } }

  /* ---------- 테마 ---------- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    el.theme.textContent = theme === 'dark' ? '☀️' : '🌙';
    store.set('sudoku-theme', theme);
  }

  /* ---------- 판 구성 ---------- */
  const cells = [];
  for (let i = 0; i < 81; i++) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'cell';
    if (Sudoku.COL[i] === 2 || Sudoku.COL[i] === 5) c.classList.add('bx');
    if (Sudoku.ROW[i] === 2 || Sudoku.ROW[i] === 5) c.classList.add('by');
    c.setAttribute('aria-label', `${Sudoku.ROW[i] + 1}행 ${Sudoku.COL[i] + 1}열`);
    c.addEventListener('click', () => select(i));
    el.board.appendChild(c);
    cells.push(c);
  }

  /* ---------- 유틸 ---------- */
  const playing = () => g.status === 'playing';
  const locked = (i) => g.given[i] || (g.board[i] !== 0 && g.board[i] === g.solution[i]);
  const isSolved = () => g.board.every((v, i) => v === g.solution[i]);
  const isPeer = (a, b) =>
    Sudoku.ROW[a] === Sudoku.ROW[b] || Sudoku.COL[a] === Sudoku.COL[b] || Sudoku.BOX[a] === Sudoku.BOX[b];

  function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  function calcScore() {
    const l = g.level;
    const speed = (2 * PAR_SECONDS[l]) / (PAR_SECONDS[l] + g.seconds); // 빠를수록 큼 (0초 → 2배, 기준 시간 → 1배)
    return Math.round(BASE_SCORE[l] * speed * HINT_FACTOR ** g.hints * MISTAKE_FACTOR ** g.mistakes);
  }

  function say(text) { el.msg.textContent = text; }

  /* ---------- 렌더링 ---------- */
  function render() {
    const sel = g.sel;
    const selVal = sel >= 0 ? g.board[sel] : 0;

    cells.forEach((c, i) => {
      const v = g.board[i];
      c.textContent = v || '';
      c.classList.toggle('given', g.given[i]);
      c.classList.toggle('wrong', v !== 0 && v !== g.solution[i]);
      c.classList.toggle('hint', g.mark[i] === 1);
      c.classList.toggle('reveal', g.mark[i] === 2);
      c.classList.toggle('selected', i === sel);
      c.classList.toggle('peer', sel >= 0 && i !== sel && isPeer(i, sel));
      c.classList.toggle('same', selVal !== 0 && i !== sel && v === selVal);
    });

    el.mistakes.textContent = `${g.mistakes} / ${MAX_MISTAKES}`;
    el.mistakes.parentElement.classList.toggle('danger', g.mistakes > 0);

    el.pad.querySelectorAll('button[data-n]').forEach((b) => {
      const n = Number(b.dataset.n);
      if (n === 0) return;
      const left = 9 - g.board.filter((v, i) => v === n && v === g.solution[i]).length;
      b.querySelector('small').textContent = left;
      b.disabled = !playing() || left === 0;
    });
    el.pad.querySelector('[data-n="0"]').disabled = !playing();

    el.hintBtn.disabled = !playing();
    el.checkBtn.disabled = !playing();
    el.revealBtn.disabled = !(g.status === 'playing' || g.status === 'lost');

    el.levels.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.level) === g.level);
    });
    const rec = bestRecords[g.level];
    el.best.textContent = rec ? rec.score.toLocaleString() : '-';
    el.timer.textContent = formatTime(g.seconds);
  }

  /* ---------- 타이머 ---------- */
  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      if (document.hidden) return; // 탭이 숨겨진 동안은 멈춤
      g.seconds++;
      el.timer.textContent = formatTime(g.seconds);
    }, 1000);
  }

  /* ---------- 게임 흐름 ---------- */
  function newGame(level) {
    const { puzzle, solution } = Sudoku.generate(level);
    g = {
      level,
      solution,
      board: puzzle.slice(),
      given: puzzle.map((v) => v !== 0),
      mark: new Array(81).fill(0), // 1: 힌트, 2: 정답 보기
      mistakes: 0,
      hints: 0,
      moves: 0,
      seconds: 0,
      sel: -1,
      status: 'playing',
    };
    store.set('sudoku-level', level);
    say('');
    render();
    startTimer();
  }

  function confirmLeave() {
    return g.status !== 'playing' || g.moves === 0 ||
      confirm('진행 중인 게임이 사라져요. 새 게임을 시작할까요?');
  }

  function end(status) {
    g.status = status;
    stopTimer();
    render();

    if (status === 'won') {
      const score = calcScore();
      const prev = bestRecords[g.level];
      const isRecord = !prev || score > prev.score;
      if (isRecord) {
        bestRecords[g.level] = { score, time: g.seconds };
        store.set('sudoku-best', bestRecords);
        render();
      }
      showDialog('🎉 클리어!', [
        ['난이도', LEVEL_NAMES[g.level]],
        ['걸린 시간', formatTime(g.seconds)],
        ['실수', `${g.mistakes}회`],
        ['힌트', `${g.hints}회`],
        ['점수', score.toLocaleString(), 'big'],
      ], isRecord ? '🏆 최고 점수 갱신!' : `최고 점수 ${prev.score.toLocaleString()}점 (${formatTime(prev.time)})`);
    } else {
      showDialog('게임 종료', null, `실수가 ${MAX_MISTAKES}회가 되었어요. 다시 도전해 보세요!`);
    }
  }

  function showDialog(title, rows, footer) {
    el.dTitle.textContent = title;
    el.dBody.textContent = '';
    if (rows) {
      const dl = document.createElement('dl');
      for (const [k, v, cls] of rows) {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = k;
        dd.textContent = v;
        if (cls) dd.className = cls;
        dl.append(dt, dd);
      }
      el.dBody.appendChild(dl);
      const rec = document.createElement('div');
      rec.className = 'record';
      rec.textContent = footer;
      el.dBody.appendChild(rec);
    } else {
      const p = document.createElement('p');
      p.textContent = footer;
      el.dBody.appendChild(p);
    }
    el.dialog.showModal();
  }

  /* ---------- 입력 ---------- */
  function select(i) {
    g.sel = i;
    render();
  }

  function enter(v) {
    const i = g.sel;
    if (!playing() || i < 0 || locked(i) || g.board[i] === v) return;
    g.board[i] = v;
    g.moves++;
    if (v !== g.solution[i]) {
      g.mistakes++;
      say(`틀렸어요! (${g.mistakes}/${MAX_MISTAKES})`);
      if (g.mistakes >= MAX_MISTAKES) return end('lost');
    } else {
      say('');
    }
    render();
    if (isSolved()) end('won');
  }

  function erase() {
    const i = g.sel;
    if (!playing() || i < 0 || locked(i) || g.board[i] === 0) return;
    g.board[i] = 0;
    say('');
    render();
  }

  function hint() {
    if (!playing()) return;
    let i = g.sel;
    if (i < 0 || locked(i)) {
      const open = [];
      for (let k = 0; k < 81; k++) if (!locked(k)) open.push(k);
      if (!open.length) return;
      i = open[Math.floor(Math.random() * open.length)];
    }
    g.board[i] = g.solution[i];
    g.mark[i] = 1;
    g.hints++;
    g.moves++;
    g.sel = i;
    say(`힌트 사용 ${g.hints}회 (점수 ${Math.round((1 - HINT_FACTOR) * 100)}% 감소)`);
    render();
    if (isSolved()) end('won');
  }

  function check() {
    if (!playing()) return;
    let wrong = 0, empty = 0;
    g.board.forEach((v, i) => {
      if (v === 0) empty++;
      else if (v !== g.solution[i]) {
        wrong++;
        cells[i].classList.add('flash');
        setTimeout(() => cells[i].classList.remove('flash'), 600);
      }
    });
    say(wrong ? `오답이 ${wrong}칸 있어요.` : `지금까지 모두 정답이에요! 남은 칸 ${empty}개`);
  }

  function reveal() {
    if (!(playing() || g.status === 'lost')) return;
    if (!confirm('정답을 보면 이번 판은 기록되지 않아요. 계속할까요?')) return;
    g.board.forEach((v, i) => {
      if (v !== g.solution[i]) {
        g.board[i] = g.solution[i];
        g.mark[i] = 2;
      }
    });
    g.status = 'revealed';
    stopTimer();
    say('정답을 공개했어요. 새 게임을 시작해 보세요.');
    render();
  }

  /* ---------- 이벤트 ---------- */
  el.theme.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  el.levels.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (b && confirmLeave()) newGame(Number(b.dataset.level));
  });

  el.pad.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    const n = Number(b.dataset.n);
    if (n === 0) erase(); else enter(n);
  });

  el.newBtn.addEventListener('click', () => { if (confirmLeave()) newGame(g.level); });
  el.hintBtn.addEventListener('click', hint);
  el.checkBtn.addEventListener('click', check);
  el.revealBtn.addEventListener('click', reveal);
  el.dNew.addEventListener('click', () => { el.dialog.close(); newGame(g.level); });
  el.dClose.addEventListener('click', () => el.dialog.close());

  document.addEventListener('keydown', (e) => {
    if (el.dialog.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) return enter(Number(e.key));
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') return erase();

    const move = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    if (g.sel < 0) return select(0);
    const r = Sudoku.ROW[g.sel] + (move === -9 ? -1 : move === 9 ? 1 : 0);
    const c = Sudoku.COL[g.sel] + (move === -1 ? -1 : move === 1 ? 1 : 0);
    if (r >= 0 && r < 9 && c >= 0 && c < 9) select(r * 9 + c);
  });

  /* ---------- 시작 ---------- */
  const savedTheme = store.get('sudoku-theme', null);
  applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  newGame(Math.min(4, Math.max(0, Number(store.get('sudoku-level', 0)) || 0)));
})();
