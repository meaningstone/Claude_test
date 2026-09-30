# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Minimal C++17 + CMake skeleton: a single executable target (`claude_test`) built from `src/main.cpp`, which only prints `hello, world!`. There are no tests, linter, or formatter configured yet.

`sudoku/` is a separate, dependency-free browser game (open `sudoku/index.html`): `sudoku.js` = engine (solver/generator, no DOM), `app.js` = UI/state/scoring, `style.css` = themes. Nickname and personal best scores live in per-browser `localStorage`. The shared leaderboard is in Firebase Firestore (project `claude-test-4c0a5`, collection `leaderboard`) via REST calls in `leaderboard.js`; access is controlled only by Firestore security rules (public read, create-only with field validation). If the server is unreachable, `app.js` falls back to a local copy of records. Engine can be checked with `node -e "require('./sudoku/sudoku.js')"`.

## Commands

```
cmake -B build                 # configure
cmake --build build            # build
./build/claude_test            # run (Windows/MSVC generator: .\build\Debug\claude_test.exe)
```

`cmake` was not installed on the dev machine (Windows 11) when the project was scaffolded, so the build has not been verified yet.

## Build notes

- `CMakeLists.txt` requires C++17 with `CMAKE_CXX_EXTENSIONS OFF` (strict `-std=c++17`, no GNU extensions).
- New source files must be added explicitly to the `add_executable` call in `CMakeLists.txt` (no globbing).
- `build/` is git-ignored; use it as the out-of-source build directory.

## Working style

- 간단명료하게 답한다.
- 시키지 않은 리팩터링 금지. 요청 범위만 수정한다.
- 토큰을 최소화하되, 아끼려고 불완전하거나 틀린 결과를 내지 않는다.
- 한 번에 끝낼 수 있는 작업을 두 번 하지 않는다.
