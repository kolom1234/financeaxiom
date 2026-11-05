# FinanceAxiom — Open Finance Pulse

[English](./README.md) | [한국어](./README.ko.md)

**[FinanceAxiom](https://financeaxiom.com)** 은 `financeaxiom.com`에 배포된 금융 인텔리전스 플랫폼입니다. 이 저장소는 FinanceAxiom을 구동하는 핵심 데이터 엔진이자 웹 애플리케이션인 **Open Finance Pulse**를 포함하며, 데이터 소스 라이선스 준수, 광고 동의 정책, 배포 게이트 검증을 명시적으로 내장한 Cloudflare 기반 아키텍처로 구성됩니다.

<img width="984" height="1284" alt="image" src="https://github.com/user-attachments/assets/44c21eb4-1f08-42e9-aa5c-1c12448b197e" />

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [핵심 기능](#2-핵심-기능)
3. [시스템 아키텍처](#3-시스템-아키텍처)
4. [저장소 구조](#4-저장소-구조)
5. [API 구성](#5-api-구성)
6. [컴플라이언스 및 보안 통제](#6-컴플라이언스-및-보안-통제)
7. [품질 게이트 및 테스트 전략](#7-품질-게이트-및-테스트-전략)
8. [로컬 개발 가이드](#8-로컬-개발-가이드)
9. [환경 변수 구성](#9-환경-변수-구성)
10. [배포 플레이북](#10-배포-플레이북)
11. [운영 문서 인덱스](#11-운영-문서-인덱스)
12. [현재 제약사항](#12-현재-제약사항)
13. [라이선스](#13-라이선스)

## 1. 프로젝트 개요

**FinanceAxiom** (`financeaxiom.com`)은 외부에 공개된 금융 인텔리전스 서비스입니다. **Open Finance Pulse**는 이를 구동하는 모노레포로, 다음을 결합합니다.

- Cloudflare Pages에 배포되는 React/Vite 프론트엔드 (`apps/web`)
- `/api/*`를 제공하는 Cloudflare Worker 백엔드 (`apps/worker`)
- 계약/타입 및 정책 게이트 패키지 (`packages/shared`, `packages/policy`)
- Hyperdrive를 통한 Supabase/Postgres 영속 저장
- `docs/` 기반 감사/법무/운영 문서 체계

프로젝트의 운영 지향 포인트:

- 릴리즈 게이트 자동화 (`test:release-gate`, `test:oss-notice-gate`, `test:cmp-deploy`)
- 데이터 소스 라이선스 및 저작권 정책 기반 노출 제어
- 보안 통제(레이트 리밋, 인증 게이트웨이 하드닝, 푸시 데이터 암호화)

## 2. 핵심 기능

- 다중 탭 마켓 피드 (`breaking`, `filings`, `macro`, `newsindex`)
- 엔티티/시계열 상세 조회 API
- SEC 공시 및 거시지표/파생지표 수집 파이프라인
- Supabase Auth 연계 로그인/회원가입/비밀번호 재설정/변경
- 알림 규칙 및 푸시 구독 관리
- 지역별 광고 동의 정책 + CMP 신호(TCF/GPP/USP) 연동
- Legal/Privacy/Terms 화면 및 API 기반 법무 메타데이터 제공

## 3. 시스템 아키텍처

### 3.1 런타임 토폴로지

```mermaid
flowchart LR
  U[사용자 브라우저] --> P[Cloudflare Pages<br/>apps/web]
  P -->|/api/*| W[Cloudflare Worker<br/>apps/worker]

  W --> KV[Cloudflare KV<br/>OFP_KV]
  W --> R2[Cloudflare R2<br/>AUDIT_R2]
  W --> H[Cloudflare Hyperdrive]
  H --> DB[(Supabase Postgres)]

  W --> RLDO[RateLimiterDO]
  W --> SEC[SecLimiterDO]
  W --> EH[EventHubDO]

  SCH[Worker Cron Scheduler] --> IQ[Queue: ofp-ingest]
  SCH --> PQ[Queue: ofp-push]
  IQ --> W
  PQ --> W
```

### 3.2 데이터/제어 흐름

```mermaid
sequenceDiagram
  participant C as Client
  participant Pages as Pages (web)
  participant Worker as Worker API
  participant Queue as CF Queues
  participant DB as Supabase Postgres

  C->>Pages: /, /alerts, /legal 등 접근
  Pages->>Worker: GET /api/feed, /api/indicators/key, /api/legal
  Worker->>DB: allow-only 라이선스 필터 기반 조회
  DB-->>Worker: source + license 메타데이터 반환
  Worker-->>Pages: Envelope JSON(data + meta)
  Pages-->>C: Attribution/동의 정책 반영 UI 렌더링

  Note over Worker,Queue: 스케줄 기반 수집 작업
  Worker->>Queue: INGEST_GDELT / INGEST_SEC / INGEST_MACRO / RECOMPUTE_DERIVED
  Queue->>Worker: Queue consumer 실행
  Worker->>DB: 콘텐츠/시계열/공시 데이터 업서트
```

## 4. 저장소 구조

### 4.1 구조 다이어그램

```mermaid
graph TD
  R[FinanceAxiom / open-finance-pulse]
  R --> A[apps/web]
  R --> B[apps/worker]
  R --> C[packages/shared]
  R --> D[packages/policy]
  R --> E[supabase]
  R --> F[config]
  R --> G[scripts]
  R --> H[docs]

  A --> A1[src]
  A --> A2[e2e]
  A --> A3[public]

  B --> B1[src]
  B --> B2[test]
  B --> B3[wrangler.toml]
```

### 4.2 디렉터리 책임

| 경로 | 역할 |
|---|---|
| `apps/web` | 프론트엔드, 라우팅, 동의 UI, E2E 테스트, Pages 정적 자산 |
| `apps/worker` | API 라우터, 수집 잡, 큐 컨슈머, 레이트리미터, 인증 게이트웨이 |
| `packages/shared` | 공통 payload 타입/응답 유틸 |
| `packages/policy` | 정책 게이트(FRED 차단, 메타데이터-only 제한 등) |
| `supabase` | 마이그레이션/시드 SQL |
| `config` | 소스/라이선스/지표 메타 설정 |
| `scripts` | 릴리즈 게이트/컴플라이언스/배포 스모크 스크립트 |
| `docs` | 감사로그, 법무 문서, 운영 핸드오프 문서 |

## 5. API 구성

### 5.1 공개 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/feed` | 탭/검색/지역 기반 피드 + 커서 페이지네이션 |
| `GET` | `/api/indicators/key` | 핵심 지표 카드 + 스파크라인 데이터 |
| `GET` | `/api/legal` | 소스/라이선스/법적 안내 payload |
| `GET` | `/api/geo` | 지역 정책 분류(`EU_UK_CH`, `US_STATE_PRIVACY`, `NON_EU`) |
| `GET` | `/api/entity/:slug` | 엔티티 관련 피드(허용 라이선스만 노출), 없으면 404 |
| `GET` | `/api/series/:id` | UUID 또는 코드(예: `US_CPI_YOY`)로 raw/derived 시계열 조회(허용 라이선스만), `from`/`to`는 `YYYY-MM-DD` |
| `GET` | `/api/f/:accession` | SEC 출처 표기를 포함한 공시 메타데이터, 없으면 404 |
| `GET` | `/api/push/config` | Web Push 활성화 여부와 공개 VAPID 키 |

상태 코드: `400` 잘못된 입력, `404` 없음, `429` 레이트리밋(`retry-after`), `503` 영구 저장소 장애(로그 대조용 `x-request-id`). `/api/feed`는 불투명 keyset `cursor`(`next_cursor`)를 사용합니다. 지표 카드의 `yoy`는 날짜로 맞춘 전년 동기 대비 %이며 이미 %인 시리즈는 `null`이고, `change`/`change_unit`(% 시리즈는 `pp`)을 함께 제공합니다.

### 5.2 인증 필요 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET`,`POST` | `/api/account/audit` | 사용자 계정 활동 감사 로그 |
| `GET`,`POST` | `/api/alerts/rules` | 알림 규칙 조회/저장(규칙 유형별 검증, 계정당 최대 50개) |
| `DELETE` | `/api/alerts/rules/:id` | 본인 규칙 삭제 |
| `POST` | `/api/account/delete` | 본인 앱 데이터 삭제(`{"confirm":"DELETE"}`), `SUPABASE_SERVICE_ROLE_KEY` 설정 시 로그인 계정도 삭제 |
| `POST` | `/api/push/subscribe` | 푸시 구독 저장(암호화 저장) |
| `POST` | `/api/push/unsubscribe` | 푸시 구독 제거 |
| `GET` | `/api/stream` | 인증 기반 실시간 이벤트 스트림 |

### 5.3 인증 게이트웨이 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/auth/login` | 로그인 프록시 |
| `POST` | `/api/auth/signup` | 회원가입 프록시(redirect allowlist 적용) |
| `POST` | `/api/auth/password-reset` | 비밀번호 재설정 요청 |
| `POST` | `/api/auth/password-change` | 비밀번호 변경 |
| `POST` | `/api/auth/logout` | 로그아웃 |

## 6. 컴플라이언스 및 보안 통제

| 통제 영역 | 구현 내용 |
|---|---|
| 라이선스 노출 정책 | feed/entity/series API에서 허용 라이선스만 반환 |
| 퍼블리셔 콘텐츠 제한 | 기사 본문/원문 헤드라인/이미지 필드 차단(메타데이터-only) |
| 소스별 제약 정책 | FRED 하드블록, Eurostat 지역 필터, OECD/WB 제한 게이트 |
| Attribution 표기 | UI에서 `license.attribution_text` 노출 |
| 공개 API 남용 방지 | 공개 조회는 엣지 Cache API 우선, 캐시 미스에만 스코프별 레이트리밋(DO) |
| SEC 공정접근 준수 | User-Agent 선언 + 요청 속도 제한 |
| 인증 하드닝 | 본문 크기 제한, zod 검증, redirect 검증, 재시도/서킷브레이커(상태 전이 시에만 KV 기록), CAPTCHA 토큰 전달. anon 키로 Supabase Auth를 직접 호출할 수 있으므로 실질적 무차별 대입 방어는 Supabase 설정(레이트리밋 + CAPTCHA)에서 켜야 함 |
| 푸시 개인정보/발송 | endpoint/keys를 필드별 IV로 AES-GCM 암호화 저장, RFC 8291/8292 발송, 브라우저 푸시 서비스 호스트만 허용 |
| 광고 동의 정책 | EEA+UK+CH 및 미국 개인정보법 시행 주를 서버에서 분류, 판정 불가/실패 시 가장 엄격한 정책 적용, TCF/GPP/USP 신호 확인 후 광고 스크립트 로드 |
| 데이터 무결성 | 고유 dedupe 키, 기존 항목 재날짜 금지, 날짜 기준 YoY, ECB 공식 수정치 반영 및 이력 보관 |
| DB 직접 접근 | RLS: anon은 사용자 테이블 접근 불가, 로그인 사용자는 본인 행 읽기만 가능(쓰기는 워커 경유) |
| OSS 고지 체계 | `THIRD_PARTY_NOTICES.txt` 생성 + lockfile 동기화 게이트 |

## 7. 품질 게이트 및 테스트 전략

| 명령어 | 목적 |
|---|---|
| `npm run typecheck` | 전체 워크스페이스 타입 정합성(워커 테스트 포함) |
| `npm test` | 단위 + 통합 + 실제 Postgres + 컴플라이언스 스위트 |
| `npm run test:unit` | 정책/워커 단위 테스트(RFC 8291 Web Push 테스트 벡터 포함) |
| `npm run test:integration` | 워커 라우트 통합 테스트 |
| `npm run test:db` | 모든 마이그레이션을 적용한 실제 PostgreSQL(PGlite)에서 API/수집 검증 |
| `npm run test:compliance` | 컴플라이언스 게이트 + 실제 스키마 대상 동작 검증 |
| `npm run test:e2e` | 프론트 사용자 플로우 + 동의 시나리오 검증 |
| `npm run test:release-gate` | 컴플라이언스/실제 Postgres 스위트 실행 + 설정 점검(CSP, DLQ, 시드 내용) + OSS 노티스 게이트 |
| `npm run test:cmp-deploy` | 실배포 CMP 마커/광고 메타 파일 스모크 검증 |
| `npm run gen:oss-notices` | lockfile 기반 `THIRD_PARTY_NOTICES.txt` 재생성 |
| `npm run gen:vapid-keys` | Web Push용 VAPID 키 쌍 생성 |

CI(`.github/workflows/ci.yml`)는 모든 PR에서 타입체크, 린트, 전체 테스트, 빌드, Workers 번들 dry-run, 릴리즈 게이트, Playwright e2e를 실행합니다. 테스트와 개발 서버는 사전 `npm run build` 없이 동작합니다(워크스페이스 패키지를 소스에서 해석).

## 8. 로컬 개발 가이드

### 8.1 사전 요구사항

- Node.js 22+
- npm 10+
- Cloudflare Wrangler CLI (`npx wrangler ...`)
- Supabase 로컬 스택(전체 DB 플로우 검증 시)

### 8.2 부트스트랩

```bash
npm install
npm run typecheck
npm run build
```

### 8.3 서비스 실행

```bash
# Worker 로컬 실행
npm run -w apps/worker dev

# Web 로컬 실행
npm run -w apps/web dev -- --host 127.0.0.1 --port 4173
```

### 8.4 DB 자산

- 마이그레이션: `supabase/migrations/`(순서대로 적용, 모두 멱등)
- 참조 데이터(라이선스, 소스, 엔티티): `supabase/seed.sql`(모든 환경에 적용 가능)
- 로컬 개발 전용 샘플 콘텐츠: `supabase/sample_data.sql`(로컬 Supabase 스택만 로드, 운영에 절대 적용 금지)
- 보조 명령(Supabase CLI 및 프로젝트 link 필요):
  - `npm run db:migrate` (`supabase db push`)
  - `npm run db:seed` (`supabase db push --include-seed`)

## 9. 환경 변수 구성

### 9.1 Web (`apps/web/.env.local.example`)

| 변수 | 설명 |
|---|---|
| `VITE_SUPABASE_URL` | 프론트 인증 SDK용 Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | 프론트 공개 anon 키 |
| `VITE_API_BASE_URL` | API 베이스 URL 오버라이드 |
| `VITE_AD_CLIENT_ID` | 광고 클라이언트 식별자 |

### 9.2 Worker (`apps/worker/.dev.vars.example`)

| 변수 | 설명 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_JWKS_URL` | 인증 연동 |
| `DATABASE_URL` | Postgres 연결 문자열 |
| `SEC_USER_AGENT` | SEC 접근 정책용 UA |
| `PUSH_DATA_ENC_KEY` | 푸시 데이터 암호화 키 |
| `EVENT_HUB_INTERNAL_TOKEN` | 내부 이벤트 허브 토큰 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push 자격정보(`npm run gen:vapid-keys`, subject는 `mailto:` 또는 `https:`). 모두 설정되기 전까지 푸시는 비활성 |
| `SUPABASE_SERVICE_ROLE_KEY` | 선택 secret: `/api/account/delete`에서 Supabase Auth 사용자까지 삭제 |
| `BLS_API_KEY` / `BEA_API_KEY` / `EIA_API_KEY` | 외부 API 키(BLS는 선택, BEA는 키가 없으면 수집 건너뜀) |
| `GDELT_RETENTION_DAYS` / `NOTIFICATION_RETENTION_DAYS` | 보존 기간(기본 90일) |
| `ALLOWED_ORIGINS` / `AUTH_ALLOWED_REDIRECT_ORIGINS` | CORS 및 redirect allowlist |

보안 주의: 실제 비밀값은 절대 커밋하지 마세요. `.gitignore`는 `.env*`, `.dev.vars*`, `.wrangler/`, 인증서/키 패턴을 차단하도록 설정되어 있습니다.

## 10. 배포 플레이북

### 10.1 Web (Cloudflare Pages)

```bash
npm run -w apps/web build
npx wrangler pages deploy apps/web/dist --project-name open-finance-pulse --branch main
```

### 10.2 Worker (Cloudflare Workers)

```bash
npx wrangler deploy --config apps/worker/wrangler.toml
```

이 버전을 처음 배포하기 전에:

1. 마이그레이션 `0005`, `0006` 적용(`npm run db:migrate`). `0006`은 기존에 잘못 수집된 데이터를 바로잡습니다(`docs/REMEDIATION_2026-11-05.md` 참고).
2. secret 설정: `PUSH_DATA_ENC_KEY`, `VAPID_PRIVATE_KEY`(선택: `SUPABASE_SERVICE_ROLE_KEY`, `BLS_API_KEY`, `BEA_API_KEY`)를 `npx wrangler secret put <NAME> --config apps/worker/wrangler.toml`로 등록하고, `VAPID_PUBLIC_KEY`/`VAPID_SUBJECT`는 vars로 설정.
3. `wrangler.toml`이 참조하는 DLQ `ofp-ingest-dlq`/`ofp-push-dlq`가 자동 생성되지 않는 계정이면 `npx wrangler queues create <name>`으로 생성.
4. Supabase에서 CAPTCHA를 켜고 Auth 레이트리밋을 점검(게이트웨이가 `captcha_token`을 전달). 가능하면 Hyperdrive가 `postgres` 대신 최소 권한 전용 DB 롤을 사용하도록 설정.

### 10.3 배포 후 검증

```bash
npm run test:release-gate
npm run test:cmp-deploy
```

권장 운영 스모크 체크:

- `https://financeaxiom.com`
- `https://api.financeaxiom.com/api/feed?tab=breaking`
- `https://api.financeaxiom.com/api/indicators/key`
- `https://api.financeaxiom.com/api/legal`

## 11. 운영 문서 인덱스

| 문서 | 용도 |
|---|---|
| `SPEC.md` | 제품/컴플라이언스 기준 스펙 |
| `docs/HANDOFF.md` | 운영 핸드오프 및 재진입 가이드 |
| `docs/REMEDIATION_2026-11-05.md` | 전체 프로젝트 점검 결과, 수정 내용, 검증 근거 |
| `docs/LEGAL_AUDIT_2026-02-20.md` | 법무/컴플라이언스 감사 로그 및 조치 상태 |
| `docs/OSS_NOTICES_PROCESS.md` | OSS 고지 생성/검증 절차 |
| `docs/LEGAL_NOTICES.md` | 데이터 소스 정책 링크 집합 |
| `docs/PRIVACY.md`, `docs/TERMS.md` | 외부 공개 정책 문안 |

## 12. 현재 제약사항

- `apps/web/public/ads.txt`, `apps/web/public/sellers.json`에는 아직 판매자 정보가 없고, `AdSlot.tsx`의 광고 SDK URL은 플레이스홀더이며 인증 CMP도 로드되지 않습니다. 광고를 켤 때 공급사 스크립트/프레임 출처를 `apps/web/public/_headers`의 CSP에 추가해야 합니다.
- 마이그레이션 `0005` 이전에 만들어진 푸시 구독은 키 IV가 저장되지 않아 복호화할 수 없습니다. 브라우저가 Alerts 페이지에서 다시 구독할 때까지 발송 대상에서 제외됩니다.
- 인증된 CMP 동작은 외부 런타임 의존성이므로 배포마다 `npm run test:cmp-deploy`로 검증해야 합니다.
- 일부 문서는 날짜 기반 감사 스냅샷이므로 외부 보고 전 최신 배포 상태와 함께 교차 검증이 필요합니다.

## 13. 라이선스

Apache License 2.0 (`LICENSE`)를 따릅니다.
