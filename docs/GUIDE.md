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

> 외부 배포 버전이 아니므로, 별도 프로젝트에서는 tarball을 설치하거나 사내 레지스트리에 게시해 사용하세요.

### 4-1-1. tarball로 설치해서 React/번들러 프로젝트에서 import하기

npm 레지스트리에 publish하지 않고도 `npm pack`으로 만든 tarball을 다른 프로젝트에 설치해 ESM import로 사용할 수 있습니다. SDK 패키지는 `prepack`에서 빌드를 실행하므로, pack 명령만으로 최신 `dist`가 포함된 tarball이 생성됩니다.

```bash
# 명시적으로 빌드만 실행
npm run -w @mini-sentry/sdk build

# 또는 빌드 후 tarball 생성
npm pack -w @mini-sentry/sdk
```

생성된 `mini-sentry-sdk-0.1.0.tgz`를 사용할 프로젝트로 옮긴 뒤 설치합니다.

```bash
npm i ./mini-sentry-sdk-0.1.0.tgz
```

ESM/TypeScript 번들러 프로젝트에서는 패키지 import를 그대로 사용합니다.

```ts
import * as MiniSentry from "@mini-sentry/sdk";

MiniSentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: "web@1.0.0",
  environment: import.meta.env.MODE,
});
```

