import { createContext, useContext, useReducer, useCallback, useEffect } from 'react'

// ─── 초기 팀원 데이터 ─────────────────────────────────────────────────────────
// 기본값은 비워둔다. 실제 팀원 목록은 구글 캘린더의 설정 이벤트(__APP_CONFIG__)에서
// 로드되며, 모든 사용자가 동일한 값을 공유한다.
const DEFAULT_MEMBERS = {
  A: ['미배정'],
  B: ['미배정'],
  C: ['미배정'],
  D: ['미배정'],
}

const TEAM_LABELS = {
  A: '오전 9시',
  B: '오후 12시',
  C: '오후 3시',
  D: '오후 6시',
}

// ─── 캘린더 등록부 ────────────────────────────────────────────────────────────
// 각 캘린더의 역할(role):
//   pool      = 접수 풀 (익일통합). 읽기+쓰기.
//   teamAS    = 팀별 활성 A/S. 읽기+쓰기.
//   ops       = 운영 일정(납품/교체/철수/휴가/교육). 읽기+쓰기.
//   teamReport= 팀별 점검/마감. 쓰기 전용 (앱 표시 X, 수정 X, 등록만).
//
// `__APP_CONFIG__`로 덮어쓸 수 있어 모든 사용자가 동일 등록부 공유.
const DEFAULT_CALENDARS = {
  pool: {
    id: 'a7924882c9ac2aadef43993e50bcc9e0e7ccf2207060f30ace721948db395172@group.calendar.google.com',
    label: '익일통합 AS',
    role: 'pool',
  },
  teamAS: {
    A: { id: 'c_8aa74b64ef7adfca6673f6af40acb17f4cca1914d3d7256dffbd4eaf55037f5f@group.calendar.google.com', label: '수도권A [A/S]' },
    B: { id: 'c_907853563d1f6097187d2dd68d724e634c8d7dbce5fe50d725389ed6e372c7f9@group.calendar.google.com', label: '수도권B [A/S]' },
    C: { id: 'c_f81300f2e58e2de57b7a15f39d9172bc044a380da808a409edba54ed0940f547@group.calendar.google.com', label: '수도권C [A/S]' },
    D: { id: 'c_2791d53a40733df2a516d83e3a438f74bb55d7f3b21893704d0107d4af87af6e@group.calendar.google.com', label: '수도권D [A/S]' },
  },
  teamReport: {
    A: { id: 'c_78010dbbec1c266294a9e4b2c14403b3c7b2e97e59675c4cf896da3ea8e61b56@group.calendar.google.com', label: '수도권A [점검/마감]' },
    B: { id: 'c_740f19828c1e5249a7c5057a33baffae0e14b380c5619bdf1aca95c3de788ad5@group.calendar.google.com', label: '수도권B [점검/마감]' },
    C: { id: 'c_636ab0bf185ccc06bd61ec674c9de61bc7bd1f2ac76df2bbb007605201d87e8d@group.calendar.google.com', label: '수도권C [점검/마감]' },
    D: { id: 'c_e66271822496946e63bbe9d2fe2a24552bc35d96e335060a0ff8a74ab7ed96d0@group.calendar.google.com', label: '수도권D [점검/마감]' },
  },
  ops: {
    id: '3be77765f4952c3c929154ec7c7fa0b021eeedcec0c9ac1631fa4ab83c3e6453@group.calendar.google.com',
    label: '납품/교체/철수/휴가/교육',
    role: 'ops',
  },
}

// 가져올(read) 캘린더 키 목록 → IMPORT 대상.
// 점검/마감(teamReport)도 포함 — CRUD 가능하지만 메인 화면에선 별도 탭으로 분리 표시.
export function getReadCalendarKeys() {
  return [
    'pool',
    'teamAS:A', 'teamAS:B', 'teamAS:C', 'teamAS:D',
    'teamReport:A', 'teamReport:B', 'teamReport:C', 'teamReport:D',
    'ops',
  ]
}

// 캘린더 키 → 실제 ID/label/role 해석
export function resolveCalendar(calendars, calKey) {
  if (!calKey || !calendars) return null
  if (calKey.includes(':')) {
    const [group, sub] = calKey.split(':')
    const entry = calendars[group]?.[sub]
    if (!entry) return null
    return { id: entry.id, label: entry.label, role: group, team: sub }
  }
  const entry = calendars[calKey]
  if (!entry) return null
  return { id: entry.id, label: entry.label, role: calKey }
}

