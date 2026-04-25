import { createContext, useContext, useReducer, useCallback, useEffect } from 'react'

// ─── 초기 팀원 데이터 ─────────────────────────────────────────────────────────
const DEFAULT_MEMBERS = {
  A: ['미배정', '김대리', '이주임', '정사원'],
  B: ['미배정', '박사원', '윤대리', '서주임'],
  C: ['미배정', '최대리', '한과장', '오주임', '문대리'],
  D: ['미배정', '윤대리', '강주임', '배사원'],
}

const TEAM_LABELS = {
  A: '오전 9시',
  B: '오후 12시',
  C: '오후 3시',
  D: '오후 6시',
}

// 샘플 데이터는 더 이상 시드하지 않음 (구글 캘린더가 단일 진실 공급원).
// 빈 상태로 시작 → 첫 자동 가져오기 후 구글 캘린더의 일정만 표시됨.

const STORAGE_KEY = 'cs_schedule_state_v3'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function buildInitialState() {
  const saved = loadFromStorage()
  if (saved) return saved
  return {
    schedules: [],
    members: DEFAULT_MEMBERS,
    teamLabels: TEAM_LABELS,
    googleCalendarId: '',
    googleConnected: false,
    syncLogs: [],
    nextId: 1,
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_SCHEDULE': {
      const newItem = {
        ...action.payload,
        id: state.nextId,
        originalDate: action.payload.originalDate || null,
        localDirty: true, // 자동 반영 대상 표시
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

      // 앱에서 직접 추가한 일정 (googleEventId 없는 것) → 그대로 유지
      // 단 localDirty=false이고 googleEventId 없는 항목은 export 실패 잔여물일 수 있어 그대로 보존
      const localOnly = state.schedules.filter(s => !s.googleEventId)

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
    addMember: useCallback((team, name) => dispatch({ type: 'ADD_MEMBER', team, name }), []),
    removeMember: useCallback((team, name) => dispatch({ type: 'REMOVE_MEMBER', team, name }), []),
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