React 렌더링 에러는 `ErrorBoundary`에서 수동으로 캡처할 수 있습니다.
완성형 React 구성 예시는 [4-5. React 프로젝트에 추가하기](#4-5-react-프로젝트에-추가하기)에서 이어서 설명합니다.

tarball import 방식은 타입 선언이 함께 설치되어 React/번들러 프로젝트에서 타입 지원을 받을 수 있고, script 태그 방식은 빌드 설정 없이 HTML에 바로 붙이는 드롭인 방식입니다.

### 4-2. 초기화 (앱 진입점, 가능한 한 빨리)

```ts
import * as MiniSentry from "@mini-sentry/sdk";

MiniSentry.init({
  dsn: "http://<publicKey>@localhost:4100/<projectId>", // 3단계의 DSN
  release: "my-web-app@1.0.0",   // 선택: 배포 버전
  environment: "production",      // 선택: production | staging | ...
  // maxBreadcrumbs: 50,          // 선택: 행적 버퍼 크기 (기본 50)
  // autoInstrument: true,        // 선택: 전역 에러 핸들러 + breadcrumb 자동 설치 (기본 true)
  // captureConsole: false,       // 선택: console.* breadcrumb 수집 여부 (기본 false)
});
```

`init` 호출만으로 다음이 자동 활성화됩니다:

- **잡히지 않은 에러** (`window.onerror`) 자동 수집
- **처리되지 않은 Promise 거부** (`unhandledrejection`) 자동 수집
- **Breadcrumb**(에러 직전 행적): 클릭·SPA 네비게이션 자동 기록
- `console.log/info/warn/error`는 기본 수집하지 않습니다. 필요할 때만 `captureConsole: true`를 켭니다.

> DSN 형식이 틀려도 `init`은 **예외를 던지지 않고** `null`을 반환합니다 — SDK 설정 실수가 앱을 멈추지 않습니다.

### 4-3. script 태그로 붙이기

번들러 없이 HTML에 한 줄만 추가해도 자동 초기화와 전역 에러 수집이 동작합니다.

```html
<script src="https://<host>/sdk/mini-sentry.min.js"
        data-key="<publicKey>" data-project="<projectId>"></script>
```

- `data-key`와 `data-project`를 쓰면 SDK가 script 자신의 `src` origin을 보고 DSN을 조립합니다. 예를 들어 `src`가 `https://errors.example.com/sdk/mini-sentry.min.js`이면 `https://<publicKey>@errors.example.com/<projectId>` 형태로 초기화합니다.
- 터널이나 임시 호스트를 다시 열었을 때는 `src`의 host만 바꾸면 됩니다. `data-key`와 `data-project`는 그대로 둘 수 있습니다.
- 이미 전체 DSN을 알고 있으면 `data-dsn`을 사용할 수 있습니다. `data-dsn`이 있으면 `data-key`/`data-project`보다 우선합니다.
- `data-auto-instrument="false"`를 지정하면 `window.onerror`와 `unhandledrejection` 자동 캡처를 끕니다. 지정하지 않으면 기본값은 켜짐입니다.
- `data-capture-console="true"`를 지정하면 `console.log/info/warn/error` 호출도 breadcrumb로 남깁니다. 지정하지 않으면 기본값은 꺼짐입니다.
- `data-environment`, `data-release`를 함께 넣으면 이후 이벤트에 포함됩니다.

전체 DSN을 직접 넣는 예:

```html
<script src="https://<host>/sdk/mini-sentry.min.js"
        data-dsn="https://<publicKey>@<host>/<projectId>"
        data-environment="production"
        data-release="web@1.0.0"></script>
```

자동 초기화 후에는 전역 객체로 수동 캡처도 할 수 있습니다.

```html
<script>
  try {
    riskyOperation();
  } catch (error) {
    window.MiniSentry.captureException(error);
  }
</script>
```

### 4-4. 수동 캡처

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

### 4-5. React 프로젝트에 추가하기

이 절은 샘플 쇼핑몰에서 실제로 구성한 방식처럼, React 번들러 프로젝트에 `@mini-sentry/sdk`를 추가한 뒤 앱 진입점과 `ErrorBoundary`를 연결하는 예시입니다. 설치, tarball, script 태그, 기본 수동 캡처는 앞 절에서 다뤘으므로 여기서는 React 구성에만 집중합니다.

#### 4-5-1. 초기화 모듈 만들기

`src/sentry.ts`처럼 SDK 초기화를 한 곳에 모아두면 앱 진입점에서 한 번만 호출하기 쉽습니다.

```ts
// src/sentry.ts
import * as MiniSentry from "@mini-sentry/sdk";

export const initSentry = () =>
  MiniSentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    autoInstrument: true,
    environment: "production",
    // release: "web@1.0.0",
    // captureConsole: true,
  });
```

DSN은 프로젝트 생성 시 받은 값을 사용합니다.

```text
http://<publicKey>@<host>/<projectId>
예) http://<publicKey>@localhost:4100/<projectId>
```

로컬에서는 host가 `localhost:4100`이고, 배포 환경에서는 실제로 접근 가능한 공개 호스트를 넣습니다.

주요 옵션:

| 옵션 | 설명 |
|---|---|
| `autoInstrument` | 기본 `true`. 클릭, 네비게이션 breadcrumb와 전역 `window.onerror`/`unhandledrejection` 핸들러를 설치합니다. |
| `environment` | 이벤트가 어느 환경에서 발생했는지 표시합니다. 예: `production`, `staging`. |
| `release` | 선택값. 배포 버전이나 빌드 식별자를 이벤트에 붙입니다. |
| `captureConsole` | 기본 `false`. `console.log/info/warn/error` 호출을 breadcrumb로 남기고 싶을 때만 `true`로 켭니다. |

#### 4-5-2. 앱 진입점에서 렌더 전에 초기화하기

`initSentry()`는 모듈 최상단에서 한 번 호출합니다. React 렌더링 에러는 `ErrorBoundary`가 잡을 수 있도록 라우터와 앱을 감쌉니다.

```tsx
// src/main.tsx
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { initSentry } from "./sentry";

initSentry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ErrorBoundary>
);
```

`BrowserRouter`는 history API(`pushState`/`replaceState`)를 사용합니다. SDK의 자동 breadcrumb 계측은 이 history API를 감싸기 때문에 React Router 페이지 이동이 `navigation` breadcrumb로 기록됩니다. `HashRouter` 기준의 동작은 이 가이드에서 다루지 않습니다.

#### 4-5-3. ErrorBoundary 컴포넌트

`ErrorBoundary`는 React 렌더링 단계에서 발생한 에러를 폴백 UI로 바꾸고, `componentDidCatch`에서 Mini-Sentry로 보냅니다. `componentStack`을 같은 이벤트에 첨부하려면 `setContext`를 먼저 호출한 뒤 `captureException`을 호출합니다.

```tsx
// src/ErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import * as MiniSentry from "@mini-sentry/sdk";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    MiniSentry.setContext("react.error_boundary", {
      componentStack: errorInfo.componentStack,
    });
    MiniSentry.captureException(error);
  }

  private reset = () => {
    this.setState({ hasError: false });
  };

  private goHome = () => {
    this.setState({ hasError: false }, () => {
      window.location.assign("/");
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main role="alert">
        <h1>문제가 발생했습니다.</h1>
        <p>화면을 다시 시도하거나 홈으로 이동할 수 있습니다.</p>
        <button type="button" onClick={this.reset}>
          다시 시도
        </button>
        <button type="button" onClick={this.goHome}>
          홈으로
        </button>
      </main>
    );
  }
}
```

주의할 점: `ErrorBoundary`는 렌더링 단계 에러만 잡습니다. 이벤트 핸들러와 비동기 에러는 React Error Boundary가 잡지 않으므로 아래 경로를 함께 사용합니다.

#### 4-5-4. 에러가 잡히는 4가지 경로

| 경로 | 동작 |
|---|---|
| 렌더링 에러 | `ErrorBoundary`가 폴백을 표시하고 `componentDidCatch`에서 `MiniSentry.captureException(error)`로 전송합니다. |
| 수동 캡처 | `try/catch` 또는 이벤트 핸들러에서 `MiniSentry.captureException(err)`를 직접 호출합니다. 예를 들어 결제 실패를 잡아 보내면 UI는 죽지 않습니다. |
| 처리되지 않은 동기 예외 | 이벤트 핸들러에서 `throw`한 예외처럼 처리되지 않은 동기 예외는 `autoInstrument`의 전역 `window.onerror` 핸들러가 자동 캡처합니다. |
| 처리되지 않은 Promise 거부 | `Promise` 거부가 처리되지 않으면 전역 `unhandledrejection` 핸들러가 자동 캡처합니다. |

이벤트 핸들러에서 UI를 유지하며 보내는 예:

```tsx
const handleCheckout = async () => {
  try {
    await submitPayment();
  } catch (err) {
    MiniSentry.captureException(err);
    setPaymentError("결제에 실패했습니다. 다시 시도해 주세요.");
  }
};
```

#### 4-5-5. 브레드크럼으로 에러 직전 발자취 보기

`autoInstrument`가 켜져 있으면 다음 breadcrumb가 자동으로 쌓입니다.

| 종류 | category | 설명 |
|---|---|---|
| 클릭 | `ui.click` | 사용자가 클릭한 DOM 대상을 기록합니다. |
| 네비게이션 | `navigation` | `BrowserRouter`의 history API 이동을 기록합니다. |

`console.log/info/warn/error`는 기본 수집하지 않습니다. 필요할 때만 초기화 옵션에서 켭니다.

```ts
MiniSentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  captureConsole: true,
});
```

script 태그 방식에서는 다음 속성을 사용합니다.

```html
<script src="https://<host>/sdk/mini-sentry.min.js"
        data-dsn="https://<publicKey>@<host>/<projectId>"
        data-capture-console="true"></script>
```

수동 breadcrumb는 필요한 업무 흐름에 직접 남길 수 있습니다.

```ts
MiniSentry.addBreadcrumb({
  type: "default",
  category: "checkout",
  message: "사용자가 결제 버튼 클릭",
  level: "info",
});
```

breadcrumb는 최근 50개가 롤링 버퍼로 유지되고, 에러나 메시지를 캡처하는 시점의 스냅샷이 이벤트에 첨부됩니다. 대시보드 이슈 상세에서는 같은 이슈 안에서도 발생 이벤트별 breadcrumb를 따로 확인할 수 있습니다.

#### 4-5-6. 추가 컨텍스트 API

사용자, 태그, 업무 컨텍스트, 메시지를 함께 남길 수 있습니다.

```ts
MiniSentry.setUser({ id: "user_123", email: "me@example.com" });
MiniSentry.setTag("plan", "pro");
MiniSentry.setContext("cart", { items: 3, total: 42000 });
MiniSentry.captureMessage("결제 응답이 예상보다 늦습니다", "warning");
```

### 4-6. 동작 확인 (스모크 테스트)

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

`init` 옵션: `dsn`(필수), `release?`, `environment?`, `maxBreadcrumbs?`(기본 50), `autoInstrument?`(기본 true), `captureConsole?`(기본 false).

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

- [지도(맵) 타일 에러 수집 가이드](./MAP-ERROR-TRACKING.md) — MapLibre·네이버 지도 타일 실패 연결
- [ACCOUNTS.md](./ACCOUNTS.md) — 데모/테스트 계정
- [브라우저 SDK](../knowledge/architecture/sdk.md) · [인제스트 파이프라인](../knowledge/architecture/ingestion-pipeline.md)
- [인증 API](../knowledge/api/auth-api.md) · [프로젝트 API](../knowledge/api/projects-api.md) · [이슈 API](../knowledge/api/issues-api.md) · [알림 규칙 API](../knowledge/api/alerts-api.md)
- [전체 지식 베이스](../knowledge/index.md)