// 샘플 데이터는 더 이상 시드하지 않음 (구글 캘린더가 단일 진실 공급원).
// 빈 상태로 시작 → 첫 자동 가져오기 후 구글 캘린더의 일정만 표시됨.

// v5: 멀티 캘린더 도입 — 일정에 calendarKey/calendarId 필드 추가.
// 이전 키들은 단일 캘린더 시절 데이터라 무시하고 새로 시작.
const STORAGE_KEY = 'cs_schedule_state_v5'
const LEGACY_KEYS = ['cs_schedule_state_v1', 'cs_schedule_state_v2', 'cs_schedule_state_v3', 'cs_schedule_state_v4']

function loadFromStorage() {
  try {
    // 구버전 키 정리 — 옛 샘플 데이터가 들어있을 수 있음
    LEGACY_KEYS.forEach(k => {
      try { localStorage.removeItem(k) } catch {}
    })
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function buildInitialState() {
  const saved = loadFromStorage()
  if (saved) {
    return {
      ...saved,
      members: saved.members && Object.keys(saved.members).length > 0 ? saved.members : DEFAULT_MEMBERS,
      teamLabels: saved.teamLabels || TEAM_LABELS,
      calendars: saved.calendars && Object.keys(saved.calendars).length > 0 ? saved.calendars : DEFAULT_CALENDARS,
    }
  }
  return {
    schedules: [],
    members: DEFAULT_MEMBERS,
    teamLabels: TEAM_LABELS,
    calendars: DEFAULT_CALENDARS,
    googleCalendarId: '',
    googleConnected: false,
    syncLogs: [],
    nextId: 1,
    lastSyncAt: null,
    configLoadedAt: null,
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_SCHEDULE': {
      // 신규 일정 — 명시적 calendarKey 우선. 없으면 팀 기준 teamAS로 기본.
      const payload = action.payload
      let calendarKey = payload.calendarKey
      let calendarRole = payload.calendarRole
      let calendarId = payload.calendarId
      if (calendarKey) {
        // calendarKey만 주어진 경우 → 등록부에서 id/role 채움
        const meta = resolveCalendar(state.calendars, calendarKey)
        if (meta) {
          calendarId = calendarId || meta.id
          calendarRole = calendarRole || meta.role
        }
      } else if (payload.team && state.calendars?.teamAS?.[payload.team]) {
        calendarKey = `teamAS:${payload.team}`
        calendarRole = 'teamAS'
        calendarId = state.calendars.teamAS[payload.team].id
      }
      const newItem = {
        ...payload,
        calendarKey: calendarKey || null,
        calendarRole: calendarRole || null,
        calendarId: calendarId || null,
        id: state.nextId,
        originalDate: payload.originalDate || null,
        localDirty: true,
      }
      return { ...state, schedules: [...state.schedules, newItem], nextId: state.nextId + 1 }
    }
    case 'UPDATE_SCHEDULE': {
      return {
        ...state,
        schedules: state.schedules.map(s =>
          s.id === action.payload.id
            ? { ...s, ...action.payload, localDirty: action.payload.localDirty ?? true }
            : s
        ),
      }
    }
    case 'DELETE_SCHEDULE': {
      return { ...state, schedules: state.schedules.filter(s => s.id !== action.id) }
    }
    case 'SET_STATUS': {
      return {
        ...state,
        schedules: state.schedules.map(s =>
          s.id === action.id ? { ...s, status: action.status, localDirty: true } : s
        ),
      }
    }
    case 'POSTPONE_SCHEDULE': {
      return {
        ...state,
        schedules: state.schedules.map(s => {
          if (s.id !== action.id) return s
          // originalDate: 처음 미루는 경우에만 저장 (이미 있으면 유지)
          const originalDate = s.originalDate || s.date
          return { ...s, date: action.date, status: '예정', originalDate, localDirty: true }
        }),
      }
    }
    case 'UNPOSTPONE_SCHEDULE': {
      // 미루기 해제 — originalDate가 있으면 그 날짜로 되돌리고 originalDate를 비움.
      return {
        ...state,
        schedules: state.schedules.map(s => {
          if (s.id !== action.id) return s
          if (!s.originalDate) return s
          return { ...s, date: s.originalDate, originalDate: null, localDirty: true }
        }),
      }
    }
    case 'CLEAR_LOCAL_DIRTY': {
      // 자동 반영이 성공한 일정의 localDirty 플래그 해제
      const ids = new Set(action.ids)
      return {
        ...state,
        schedules: state.schedules.map(s =>
          ids.has(s.id) ? { ...s, localDirty: false } : s
        ),
      }
    }
    case 'ADD_MEMBER': {
      const team = action.team
      const current = state.members[team] || []
      if (current.includes(action.name)) return state
      return { ...state, members: { ...state.members, [team]: [...current, action.name] } }
    }
    case 'REMOVE_MEMBER': {
      const team = action.team
      const updated = (state.members[team] || []).filter(m => m !== action.name)
      const updatedSchedules = state.schedules.map(s =>
        s.team === team && s.member === action.name
          ? { ...s, member: '미배정', title: s.title.replace(new RegExp(`^${action.name}\\s*/\\s*`), '') }
          : s
      )
      return { ...state, members: { ...state.members, [team]: updated }, schedules: updatedSchedules }
    }
    case 'SET_GOOGLE_CALENDAR_ID':
      return { ...state, googleCalendarId: action.id }
    case 'SET_GOOGLE_CONNECTED':
      return { ...state, googleConnected: action.connected }

    case 'IMPORT_FROM_GOOGLE': {
      const incoming = action.events // 구글에서 가져온 이벤트 배열

      // 기존 앱 일정을 googleEventId 기준으로 맵 생성
      const existingByGoogleId = {}
      state.schedules.forEach(s => {
        if (s.googleEventId) existingByGoogleId[s.googleEventId] = s
      })

      // 구글에서 온 이벤트 처리
      const incomingGoogleIds = new Set()
      const numericIds = state.schedules.map(s => s.id).filter(id => typeof id === 'number')
      let nextId = Math.max(0, state.nextId - 1, ...numericIds) + 1

      const mergedFromGoogle = incoming.map(ev => {
        incomingGoogleIds.add(ev.googleEventId)
        const existing = existingByGoogleId[ev.googleEventId]

        if (existing) {
          // ★ 핵심: localDirty=true인 일정은 아직 구글에 반영 안 됨 → 앱 데이터 전체 우선
          // localDirty=false면 구글이 최신본 → 구글 데이터 우선하되 앱 전용 필드만 보존
          if (existing.localDirty) {
            // 앱 수정사항 100% 보존, googleEventId만 동기화 보장
            return { ...existing, googleEventId: ev.googleEventId }
          }
          // 구글이 최신: 구글 값 우선, 단 originalDate(앱 전용)는 보존
          return {
            ...ev,
            id: existing.id,
            originalDate: existing.originalDate ?? null,
            localDirty: false,
          }
        }

        // 새로운 구글 이벤트
        const newItem = { ...ev, id: nextId, localDirty: false }
        nextId++
        return newItem
      })

      // 앱에서 방금 추가했지만 아직 구글에 반영 안 된 일정만 보존.
      // (googleEventId 없고 localDirty=true인 것)
      // 그 외 "googleEventId 없고 localDirty도 아닌" 일정은 옛 샘플/잔재 데이터이므로 정리.
      const localOnly = state.schedules.filter(s => !s.googleEventId && s.localDirty === true)

      // 구글에서 삭제된 일정은 앱에서도 제거.
      // 단 localDirty=true(아직 미반영)는 보호 — incoming에 없어도 살려둠.
      const protectedDirty = state.schedules.filter(
        s => s.googleEventId && s.localDirty && !incomingGoogleIds.has(s.googleEventId)
      )

      const all = [...localOnly, ...mergedFromGoogle, ...protectedDirty]
      // googleEventId 중복 제거 (이론상 없어야 하나 안전장치)
      const seen = new Set()
      const deduped = []
      for (const s of all) {
        const key = s.googleEventId || `local-${s.id}`
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(s)
      }

      const allNumericIds = deduped.map(s => s.id).filter(id => typeof id === 'number')
      return {
        ...state,
        schedules: deduped,
        nextId: Math.max(0, state.nextId, ...allNumericIds) + 1,
        lastSyncAt: Date.now(),
      }
    }

    case 'APPLY_REMOTE_CONFIG': {
      // 구글 캘린더의 설정 이벤트에서 멤버/팀라벨/캘린더 등록부를 끌어와 적용.
      // 모든 사용자가 동일한 값을 공유하기 위함.
      const { members, teamLabels, calendars } = action.payload || {}
      const next = { ...state, configLoadedAt: Date.now() }
      if (members && typeof members === 'object') {
        // 미배정은 항상 첫 번째 자리에 보장
        const normalized = {}
        for (const t of ['A', 'B', 'C', 'D']) {
          const list = Array.isArray(members[t]) ? members[t] : []
          const filtered = list.filter(n => n && n !== '미배정')
          normalized[t] = ['미배정', ...filtered]
        }
        next.members = normalized
      }
      if (teamLabels && typeof teamLabels === 'object') {
        next.teamLabels = { ...state.teamLabels, ...teamLabels }
      }
      if (calendars && typeof calendars === 'object') {
        next.calendars = calendars
      }
      return next
    }

    case 'SET_CALENDAR_ENTRY': {
      // calKey: 'pool' | 'ops' | 'teamAS:A' | 'teamReport:B' ...
      const { calKey, id, label } = action
      const cals = { ...state.calendars }
      if (calKey.includes(':')) {
        const [group, sub] = calKey.split(':')
        cals[group] = {
          ...(cals[group] || {}),
          [sub]: { ...(cals[group]?.[sub] || {}), id: id ?? cals[group]?.[sub]?.id, label: label ?? cals[group]?.[sub]?.label },
        }
      } else {
        cals[calKey] = { ...(cals[calKey] || {}), id: id ?? cals[calKey]?.id, label: label ?? cals[calKey]?.label }
      }
      return { ...state, calendars: cals }
    }

    case 'SET_TEAM_LABEL': {
      return {
        ...state,
        teamLabels: { ...state.teamLabels, [action.team]: action.label },
      }
    }

    case 'ADD_SYNC_LOG':
      return { ...state, syncLogs: [action.log, ...state.syncLogs].slice(0, 20) }
    case 'RESET':
      localStorage.removeItem(STORAGE_KEY)
      return buildInitialState()
    default:
      return state
  }
}

export const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, buildInitialState)

  // LocalStorage 자동 저장
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {}
  }, [state])

  const actions = {
    addSchedule: useCallback((payload) => dispatch({ type: 'ADD_SCHEDULE', payload }), []),
    updateSchedule: useCallback((payload) => dispatch({ type: 'UPDATE_SCHEDULE', payload }), []),
    deleteSchedule: useCallback((id) => dispatch({ type: 'DELETE_SCHEDULE', id }), []),
    setStatus: useCallback((id, status) => dispatch({ type: 'SET_STATUS', id, status }), []),
    postponeSchedule: useCallback((id, date) => dispatch({ type: 'POSTPONE_SCHEDULE', id, date }), []),
    unpostponeSchedule: useCallback((id) => dispatch({ type: 'UNPOSTPONE_SCHEDULE', id }), []),
    addMember: useCallback((team, name) => dispatch({ type: 'ADD_MEMBER', team, name }), []),
    removeMember: useCallback((team, name) => dispatch({ type: 'REMOVE_MEMBER', team, name }), []),
    setTeamLabel: useCallback((team, label) => dispatch({ type: 'SET_TEAM_LABEL', team, label }), []),
    setCalendarEntry: useCallback((calKey, id, label) => dispatch({ type: 'SET_CALENDAR_ENTRY', calKey, id, label }), []),
    applyRemoteConfig: useCallback((payload) => dispatch({ type: 'APPLY_REMOTE_CONFIG', payload }), []),
    setGoogleCalendarId: useCallback((id) => dispatch({ type: 'SET_GOOGLE_CALENDAR_ID', id }), []),
    setGoogleConnected: useCallback((connected) => dispatch({ type: 'SET_GOOGLE_CONNECTED', connected }), []),
    importFromGoogle: useCallback((events) => dispatch({ type: 'IMPORT_FROM_GOOGLE', events }), []),
    clearLocalDirty: useCallback((ids) => dispatch({ type: 'CLEAR_LOCAL_DIRTY', ids }), []),
    addSyncLog: useCallback((log) => dispatch({ type: 'ADD_SYNC_LOG', log }), []),
    reset: useCallback(() => {
      localStorage.removeItem(STORAGE_KEY)
      dispatch({ type: 'RESET' })
    }, []),
  }

  return (
    <StoreContext.Provider value={{ state, actions }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  return useContext(StoreContext)
}
