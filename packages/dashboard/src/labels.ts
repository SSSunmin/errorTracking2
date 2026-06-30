import type {
  AlertChannel,
  AlertCondition,
  IssueLevel,
  IssueStatus
} from "./api";

// 사용자 노출 라벨(한국어). enum 값(코드/CSS 클래스)은 영문 그대로 두고
// 화면에 보이는 텍스트만 이 맵을 통해 한글로 표시한다.

export const levelLabels: Record<IssueLevel, string> = {
  debug: "디버그",
  info: "정보",
  warning: "경고",
  error: "오류",
  fatal: "심각"
};

export const statusLabels: Record<IssueStatus, string> = {
  unresolved: "미해결",
  resolved: "해결됨",
  ignored: "무시됨"
};

export const channelLabels: Record<AlertChannel, string> = {
  slack: "Slack",
  email: "이메일"
};

export const conditionLabels: Record<AlertCondition, string> = {
  new_issue: "새 이슈",
  regression: "회귀",
  event_threshold: "이벤트 임계치",
  event_spike: "급증 감지"
};
