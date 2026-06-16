# 작업 규칙

이 파일은 매 세션 자동으로 로드됩니다. **짧게 유지하세요**.

## 행동 원칙

- **위임 우선**: 멀티파일 변경·디버깅·코드리뷰는 서브에이전트(Task)에 위임한다. 한두 줄짜리 사소한 변경은 직접 한다.
- **증거 우선**: "됐다"고 말하기 전에 실제로 실행/테스트해 결과를 확인하고 보여준다. 추측으로 완료를 선언하지 않는다.
- **작성과 리뷰 분리**: 코드를 짠 그 패스에서 스스로 승인하지 않는다. 리뷰는 별도로 한다 (`/review` 또는 `code-reviewer` 에이전트).
- **복잡도에 맞춘 깊이**: 단순 작업은 빠르게 끝내고, 복잡한 추론이 필요한 것만 깊게 판다.
- **불확실하면 표시**: 확신이 없는 부분은 추측이라고 명시한다.

## 쓸 수 있는 도구

**슬래시 커맨드**: `/plan` · `/review` · `/verify` · `/okf` · `/ultraqa`
**서브에이전트(Task로 위임)**: `analyst` · `product-planner` · `impl-planner` · `code-reviewer` · `debugger` · `architect` · `knowledge-curator` · `qa-tester`

## 지식 문서(OKF)

- 프로젝트 지식은 `knowledge/` 폴더에 **OKF(Open Knowledge Format) 번들**로 관리한다(개념별 `.md` + 프론트매터 `type` 필수, 절대경로 링크).
- DB 스키마·API·아키텍처에 **의미 있는 변경**이 생기면 `/okf`(또는 `knowledge-curator` 위임)로 해당 개념 문서를 갱신한다. 추측 금지, 코드 근거로만.
- 문서 갱신 시 `knowledge/index.md`(목차)와 `knowledge/log.md`(이력)도 함께 최신화.

## 프로젝트 메모

- 프로젝트: **Mini-Sentry** — 브라우저 JS 에러 모니터링 플랫폼(Sentry류), 현재 Phase 1.
- 스택: Node20+/TS, Fastify+Prisma+PostgreSQL, Redis, Zod, Vitest. 모노레포(`packages/server|sdk|dashboard`, `examples/demo-app`).
- 실행: `npm install` → `npm run infra:up`(PG+Redis) / 검증: `npm run typecheck` · `npm test` · `npm run lint`.
- 지식 베이스: `knowledge/` (OKF). 개요/DB/API 문서 존재.
