/**
 * 서비스 계정 기반 구글 캘린더 API 클라이언트
 * 로그인 없이 자동으로 캘린더를 읽고 씁니다.
 */

const BASE = '/api/calendar'

// ── 전체 일정 가져오기 ──────────────────────────────────────────────────────
export async function fetchAllEvents() {
  const res = await fetch(`${BASE}?action=list`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.events || []
}

// ── 일정 생성 ──────────────────────────────────────────────────────────────
export async function createEvent(eventBody) {
  const res = await fetch(`${BASE}?action=create`, {
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
export async function updateEvent(eventId, eventBody) {
  const res = await fetch(`${BASE}?action=update`, {
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
export async function deleteEvent(eventId) {
  const res = await fetch(`${BASE}?action=delete&eventId=${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return true
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
  const h = parseInt(timeStr.slice(0, 2), 10)
  if (h >= 6  && h < 11) return 'A'
  if (h >= 11 && h < 14) return 'B'
  if (h >= 14 && h < 17) return 'C'
  if (h >= 17 && h < 22) return 'D'
  return 'A'
}

// ── 구글 이벤트 → 앱 스케줄 변환 ──────────────────────────────────────────
// 앱이 기대하는 필드: team, member, title, date, start, end, location, phone, status, memo
export function googleEventToSchedule(event) {
  const startRaw = event.start?.dateTime || event.start?.date || ''
  const endRaw = event.end?.dateTime || event.end?.date || ''

  // 날짜 추출 (YYYY-MM-DD) - KST 기준
  let date = ''
  let rawStart = '09:00'
  if (startRaw.includes('T')) {
    const d = new Date(startRaw)
    // KST 변환 (UTC+9)
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    date = kst.toISOString().slice(0, 10)
    rawStart = kst.toISOString().slice(11, 16)
  } else {
    date = startRaw.slice(0, 10)
  }

  // description 파싱
  const desc = event.description || ''

  // 팀 결정: description의 "팀: X팀" 우선, 없으면 시간 기반
  const teamMatch = desc.match(/팀:\s*([ABCD])팀/)
  const team = teamMatch ? teamMatch[1] : detectTeamByTime(rawStart)
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

  // 메모 파싱: "메모: xxx" 형식 우선
  // 없으면 description에서 앱이 생성한 필드들(팀, 담당자, 상태, 연락처)을 제외한 나머지를 메모로 처리
  let memo = ''
  const memoMatch = desc.match(/메모:\s*(.+?)(?:\n|$)/)
  if (memoMatch) {
    memo = memoMatch[1].trim()
  } else {
    // 앱이 생성한 필드가 아닌 내용이 있으면 메모로 처리
    const isAppGenerated = /팀:\s*[ABCD]팀/.test(desc) || /담당자:\s*/.test(desc) || /상태:\s*/.test(desc)
    if (!isAppGenerated && desc.trim()) {
      // 앱이 생성한 형식이 아닌 순수 구글 캘린더 메모
      memo = desc.trim()
    }
  }

  return {
    id: event.id,                  // 임시 ID (importFromGoogle에서 덮어씀)
    googleEventId: event.id,
    team,
    member,
    title: cleanTitle,
    date,
    start: fixedTime.start,        // 앱이 기대하는 필드명: start
    end: fixedTime.end,            // 앱이 기대하는 필드명: end
    location: event.location || '', // 앱이 기대하는 필드명: location
    phone,
    status,
    memo,
    originalDate: null,
  }
}
