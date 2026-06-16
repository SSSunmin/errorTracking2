---
description: 프로젝트 지식을 OKF 번들(knowledge/)로 자동 생성·갱신
---

`knowledge-curator` 에이전트에게 OKF 번들 생성/갱신을 위임한다.

대상: $ARGUMENTS (비어 있으면 프로젝트 전체 — 개요·DB·API·설정)

진행:
1. 오늘 날짜를 확인해 에이전트에 전달한다(`timestamp`용).
2. `knowledge-curator`를 호출해 `knowledge/` 번들을 코드 근거로 생성/갱신하게 한다.
   - $ARGUMENTS가 있으면 그 범위만(예: "api", "database", "특정 모듈").
3. 에이전트가 돌려준 변경 파일 목록을 사용자에게 요약 보고한다.

규칙: 추측 금지(코드 근거만), 기존 문서는 갱신, OKF 포맷(프론트매터 `type` 필수 + 절대경로 링크) 준수.
