# 웹/프론트엔드 보안 체크리스트

프론트엔드·웹앱 코드를 작성/리뷰할 때 보는 점검 목록. 프레임워크 무관(React·Vue·Svelte·바닐라 등 공통).
근거: OWASP Top 10 2021. 도구 실행 절차가 아니라 **"무엇을 점검하나"** 리스트다.

> 적용 시점: 인증·세션·사용자입력·외부데이터·렌더링이 얽힌 화면/기능을 만들거나 리뷰할 때.

## XSS (교차 사이트 스크립팅) — A03 Injection
- [ ] 사용자/외부 데이터를 **innerHTML / dangerouslySetInnerHTML / v-html** 등으로 직접 주입하지 않는다. 불가피하면 **DOMPurify** 등으로 sanitize.
- [ ] URL을 `href`/`src`에 넣을 때 `javascript:` 스킴 차단(허용 스킴 화이트리스트).
- [ ] 프레임워크의 기본 escape를 우회하는 코드(`ref`로 DOM 직접 조작, 템플릿 문자열 주입) 점검.
- [ ] 가능하면 **CSP(Content-Security-Policy)** 헤더로 인라인 스크립트/외부 출처 제한.

## 인증·세션·토큰
- [ ] **액세스 토큰을 localStorage에 두지 않는다**(XSS로 탈취). 가능하면 `HttpOnly` + `Secure` + `SameSite` 쿠키.
- [ ] 토큰/세션을 URL 쿼리스트링에 노출하지 않는다(로그·리퍼러 유출).
- [ ] 로그아웃 시 클라이언트 토큰·캐시 완전 제거. 자동 만료/갱신 처리.

## CSRF
- [ ] 상태 변경 요청(POST/PUT/DELETE)은 **CSRF 토큰** 또는 `SameSite=Lax/Strict` 쿠키로 보호.
- [ ] 쿠키 인증을 쓰는 API는 CORS를 `*`로 열지 않는다.

## 클라이언트에 비밀 노출 금지 — A02 Cryptographic Failures
- [ ] **API 키·시크릿·DB 자격증명을 프론트 번들에 넣지 않는다**(빌드 산출물은 누구나 본다). `.env`의 `VITE_`/`NEXT_PUBLIC_` 등 공개 prefix에 비밀 금지.
- [ ] 소스맵·주석·콘솔로그에 내부 엔드포인트/토큰 새지 않는지 확인.

## 클릭재킹·렌더링
- [ ] 민감 화면은 `X-Frame-Options: DENY` 또는 CSP `frame-ancestors`로 iframe 임베드 차단.
- [ ] 외부 링크 `target="_blank"`에는 `rel="noopener noreferrer"`(탭내빙 방지).

## 입력 검증 (클라이언트는 UX용일 뿐)
- [ ] 클라이언트 검증은 편의일 뿐 **신뢰 경계가 아니다** — 진짜 검증은 서버에서(→ `api-security-checklist.md`).
- [ ] 파일 업로드: 확장자/MIME/용량을 클라이언트에서 1차 거르되 **최종 판단은 서버**.

## 의존성·공급망 — A06 / A08
- [ ] `npm audit`/lockfile 점검. 출처 불명 패키지·타이포스쿼팅 의심 패키지 금지.
- [ ] 서드파티 `<script>`(분석·위젯)는 최소화하고 SRI(`integrity`) 적용 고려.

## 빠른 레드플래그 (리뷰에서 보이면 멈춤)
- `dangerouslySetInnerHTML` / `innerHTML =` + 외부 데이터
- localStorage에 토큰 저장
- 번들/`.env` 공개 prefix에 API 시크릿
- CORS `*` + 쿠키 인증
- `eval`, `new Function`, `document.write`에 외부 입력
