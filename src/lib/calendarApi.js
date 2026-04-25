/**
 * 서비스 계정 기반 구글 캘린더 API 클라이언트
 * 로그인 없이 자동으로 캘린더를 읽고 씁니다.
 */

const BASE = '/api/calendar'

// ── 전체 일정 가져오기 (멀티 캘린더) ────────────────────────────────────────
// calendarIds: 문자열 배열. 각 이벤트에는 _calendarId 메타가 붙어옴.
// 일부 캘린더 fetch 실패해도 다른 건 진행 (errors 배열에 보고됨).
export async function fetchAllEvents(calendarIds) {
  const params = new URLSearchParams()
  if (Array.isArray(calendarIds) && calendarIds.length > 0) {
    params.set('calendarIds', calendarIds.join(','))
  }
  const res = await fetch(`${BASE}?action=list&${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return { events: data.events || [], errors: data.errors || [] }
}

// ── 일정 생성 ──────────────────────────────────────────────────────────────
export async function createEvent(eventBody, calendarId) {
  const params = new URLSearchParams({ action: 'create' })
  if (calendarId) params.set('calendarId', calendarId)
  const res = await fetch(`${BASE}?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return (await res.json()).event
}

// ── 일정 수정 ──────────────────────────────────────────────────────────────
export async function updateEvent(eventId, eventBody, calendarId) {
  const params = new URLSearchParams({ action: 'update' })
  if (calendarId) params.set('calendarId', calendarId)
  const res = await fetch(`${BASE}?${params.toString()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, ...eventBody }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return (await res.json()).event
}

// ── 일정 삭제 ──────────────────────────────────────────────────────────────
export async function deleteEvent(eventId, calendarId) {
  const params = new URLSearchParams({ action: 'delete', eventId })
  if (calendarId) params.set('calendarId', calendarId)
  const res = await fetch(`${BASE}?${params.toString()}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return true
}

// ── 일정 이동 (출처 → 대상 캘린더) ──────────────────────────────────────────
// 백엔드: 대상에 새로 만들고 출처에서 삭제. 새 googleEventId가 반환됨.
export async function moveEvent({ fromCalendarId, toCalendarId, eventId, eventBody }) {
  const res = await fetch(`${BASE}?action=move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromCalendarId, toCalendarId, eventId, eventBody }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return await res.json() // { event, deleted, deleteError }
}

// ── 앱 설정 가져오기 (모든 사용자 공유) ────────────────────────────────────
export async function fetchAppConfig() {
  const res = await fetch(`${BASE}?action=config`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.config // null이면 아직 설정 없음
}

// ── 앱 설정 저장 (모든 사용자 공유) ─────────────────────────────────────────
export async function saveAppConfig(payload) {
  const res = await fetch(`${BASE}?action=config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return await res.json()
}

// ── 팀별 고정 시간 ──────────────────────────────────────────────────────────
const TEAM_TIME = {
  A: { start: '09:00', end: '09:30' },
  B: { start: '12:00', end: '12:30' },
  C: { start: '15:00', end: '15:30' },
  D: { start: '18:00', end: '18:30' },
}

function detectTeamByTime(timeStr) {
  // 회사 룰: 9:00~9:30=A, 12:00~12:30=B, 15:00~15:30=C, 18:00~18:30=D
  const [h, m] = timeStr.split(':').map(n => parseInt(n, 10))
  const minutes = h * 60 + (m || 0)
  if (minutes >= 9  * 60 && minutes <= 9  * 60 + 30) return 'A'
  if (minutes >= 12 * 60 && minutes <= 12 * 60 + 30) return 'B'
  if (minutes >= 15 * 60 && minutes <= 15 * 60 + 30) return 'C'
  if (minutes >= 18 * 60 && minutes <= 18 * 60 + 30) return 'D'
  return 'A'
}

// ── 구글 이벤트 → 앱 스케줄 변환 ──────────────────────────────────────────
// options:
//   calKey  — 'pool' | 'teamAS:A' | 'teamReport:B' | 'ops' (출처 캘린더 키)
//   calMeta — { id, label, role, team }
// 출처 캘린더가 있으면 그 정보를 우선해서 team/role 결정. 없으면 옛 방식(description/시간) fallback.
export function googleEventToSchedule(event, options = {}) {
  const { calKey, calMeta } = options
  const startRaw = event.start?.dateTime || event.start?.date || ''
  const endRaw = event.end?.dateTime || event.end?.date || ''

  // 날짜 추출 (YYYY-MM-DD) - KST 기준
  let date = ''
  let rawStart = '09:00'
  if (startRaw.includes('T')) {
    const d = new Date(startRaw)
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    date = kst.toISOString().slice(0, 10)
    rawStart = kst.toISOString().slice(11, 16)
  } else {
    date = startRaw.slice(0, 10)
  }

  // description 파싱
  const desc = event.description || ''

  // 팀 결정 — 일정의 실제 시작 시간으로 분류.
  //   A=오전(6~11시), B=정오(11~14시), C=오후(14~17시), D=저녁(17~22시)
  //   캘린더 출처(teamAS:A 등)와 무관하게 시간 슬롯이 곧 팀.
  const team = detectTeamByTime(rawStart)
  const fixedTime = TEAM_TIME[team] || TEAM_TIME['A']

  // 제목 파싱: "담당자 / 업무내용" 형식 (앞의 상태 태그 제거)
  const rawTitleFull = event.summary || '새 일정'
  const rawTitle = rawTitleFull.replace(/^\[(완료|특이|진행중|예정)\]\s*/, '')
  let member = '미배정'
  let cleanTitle = rawTitle
  const slashIdx = rawTitle.indexOf(' / ')
  if (slashIdx > 0) {
    member = rawTitle.slice(0, slashIdx).trim()
    cleanTitle = rawTitle.slice(slashIdx + 3).trim()
  } else {
    // "담당자/ 업무내용" (공백 없는 경우도 처리)
    const slashIdx2 = rawTitle.indexOf('/')
    if (slashIdx2 > 0) {
      member = rawTitle.slice(0, slashIdx2).trim()
      cleanTitle = rawTitle.slice(slashIdx2 + 1).trim()
    }
  }

  // description에서 담당자 덮어쓰기
  const memberMatch = desc.match(/담당자:\s*(.+?)(?:\n|$)/)
  if (memberMatch && memberMatch[1].trim() !== '미배정') {
    member = memberMatch[1].trim()
  }

  // 상태, 메모, 연락처 파싱
  const statusMatch = desc.match(/상태:\s*(\S+)/)
  const status = statusMatch ? statusMatch[1] : '예정'
  const phoneMatch = desc.match(/연락처:\s*(.+?)(?:\n|$)/)
  const phone = phoneMatch ? phoneMatch[1].trim() : ''

  // ★ 원본 description은 절대 수정하지 않고 통째로 보존.
  //   메모 입력칸은 "기존 내용 하단에 추가할 새 메모"용 — import 직후엔 항상 비움.
  const originalDescription = desc

  return {
    id: event.id,                  // 임시 ID (importFromGoogle에서 덮어씀)
    googleEventId: event.id,
    team,
    member,
    title: cleanTitle,
    date,
    start: fixedTime.start,
    end: fixedTime.end,
    location: event.location || '',
    phone,
    status,
    memo: '',
    originalDescription,
    originalDate: null,
    // 멀티 캘린더 메타
    calendarKey: calKey || null,           // 'pool' | 'teamAS:A' | 'teamReport:A' | 'ops' | null
    calendarId: event._calendarId || calMeta?.id || null,
    calendarRole: calMeta?.role || null,   // 'pool' | 'teamAS' | 'teamReport' | 'ops'
  }
}
