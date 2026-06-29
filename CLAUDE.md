# 작업 규칙

이 파일은 매 세션 자동으로 로드됩니다. **짧게 유지하세요**.

## 행동 원칙

- **위임 우선**: 멀티파일 변경·디버깅·코드리뷰는 서브에이전트(Task)에 위임한다. 한두 줄짜리 사소한 변경은 직접 한다.
- **증거 우선**: "됐다"고 말하기 전에 실제로 실행/테스트해 결과를 확인하고 보여준다. 추측으로 완료를 선언하지 않는다.
- **작성과 리뷰 분리**: 코드를 짠 그 패스에서 스스로 승인하지 않는다. 리뷰는 별도로 한다 (`/review` 또는 `code-reviewer` 에이전트).
- **복잡도에 맞춘 깊이**: 단순 작업은 빠르게 끝내고, 복잡한 추론이 필요한 것만 깊게 판다.
- **불확실하면 표시**: 확신이 없는 부분은 추측이라고 명시한다.
- **보안 점검**: 코드 작성/리뷰 시 변경 성격에 맞는 보안 체크리스트(`docs/skills/security/*.md` — 웹·프론트 / 백엔드·API / AI·MCP)의 "빠른 레드플래그"를 대조한다. 걸리면 critical(보안)으로 매핑 번호(A03·API1·LLM01 등)와 함께 지적하고 해소 전 완료 선언 금지.

## 쓸 수 있는 도구

**슬래시 커맨드**: `/plan` · `/review` · `/test` · `/verify` · `/okf` · `/ultraqa`
**서브에이전트(Task로 위임)**: `analyst` · `product-planner` · `impl-planner` · `code-reviewer` · `test-writer` · `debugger` · `architect` · `knowledge-curator` · `qa-tester`

- **(상시) 로직 변경 시 테스트 제안**: 함수·검증·변환 등 분기 있는 로직을 추가/수정하면 → `/test`(`test-writer`)로 **테스트 작성·실행을 제안**(승인 시 진행, 기존 Vitest 관례 준수). 가짜 커버리지 금지.

## Git / 커밋

- **`Co-Authored-By: Claude` 또는 Claude 관련 서명 절대 추가 금지.** 커밋 메시지는 제목과 본문(선택)만. (전역 `~/.claude/settings.json`의 `attribution`이 자동 trailer를 끔.)
- 작업 완료 후 임의로 커밋하지 않는다 — **사용자가 명시적으로 요청한 경우에만** 커밋한다.

## 지식 문서(OKF)

- 프로젝트 지식은 `knowledge/` 폴더에 **OKF(Open Knowledge Format) 번들**로 관리한다(개념별 `.md` + 프론트매터 `type` 필수, 절대경로 링크).
- DB 스키마·API·아키텍처에 **의미 있는 변경**이 생기면 `/okf`(또는 `knowledge-curator` 위임)로 해당 개념 문서를 갱신한다. 추측 금지, 코드 근거로만.
- 문서 갱신 시 `knowledge/index.md`(목차)와 `knowledge/log.md`(이력)도 함께 최신화.

## 프로젝트 메모

- 프로젝트: **Mini-Sentry** — 브라우저 JS 에러 모니터링 플랫폼(Sentry류), 현재 Phase 1.
- 스택: Node20+/TS, Fastify+Prisma+PostgreSQL, Redis, Zod, Vitest. 모노레포(`packages/server|sdk|dashboard`, `examples/demo-app`).
- 실행: `npm install` → `npm run infra:up`(PG+Redis) / 검증: `npm run typecheck` · `npm test` · `npm run lint`.
- 지식 베이스: `knowledge/` (OKF). 개요/DB/API 문서 존재.
