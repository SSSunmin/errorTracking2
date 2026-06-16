# Mini-Sentry 사용 가이드

브라우저 JavaScript 에러를 수집·그룹핑하고, 새 이슈/회귀/임계치 초과 시 **이메일·Slack**으로 알려주는 셀프호스트 에러 모니터링 플랫폼입니다.

이 문서는 **처음부터 끝까지** — 계정 생성 → 프로젝트(DSN) 발급 → SDK 연동 → 에러 확인 → 알림 설정 — 을 따라 할 수 있게 안내합니다.

> 데모/테스트 계정 정보는 [ACCOUNTS.md](./ACCOUNTS.md) 를 참고하세요.

---

## 0. 전체 그림

```text
[브라우저 앱 + SDK] --(에러 전송)--> [Ingest API] --큐(Redis)--> [Worker]
                                                                   │
                                          fingerprint 그룹핑 + 저장 + 알림 평가
                                                                   ▼
                                        [PostgreSQL] ◀── [React 대시보드 / REST API]
                                                                   │
                                                        조건 충족 시 Email / Slack
```

- **SDK**: 앱에 넣는 작은 JS 라이브러리. 잡히지 않은 에러를 자동 수집하고, 수동 캡처 API도 제공.
- **DSN**: SDK가 "어느 프로젝트로 보낼지" 식별하는 접속 문자열. 프로젝트를 만들면 자동 발급.
- **이슈(Issue)**: 같은 원인의 에러를 하나로 묶은 그룹. 발생 횟수·최초/최근 시각을 추적.
- **알림 규칙(AlertRule)**: "새 이슈가 생기면" / "해결된 이슈가 다시 터지면" / "N분 안에 M건 이상이면" 알림.

---

## 1. 서버 띄우기 (운영자/셀프호스트)

> 앱에 SDK만 붙이는 사용자라면 이 단계는 건너뛰고 운영자가 준 **DSN** 과 **대시보드 주소**만 있으면 됩니다.

```bash
npm install
npm run infra:up          # PostgreSQL + Redis (Docker)
npm run db:migrate        # 스키마 적용
npm run db:seed           # 데모 계정/프로젝트 생성 (선택)

npm run dev               # API 서버 + 워커 + 대시보드 동시 실행
```

기본 주소(로컬):

| 구성 | 주소 |
|---|---|
| API 서버 | `http://localhost:4100` |
| 대시보드 | `http://localhost:5174` |

> 포트는 `.env`로 바뀔 수 있습니다(표준 기본값은 API 4000 / 대시보드 5173). 자세한 건 [환경설정](../knowledge/config/environment.md).

---

## 2. 계정 만들기 & 로그인

대시보드(`http://localhost:5174`)에서 **회원가입 → 로그인**하면 됩니다. API로 직접 할 수도 있습니다.

```bash
# 회원가입
curl -X POST http://localhost:4100/api/auth/register \
  -H "content-type: application/json" \
  -d '{ "email": "me@example.com", "password": "supersecret", "name": "Me" }'

# 응답: { "accessToken": "eyJ...", "user": { "id": "...", "email": "..." } }
```

- 응답의 `accessToken`(JWT, 15분)을 이후 API 호출에 `Authorization: Bearer <token>`으로 사용합니다.
- 리프레시 토큰은 httpOnly 쿠키(`mini_sentry_refresh`)로 자동 설정됩니다. 만료 시 `POST /api/auth/refresh`로 갱신.
- 비밀번호는 8자 이상.

> 전체 인증 엔드포인트: [인증 API](../knowledge/api/auth-api.md)

---

## 3. 프로젝트 만들기 → DSN 받기

프로젝트를 만들면 **기본 키 1개 + DSN**이 함께 발급됩니다.

대시보드: **New Project** 버튼 → 이름 입력 → 생성 화면에서 DSN 확인/복사.

API로 할 경우:

```bash
ACCESS_TOKEN="eyJ..."   # 2단계에서 받은 토큰

curl -X POST http://localhost:4100/api/projects \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{ "name": "My Web App" }'

# 응답:
# {
#   "project": { "id": "...", "name": "My Web App", "slug": "my-web-app", ... },
#   "key":     { "id": "...", "publicKey": "...", "isActive": true, ... },
#   "dsn":     "http://<publicKey>@localhost:4100/<projectId>"
# }
```

**`dsn` 값을 복사해 두세요.** SDK 초기화에 그대로 넣습니다.

DSN 형식:

```
<scheme>://<publicKey>@<host>/<projectId>
예) http://abcd1234ef56@localhost:4100/3f9a...
```

> 키 회전(노출 시 교체)·추가 키 발급은 [프로젝트 API](../knowledge/api/projects-api.md) 참고.

