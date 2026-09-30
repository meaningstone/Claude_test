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
    memoBtn: $('#memoBtn'),
    newBtn: $('#newBtn'),
    hintBtn: $('#hintBtn'),
    checkBtn: $('#checkBtn'),
    revealBtn: $('#revealBtn'),
    dialog: $('#dialog'),
    dTitle: $('#dTitle'),
    dBody: $('#dBody'),
    dNew: $('#dNew'),
    dClose: $('#dClose'),
    nickBtn: $('#nickBtn'),
    nickText: $('#nickText'),
    boardBtn: $('#boardBtn'),
    nickDialog: $('#nickDialog'),
    nickForm: $('#nickForm'),
    nickInput: $('#nickInput'),
    nickCancel: $('#nickCancel'),
    boardDialog: $('#boardDialog'),
    boardTabs: $('#boardTabs'),
    boardList: $('#boardList'),
    boardNote: $('#boardNote'),
    boardClose: $('#boardClose'),
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
  let memo = false;                        // 메모 모드
  let timerId = null;
  let bestRecords = store.get('sudoku-best', {}); // { [level]: { score, time } }
  let nick = store.get('sudoku-nick', '');
  let records = store.get('sudoku-board', []);    // [{ id, nick, score, time, level, date }]
  let boardFilter = -1;                           // 순위표 탭: -1 전체, 0~4 난이도
  let lastRecordId = null;                        // 방금 등록한 기록(강조용)
  let nickRequired = false;                       // 첫 접속 닉네임 입력 중인지
  let startLevel = 0;

  const MAX_PER_LEVEL = 30; // 이 기기에 백업으로 저장하는 난이도별 최대 개수
  const MAX_SHOWN = 50;     // 순위표에 보여줄 최대 개수
  const NICK_MAX = 12;

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

  /* ---------- 닉네임 / 순위표 ---------- */
  const cleanNick = (s) => s.replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);

  function setNick(name) {
    nick = name;
    store.set('sudoku-nick', nick);
    el.nickText.textContent = nick || '닉네임';
  }

  function openNick(required) {
    nickRequired = required;
    el.nickCancel.hidden = required;
    el.nickInput.value = nick;
    el.nickDialog.showModal();
    el.nickInput.select();
  }

  const compareRecords = (a, b) => b.score - a.score || a.time - b.time || a.date - b.date;

  function addRecord(entry) {
    records.push(entry);
    const kept = [];
    for (let l = 0; l < LEVEL_NAMES.length; l++) {
      kept.push(...records.filter((r) => r.level === l).sort(compareRecords).slice(0, MAX_PER_LEVEL));
    }
    records = kept;
    store.set('sudoku-board', records);
    return records.filter((r) => r.level === entry.level).sort(compareRecords).findIndex((r) => r.id === entry.id) + 1;
  }

  const formatDate = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  function showBoardMessage(text) {
    el.boardList.textContent = '';
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    el.boardList.appendChild(p);
  }

  function renderBoard(rows) {
    rows = rows.slice().sort(compareRecords).slice(0, MAX_SHOWN);
    if (!rows.length) return showBoardMessage('아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!');
    el.boardList.textContent = '';

    const table = document.createElement('table');
    table.className = 'lb';
    const head = table.createTHead().insertRow();
    for (const h of ['순위', '닉네임', '점수', '난이도', '시간', '날짜']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    rows.forEach((r, i) => {
      const tr = body.insertRow();
      tr.classList.toggle('me', r.id === lastRecordId);
      const cols = [
        [i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1, ''],
        [r.nick, 'name'],
        [r.score.toLocaleString(), 'score'],
        [LEVEL_NAMES[r.level], ''],
        [formatTime(r.time), ''],
        [formatDate(r.date), ''],
      ];
      for (const [text, cls] of cols) {
        const td = tr.insertCell();
        td.textContent = text;
        if (cls) td.className = cls;
      }
    });
    el.boardList.appendChild(table);
  }

  // 서버(Firestore)에서 순위를 불러온다. 실패하면 이 기기에 저장된 기록을 보여준다.
  let boardSeq = 0;
  async function loadBoard() {
    const seq = ++boardSeq;
    const level = boardFilter;
    el.boardTabs.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.level) === level);
    });
    showBoardMessage('불러오는 중...');
    el.boardNote.textContent = '';

    let rows, offline = false;
    try {
      rows = await Leaderboard.fetchTop(level);
    } catch {
      offline = true;
      rows = records.filter((r) => level < 0 || r.level === level);
    }
    if (seq !== boardSeq) return; // 그 사이 다른 탭을 눌렀다면 무시
    renderBoard(rows);
    el.boardNote.textContent = offline
      ? '서버에 연결하지 못해 이 기기에 저장된 기록만 보여요.'
      : '모든 플레이어의 기록이에요.';
  }

  function openBoard(filter = boardFilter) {
    boardFilter = filter;
    el.boardDialog.showModal();
    loadBoard();
  }

  // 메모 비트마스크(1<<n)를 3x3 작은 숫자로 그린다
  function renderNotes(cell, mask) {
    const box = document.createElement('span');
    box.className = 'notes';
    for (let n = 1; n <= 9; n++) {
      const s = document.createElement('span');
      s.textContent = mask & (1 << n) ? n : '';
      box.appendChild(s);
    }
    cell.textContent = '';
    cell.appendChild(box);
  }

  // 숫자를 확정하면 같은 행/열/박스 칸의 해당 메모를 지운다
  function clearPeerNotes(i, v) {
    for (let k = 0; k < 81; k++) {
      if (k !== i && isPeer(k, i)) g.notes[k] &= ~(1 << v);
    }
  }

  /* ---------- 렌더링 ---------- */
  function render() {
    const sel = g.sel;
    const selVal = sel >= 0 ? g.board[sel] : 0;

    cells.forEach((c, i) => {
      const v = g.board[i];
      if (v) c.textContent = v;
      else if (g.notes[i]) renderNotes(c, g.notes[i]);
      else c.textContent = '';
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

    el.memoBtn.classList.toggle('active', memo);
    el.memoBtn.setAttribute('aria-pressed', memo);
    el.memoBtn.textContent = memo ? '✏️ 메모 ON' : '✏️ 메모 OFF';
    el.memoBtn.disabled = !playing();
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
      notes: new Array(81).fill(0), // 칸별 메모 비트마스크
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
      showDialog('🎉 축하합니다!', [
        ['난이도', LEVEL_NAMES[g.level]],
        ['걸린 시간', formatTime(g.seconds)],
        ['실수', `${g.mistakes}회`],
        ['힌트', `${g.hints}회`],
        ['점수', score.toLocaleString(), 'big'],
      ], isRecord ? '🏆 최고 점수 갱신!' : `최고 점수 ${prev.score.toLocaleString()}점 (${formatTime(prev.time)})`,
      buildRegisterForm({ score, time: g.seconds, level: g.level }));
      confetti();
    } else {
      showDialog('게임 종료', null, `실수가 ${MAX_MISTAKES}회가 되었어요. 다시 도전해 보세요!`);
    }
  }

  // 클리어 화면의 닉네임 입력 + 순위표 등록
  function buildRegisterForm({ score, time, level }) {
    const box = document.createElement('div');
    box.className = 'register';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = NICK_MAX;
    input.placeholder = '닉네임';
    input.value = nick;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '순위표에 등록';
    btn.addEventListener('click', async () => {
      const name = cleanNick(input.value);
      if (!name) return input.focus();
      setNick(name);
      btn.disabled = true;
      input.disabled = true;
      btn.textContent = '등록 중...';

      const entry = { nick: name, score, time, level, date: Date.now() };
      let id, rank = 0, saved = true;
      try {
        id = await Leaderboard.submit(entry);
        try { // 등록한 난이도 안에서의 순위
          const rows = (await Leaderboard.fetchTop(level)).sort(compareRecords);
          rank = rows.findIndex((r) => r.id === id) + 1;
        } catch { /* 순위 계산 실패는 무시 */ }
      } catch {
        saved = false;
        id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        rank = 0;
      }
      const localRank = addRecord({ id, ...entry }); // 이 기기에도 백업 저장
      lastRecordId = id;

      const done = document.createElement('p');
      done.className = 'done';
      if (!saved) done.textContent = `서버에 연결하지 못해 이 기기에만 저장했어요. (${LEVEL_NAMES[level]} ${localRank}위)`;
      else done.textContent = rank ? `등록 완료! ${LEVEL_NAMES[level]} ${rank}위` : '등록 완료!';
      const view = document.createElement('button');
      view.type = 'button';
      view.textContent = '순위표 보기';
      view.addEventListener('click', () => { el.dialog.close(); openBoard(level); });
      box.replaceChildren(done, view);
    });

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    box.append(input, btn);
    return box;
  }

  function confetti() {
    const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa'];
    const wrap = document.createElement('div');
    wrap.className = 'confetti';
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('i');
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.8}s`;
      piece.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
      wrap.appendChild(piece);
    }
    el.dialog.appendChild(wrap);
  }

  function showDialog(title, rows, footer, extra) {
    el.dialog.querySelector('.confetti')?.remove();
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
    if (extra) el.dBody.appendChild(extra);
    el.dialog.showModal();
  }

  /* ---------- 입력 ---------- */
  function select(i) {
    g.sel = i;
    render();
  }

  function enter(v) {
    const i = g.sel;
    if (!playing() || i < 0 || locked(i)) return;
    if (memo) { // 메모는 판정 없이 표시만 토글 (실수로 세지 않음)
      if (g.board[i] !== 0) return;
      g.notes[i] ^= 1 << v;
      return render();
    }
    if (g.board[i] === v) return;
    g.board[i] = v;
    g.notes[i] = 0;
    g.moves++;
    if (v !== g.solution[i]) {
      g.mistakes++;
      say(`틀렸어요! (${g.mistakes}/${MAX_MISTAKES})`);
      if (g.mistakes >= MAX_MISTAKES) return end('lost');
    } else {
      clearPeerNotes(i, v);
      say('');
    }
    render();
    if (isSolved()) end('won');
  }

  function erase() {
    const i = g.sel;
    if (!playing() || i < 0 || locked(i)) return;
    if (g.board[i] !== 0) g.board[i] = 0;
    else if (g.notes[i]) g.notes[i] = 0;
    else return;
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
    g.notes[i] = 0;
    clearPeerNotes(i, g.solution[i]);
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

  const toggleMemo = () => { memo = !memo; render(); };
  el.memoBtn.addEventListener('click', toggleMemo);

  el.newBtn.addEventListener('click', () => { if (confirmLeave()) newGame(g.level); });
  el.hintBtn.addEventListener('click', hint);
  el.checkBtn.addEventListener('click', check);
  el.revealBtn.addEventListener('click', reveal);
  el.dNew.addEventListener('click', () => { el.dialog.close(); newGame(g.level); });
  el.dClose.addEventListener('click', () => el.dialog.close());

  el.nickBtn.addEventListener('click', () => openNick(false));
  el.boardBtn.addEventListener('click', () => openBoard());
  el.boardClose.addEventListener('click', () => el.boardDialog.close());
  el.boardTabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (b) { boardFilter = Number(b.dataset.level); loadBoard(); }
  });
  el.nickCancel.addEventListener('click', () => el.nickDialog.close());
  el.nickDialog.addEventListener('cancel', (e) => { if (nickRequired) e.preventDefault(); }); // 첫 입력은 Esc로 닫기 불가
  el.nickForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanNick(el.nickInput.value);
    if (!name) return;
    setNick(name);
    el.nickDialog.close();
    if (nickRequired) {
      nickRequired = false;
      newGame(startLevel);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyN' && playing()) return toggleMemo();
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
  startLevel = Math.min(4, Math.max(0, Number(store.get('sudoku-level', 0)) || 0));
  setNick(nick);
  if (nick) newGame(startLevel);
  else openNick(true); // 첫 접속: 닉네임을 입력한 뒤 게임 시작
})();
