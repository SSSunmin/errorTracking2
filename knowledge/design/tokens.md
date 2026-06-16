---
type: Design Tokens
title: 디자인 토큰 (BVDS 컬러 시스템)
description: 대시보드에 적용된 BVDS 컬러 토큰의 출처·이름 규칙·모드 반전·적용 위치.
resource: packages/dashboard/src/tokens.css
tags: [design, tokens, color, theme, bvds]
timestamp: 2026-06-16
---

# 디자인 토큰 (BVDS 컬러 시스템)

> ℹ️ **조건부 개념.** 이 프로젝트는 외부 디자인 시스템(BVDS)을 쓰므로 이 문서를 둔다.
> **자체 디자인 시스템이 없거나 다른 시스템을 쓰는 프로젝트라면 이 파일을 삭제**하고 `index.md`의 해당 항목만 지우면 된다(다른 개념은 이 문서를 필수 참조하지 않음).

## 출처
- **BVDS — 빅밸류 디자인 시스템**. Figma 변수 export.
- 원본 토큰: `D:/project/colorSystem/{Light,Dark} Mode.tokens.json` (W3C Design Tokens 형식, 해소된 hex + 별칭).
- Figma 파일 키: `aCIM7wf0HZ3sRX312YB1Sp`.

## 적용 위치
- `packages/dashboard/src/tokens.css` — `:root`(Light) + `.dark`(Dark)로 CSS 변수 정의.
- `packages/dashboard/src/styles.css` — 시맨틱 변수(`--bg`/`--accent`/`--error` 등)를 BVDS 토큰에 매핑.
- 테마 전환: `src/theme.tsx`(`ThemeProvider`/`useTheme`/`ThemeToggle`)가 `document.documentElement`의 `.dark` 클래스를 토글하고 `localStorage["mini-sentry-theme"]`에 저장. 초기값은 `index.html` 부트 스크립트가 첫 페인트 전에 localStorage→없으면 OS 설정(`prefers-color-scheme`)으로 결정(FOUC 방지). `.dark` 있으면 다크, 없으면 라이트.

## 토큰 그룹 (41색 × 2모드)
- **Brand**: `--primary-*`, `--secondary-*`, `--tertiary-*` (각 main/light/lighter/lightest/pale/dark/darker/darkest)
- **Neutral**(11): `--neutral-white · whitegray · pale · lightest · lighter · light · medium · dark · darker · darkest · black`
- **Validation**: `--positive` / `--positive-container`, `--warning` / `--warning-container`, `--negative` / `--negative-container`

## 이름 규칙
- `Brand/Primary/Main` → `--primary-main` (Brand 접두 제거)
- `Neutral/White` → `--neutral-white`
- `Validation/Negative/On Error` → `--negative`, `Validation/Negative/Container` → `--negative-container`

## 모드 반전 (중요)
- Neutral은 **의미 기반** 이름이라 모드 전환 시 값이 뒤집힌다: `--neutral-white`=배경(Light #ffffff → Dark #0c0b17), `--neutral-black`=텍스트(Light #0c0b17 → Dark #ffffff).
- 그래서 시맨틱 매핑(`--bg: var(--neutral-white)`)만으로 라이트/다크가 자동 전환된다.

## 갱신
- 원본 JSON이 바뀌면 `tokens.css`를 재생성하고 이 문서를 갱신한다(`/okf design`).

## 관련 개념
- [대시보드](/architecture/dashboard.md)