---

## 4. SDK 연동

### 4-1. 설치

모노레포 내부에서는 워크스페이스 패키지를 그대로 씁니다:

```jsonc
// package.json
{
  "dependencies": {
    "@mini-sentry/sdk": "workspace:*"
  }
}
```

> 외부 배포 버전이 아니므로, 별도 프로젝트에서는 빌드 산출물(`packages/sdk/dist`)을 참조하거나 사내 레지스트리에 게시해 사용하세요.

### 4-2. 초기화 (앱 진입점, 가능한 한 빨리)

```ts
import * as MiniSentry from "@mini-sentry/sdk";

MiniSentry.init({
  dsn: "http://<publicKey>@localhost:4100/<projectId>", // 3단계의 DSN
  release: "my-web-app@1.0.0",   // 선택: 배포 버전
  environment: "production",      // 선택: production | staging | ...
  // maxBreadcrumbs: 50,          // 선택: 행적 버퍼 크기 (기본 50)
  // autoInstrument: true,        // 선택: 전역 에러 핸들러 + breadcrumb 자동 설치 (기본 true)
});
```

`init` 호출만으로 다음이 자동 활성화됩니다:

- **잡히지 않은 에러** (`window.onerror`) 자동 수집
- **처리되지 않은 Promise 거부** (`unhandledrejection`) 자동 수집
- **Breadcrumb**(에러 직전 행적): 콘솔 로그·클릭·SPA 네비게이션 자동 기록

> DSN 형식이 틀려도 `init`은 **예외를 던지지 않고** `null`을 반환합니다 — SDK 설정 실수가 앱을 멈추지 않습니다.

### 4-3. 수동 캡처

자동 수집 외에 직접 보낼 수 있습니다.

```ts
// 1) try/catch로 잡은 예외 보내기
try {
  riskyOperation();
} catch (err) {
  MiniSentry.captureException(err);
}

// 2) 임의 메시지 보내기 (레벨: debug|info|warning|error|fatal)
MiniSentry.captureMessage("결제 응답이 예상과 다릅니다", "warning");

// 3) 사용자/태그/컨텍스트 부여 — 이후 모든 이벤트에 첨부됨
MiniSentry.setUser({ id: "user_123", email: "me@example.com" });
MiniSentry.setTag("plan", "pro");
MiniSentry.setContext("cart", { items: 3, total: 42000 });

// 4) 직접 breadcrumb 남기기
MiniSentry.addBreadcrumb({
  type: "default",
  category: "checkout",
  message: "사용자가 결제 버튼 클릭",
  level: "info",
});

// 로그아웃 시 사용자 해제
MiniSentry.setUser(null);
```

> SDK는 URL의 쿼리/해시를 제외하고 보내며(토큰·PII 유출 방지), 순환참조도 안전하게 직렬화합니다.

### 4-4. React 예시

```tsx
// main.tsx — 앱 부팅 전에 init
import * as MiniSentry from "@mini-sentry/sdk";

MiniSentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: __APP_VERSION__,
  environment: import.meta.env.MODE,
});

// ErrorBoundary에서 렌더 에러 캡처
import { Component, type ReactNode } from "react";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) {
    MiniSentry.captureException(error); // 렌더 트리 밖 에러도 수집
  }
  render() {
    return this.state.hasError ? <p>문제가 발생했습니다.</p> : this.props.children;
  }
}
```

### 4-5. 동작 확인 (스모크 테스트)

연동이 됐는지 1줄로 확인:

```ts
MiniSentry.captureMessage("mini-sentry 연동 테스트", "info");
```

전송 후 대시보드 이슈 목록에 `mini-sentry 연동 테스트`가 뜨면 성공입니다.
(레포의 `examples/demo-app`을 `npm run dev`로 띄우면 버튼으로 에러를 던져보는 데모도 있습니다.)

---

## 5. 대시보드에서 에러 확인

`http://localhost:5174` 로그인 후:

1. **프로젝트 선택** → 이슈 목록
2. 이슈 클릭 → **상세**: 스택트레이스, breadcrumbs, 태그, 사용자, 발생 추이 차트
3. 상단 필터: 상태(`unresolved`/`resolved`/`ignored`), 제목 검색, 정렬(최근/최초/빈도)
4. 이슈 상태 변경:
   - **Resolve**: 해결 처리. 이후 같은 이슈가 다시 터지면 자동으로 `unresolved`로 되돌아옴(= **회귀/regression**, 알림 대상).
   - **Ignore**: 무시. 다시 터져도 되돌리지 않음.

> 이슈/이벤트/통계 API: [이슈 API](../knowledge/api/issues-api.md)

---

## 6. 알림 설정 (이메일 / Slack)

프로젝트별로 알림 규칙을 만듭니다. **조건 × 채널**의 조합입니다.

### 조건 3가지

| condition | 발화 시점 |
|---|---|
| `new_issue` | 새 이슈가 처음 생길 때 |
| `regression` | 해결(resolved)된 이슈가 다시 터질 때 |
| `event_threshold` | `windowMinutes` 분 안에 이벤트가 `threshold`건 이상일 때 |

### 6-1. 이메일 규칙

```bash
curl -X POST http://localhost:4100/api/projects/<projectId>/alert-rules \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "name": "새 이슈 이메일",
    "channel": "email",
    "target": "alerts@example.com",
    "condition": "new_issue"
  }'
```

> 실제 메일 발송은 서버에 `SMTP_HOST/PORT/USER/PASSWORD`(+`SMTP_FROM`)가 설정돼 있어야 합니다. 미설정 시 개발 모드에서는 발송 대신 페이로드를 로그로만 남깁니다. [환경설정](../knowledge/config/environment.md) 참고.

### 6-2. Slack 규칙

```bash
curl -X POST http://localhost:4100/api/projects/<projectId>/alert-rules \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "name": "급증 알림 Slack",
    "channel": "slack",
    "target": "https://hooks.slack.com/services/T000/B000/XXXX",
    "condition": "event_threshold",
    "threshold": 10,
    "windowMinutes": 5
  }'
```

- Slack `target`은 **`https://hooks.slack.com/`로 시작하는 Incoming Webhook URL만** 허용됩니다(SSRF 방지).
- Webhook URL 발급: Slack 앱 → *Incoming Webhooks* 활성화 → 채널 선택 → URL 복사.
- `event_threshold` 조건은 `threshold`와 `windowMinutes`가 **둘 다 필수**입니다.

### 규칙 관리

- 목록: `GET /api/projects/<projectId>/alert-rules`
- 수정: `PATCH .../alert-rules/<ruleId>` (바꿀 필드만)
- 끄기: `PATCH`로 `{ "isActive": false }`
- 삭제: `DELETE .../alert-rules/<ruleId>`

> 전체 스펙: [알림 규칙 API](../knowledge/api/alerts-api.md)

---

## 7. SDK API 요약

| 함수 | 설명 |
|---|---|
| `init(options)` | SDK 초기화. `Client \| null` 반환(실패해도 throw 안 함) |
| `captureException(error)` | 예외 1건 전송. eventId 반환 |
| `captureMessage(msg, level?)` | 메시지 전송. level 기본 `info` |
| `setUser(user \| null)` | 이후 이벤트에 붙을 사용자 지정/해제 |
| `setTag(key, value)` | 태그 부여 |
| `setContext(key, obj)` | 임의 컨텍스트 부여 |
| `addBreadcrumb(crumb)` | 행적 수동 추가 |
| `getClient()` | 현재 클라이언트 조회 |
| `close()` | 전역 핸들러 해제 + 클라이언트 종료 |

`init` 옵션: `dsn`(필수), `release?`, `environment?`, `maxBreadcrumbs?`(기본 50), `autoInstrument?`(기본 true).

---

## 8. 트러블슈팅

| 증상 | 확인할 것 |
|---|---|
| 이슈가 안 들어옴 | DSN이 정확한지, `init`이 에러 발생 **전에** 호출됐는지, 키가 `isActive=true`인지 |
| `init`이 `null` 반환 | DSN 형식 오류 — `<scheme>://<publicKey>@<host>/<projectId>` 확인 |
| 401 (인제스트) | 키가 비활성/잘못됨. 대시보드에서 키 회전 후 새 DSN 사용 |
| 429 (Too Many Requests) | 인제스트는 IP당 10초 50건 제한. 폭주 시 정상 동작(백오프) |
| 이메일이 안 옴 | SMTP 4종 환경변수 설정 여부. 미설정 시 로그로만 출력 |
| Slack 규칙 생성 실패 | `target`이 `https://hooks.slack.com/`로 시작하는지 |
| 페이로드 누락 | 이벤트 바디 256KiB·중첩 8단계·태그 100개 등 상한 초과 여부 |

---

## 관련 문서

- [ACCOUNTS.md](./ACCOUNTS.md) — 데모/테스트 계정
- [브라우저 SDK](../knowledge/architecture/sdk.md) · [인제스트 파이프라인](../knowledge/architecture/ingestion-pipeline.md)
- [인증 API](../knowledge/api/auth-api.md) · [프로젝트 API](../knowledge/api/projects-api.md) · [이슈 API](../knowledge/api/issues-api.md) · [알림 규칙 API](../knowledge/api/alerts-api.md)
- [전체 지식 베이스](../knowledge/index.md)
