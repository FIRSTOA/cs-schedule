import { useState, useEffect, useRef, useCallback } from 'react'
import { StoreProvider, useStore, getReadCalendarKeys, resolveCalendar } from '@/store/useStore.jsx'
import NavBar from '@/components/NavBar'
import TodayPage from '@/pages/TodayPage'
import CalendarPage from '@/pages/CalendarPage'
import SettingsPage from '@/pages/SettingsPage'
import SyncPage from '@/pages/SyncPage'
import dayjs from 'dayjs'
import {
  fetchAllEvents,
  createEvent,
  updateEvent,
  moveEvent,
  googleEventToSchedule,
  fetchAppConfig,
  saveAppConfig,
} from '@/lib/calendarApi'

const AUTO_SYNC_INTERVAL = 30 * 1000 // 30초

// 캘린더 역할별 시간 블록 — A/S와 점검/마감만 시간 고정. pool/ops는 자유 시간.
function getStartHour(team) {
  return team === 'A' ? 9 : team === 'B' ? 12 : team === 'C' ? 15 : team === 'D' ? 18 : 9
}

// description 합치기 — 원본은 절대 수정하지 않고, 메모칸에 새로 입력한 내용만 맨 끝에 추가.
// 완료/특이/미루기 등 상태 변경 시 memo가 비어 있으면 description은 원본 그대로 유지됨.
export function composeDescription(originalDescription, memo) {
  const base = (originalDescription || '').replace(/\s+$/, '')
  const addition = (memo || '').trim()
  if (!addition) return base
  if (!base) return addition
  return `${base}\n${addition}`
}

// 일정 → 구글 이벤트 본문 변환
function buildEventBody(s) {
  const workDate = s.workDate || s.date
  const startHour = getStartHour(s.team)
  const statusTag = s.status === '완료' ? '[완료] ' : s.status === '특이' ? '[특이] ' : s.status === '진행중' ? '[진행중] ' : ''
  const colorId = s.status === '완료' ? '8' : s.status === '특이' ? '11' : s.status === '진행중' ? '5' : undefined
  const titleAlreadyHasMember = s.member && s.member !== '미배정' && s.title.startsWith(`${s.member} / `)
  const baseTitle = s.member && s.member !== '미배정' && !titleAlreadyHasMember ? `${s.member} / ${s.title}` : s.title
  return {
    summary: `${statusTag}${baseTitle}`,
    // colorId는 status가 색깔 있는 상태(완료/특이/진행중)일 때만 보냄.
    // 예정/익일로 돌아갈 땐 colorId 키 자체를 빼서 구글에서 기본 색으로 복귀.
    // (빈 문자열은 구글 API가 invalid로 거부 → 일정 자체 생성/수정 실패)
    ...(colorId ? { colorId } : {}),
    location: s.location || s.address || '',
    description: composeDescription(s.originalDescription, s.memo),
    start: {
      dateTime: `${workDate}T${String(startHour).padStart(2, '0')}:00:00+09:00`,
      timeZone: 'Asia/Seoul',
    },
    end: {
      dateTime: `${workDate}T${String(startHour).padStart(2, '0')}:30:00+09:00`,
      timeZone: 'Asia/Seoul',
    },
  }
}

// 반영 대상 캘린더 ID 결정 — 사용자가 폼에서 고른 calendarKey가 가장 최신 의도라 우선.
// (calendarId는 import 시점의 "구글에 현재 있는 위치"라서 캘린더 변경 시 옛 값일 수 있음)
function resolveTargetCalendarId(schedule, calendars) {
  if (schedule.calendarKey) {
    const meta = resolveCalendar(calendars, schedule.calendarKey)
    if (meta?.id) return meta.id
  }
  if (schedule.calendarId) return schedule.calendarId
  if (schedule.team) {
    const meta = resolveCalendar(calendars, `teamAS:${schedule.team}`)
    if (meta) return meta.id
  }
  return null
}

function AppInner() {
  const [tab, setTab] = useState('today')
  const { state, actions } = useStore()
  const autoSyncTimer = useRef(null)
  // 이전 schedules 스냅샷 (변경 감지용)
  const prevSchedulesRef = useRef(null)
  // 자동 반영 디바운스 타이머
  const autoExportTimer = useRef(null)
  // 초기 로딩 완료 여부
  const initialLoadDone = useRef(false)
  // 동시 import 방지 락
  const importInFlight = useRef(false)
  // 설정(멤버/팀라벨) 자동 push 디바운스 타이머
  const configPushTimer = useRef(null)
  // 마지막으로 push한 설정 시그니처 (불필요한 push 방지)
  const lastPushedConfig = useRef(null)
  // 원격 설정 적용 직후엔 push 트리거 안 함 (echo 방지)
  const skipNextConfigPush = useRef(false)

  // ── 가져오기 핵심 로직 (멀티 캘린더) ─────────────────────────────────────
  const doImport = useCallback(async ({ silent = false } = {}) => {
    if (importInFlight.current) return false
    importInFlight.current = true
    try {
      // 등록부에서 read 대상 캘린더 ID 모음
      const readKeys = getReadCalendarKeys()
      const idToKey = {}
      const calendarIds = []
      for (const key of readKeys) {
        const meta = resolveCalendar(state.calendars, key)
        if (meta?.id) {
          idToKey[meta.id] = { key, meta }
          calendarIds.push(meta.id)
        }
      }

      // 일정(여러 캘린더 병렬) + 설정 동시 fetch
      const [listResult, remoteConfig] = await Promise.all([
        fetchAllEvents(calendarIds),
        fetchAppConfig().catch(() => null),
      ])
      const { events, errors } = listResult
      if (errors && errors.length > 0) {
        // 일부 캘린더 실패만 로그로 남기고 진행
        console.warn('일부 캘린더 동기화 실패:', errors)
      }

      let nextId = Math.max(...state.schedules.map(s => s.id || 0), 0) + 1
      const mapped = events.map(ev => {
        const ctx = idToKey[ev._calendarId] || {}
        const s = googleEventToSchedule(ev, { calKey: ctx.key, calMeta: ctx.meta })
        s.id = s.id || nextId++
        return s
      })
      actions.importFromGoogle(mapped)

      // 원격 설정 적용
      if (remoteConfig && (remoteConfig.members || remoteConfig.teamLabels || remoteConfig.calendars)) {
        skipNextConfigPush.current = true
        actions.applyRemoteConfig(remoteConfig)
        lastPushedConfig.current = JSON.stringify({
          members: remoteConfig.members || null,
          teamLabels: remoteConfig.teamLabels || null,
          calendars: remoteConfig.calendars || null,
        })
      }
      actions.setGoogleConnected(true)
      if (!silent) {
        const now = dayjs()
        const errNote = errors && errors.length > 0 ? ` (캘린더 ${errors.length}개 실패)` : ''
        actions.addSyncLog({ time: now.format('HH:mm'), type: 'import', msg: `동기화 완료 (${mapped.length}개)${errNote}`, ok: !errors || errors.length === 0 })
        // 실패 상세 — 어떤 캘린더가 막혔는지 확인하기 쉽게
        if (errors && errors.length > 0) {
          errors.forEach(err => {
            const calName = idToKey[err.calendarId]?.meta?.label || err.calendarId.slice(0, 24) + '…'
            const tag = err.reason ? `${err.reason}${err.code ? `/${err.code}` : ''}` : (err.code || '')
            const detail = err.detailMessage || err.error
            const suffix = tag ? ` [${tag}] ${detail}` : ` ${detail}`
            actions.addSyncLog({
              time: dayjs().format('HH:mm'),
              type: 'import',
              msg: `실패: ${calName} →${suffix}`,
              ok: false,
            })
          })
        }
      }
      return true
    } catch (e) {
      actions.setGoogleConnected(false)
      if (!silent) {
        actions.addSyncLog({ time: dayjs().format('HH:mm'), type: 'import', msg: `동기화 실패: ${e.message}`, ok: false })
      }
      return false
    } finally {
      importInFlight.current = false
    }
  }, [state.schedules, state.calendars, actions])

  // ── 반영하기 핵심 로직 (per-schedule 캘린더 ID 사용) ─────────────────────
  const doExport = useCallback(async (schedules) => {
    const today = dayjs().format('YYYY-MM-DD')
    const targets = schedules.filter(s => (s.workDate || s.date) >= today)
    if (targets.length === 0) return
    let successCount = 0
    let failCount = 0
    const failReasons = []
    const actionLogs = []
    for (const s of targets) {
      try {
        const eventBody = buildEventBody(s)
        const targetCalendarId = resolveTargetCalendarId(s, state.calendars)
        const currentCalendarId = s.calendarId // 구글에 현재 들어있는 위치
        const needsMove =
          s.googleEventId &&
          currentCalendarId &&
          targetCalendarId &&
          currentCalendarId !== targetCalendarId

        const fromMeta = currentCalendarId
          ? Object.values(state.calendars || {}).flatMap(v =>
              v?.id ? [v] : Object.values(v || {})
            ).find(c => c?.id === currentCalendarId)
          : null
        const toMeta = targetCalendarId
          ? Object.values(state.calendars || {}).flatMap(v =>
              v?.id ? [v] : Object.values(v || {})
            ).find(c => c?.id === targetCalendarId)
          : null
        const fromLabel = fromMeta?.label || (currentCalendarId ? currentCalendarId.slice(0, 12) + '…' : '없음')
        const toLabel = toMeta?.label || (targetCalendarId ? targetCalendarId.slice(0, 12) + '…' : '없음')

        if (needsMove) {
          actionLogs.push(`이동: ${s.title} (${fromLabel} → ${toLabel})`)
          const moveResult = await moveEvent({
            fromCalendarId: currentCalendarId,
            toCalendarId: targetCalendarId,
            eventId: s.googleEventId,
            eventBody,
          })
          actions.updateSchedule({
            id: s.id,
            googleEventId: moveResult.event?.id || s.googleEventId,
            calendarId: targetCalendarId,
            originalDescription: eventBody.description,
            memo: '',
            localDirty: false,
          })
        } else if (s.googleEventId) {
          actionLogs.push(`수정: ${s.title} (${fromLabel})`)
          await updateEvent(s.googleEventId, eventBody, targetCalendarId)
          actions.updateSchedule({
            id: s.id,
            originalDescription: eventBody.description,
            memo: '',
            localDirty: false,
          })
        } else {
          actionLogs.push(`생성: ${s.title} (${toLabel})`)
          const created = await createEvent(eventBody, targetCalendarId)
          actions.updateSchedule({
            ...s,
            googleEventId: created.id,
            calendarId: created._calendarId || targetCalendarId,
            originalDescription: eventBody.description,
            memo: '',
            localDirty: false,
          })
        }
        successCount++
      } catch (e) {
        console.error('자동 반영 실패:', s.title, e)
        failReasons.push(`${s.title || '(제목없음)'}: ${e.message || e}`)
        failCount++
      }
    }
    if (successCount > 0 || failCount > 0) {
      const baseMsg = successCount > 0
        ? `자동 반영 완료 (${successCount}개${failCount > 0 ? `, 실패 ${failCount}개` : ''})`
        : `자동 반영 실패 (${failCount}개)`
      actions.addSyncLog({
        time: dayjs().format('HH:mm'),
        type: 'export',
        msg: baseMsg,
        ok: failCount === 0,
      })
      // 동작 내역 (어디로 어떻게 갔는지) 로그로 — 진단용.
      actionLogs.forEach(line => {
        actions.addSyncLog({
          time: dayjs().format('HH:mm'),
          type: 'export',
          msg: line,
          ok: true,
        })
      })
      failReasons.forEach(reason => {
        actions.addSyncLog({
          time: dayjs().format('HH:mm'),
          type: 'export',
          msg: `실패: ${reason}`,
          ok: false,
        })
      })
    }
  }, [actions, state.calendars])

  // ── 앱 시작 시 최초 동기화 + 30초 자동 + 가시성/포커스 트리거 ─────────────
  useEffect(() => {
    // 최초 가져오기
    doImport().then(() => {
      initialLoadDone.current = true
    })
    // 30초마다 백그라운드 동기화 (탭이 활성일 때만 의미 있음)
    autoSyncTimer.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        doImport({ silent: true })
      }
    }, AUTO_SYNC_INTERVAL)

    // 탭 다시 켜질 때 / 창 포커스 들어올 때 즉시 동기화
    const onVisibility = () => {
      if (document.visibilityState === 'visible') doImport({ silent: true })
    }
    const onFocus = () => doImport({ silent: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      if (autoSyncTimer.current) clearInterval(autoSyncTimer.current)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, []) // eslint-disable-line

  // ── localDirty=true 일정 자동 반영 (디바운스 3초) ──────────────────────────
  useEffect(() => {
    if (!initialLoadDone.current) {
      prevSchedulesRef.current = state.schedules
      return
    }
    prevSchedulesRef.current = state.schedules

    const today = dayjs().format('YYYY-MM-DD')
    const dirty = state.schedules.filter(
      s => s.localDirty && (s.workDate || s.date) >= today
    )
    if (dirty.length === 0) return

    if (autoExportTimer.current) clearTimeout(autoExportTimer.current)
    autoExportTimer.current = setTimeout(() => {
      doExport(dirty)
    }, 3000)
  }, [state.schedules]) // eslint-disable-line

  // ── 멤버/팀라벨/캘린더등록부 변경 시 구글 캘린더에 자동 push (디바운스 1.5초) ─────
  useEffect(() => {
    if (!initialLoadDone.current) return
    if (skipNextConfigPush.current) {
      skipNextConfigPush.current = false
      lastPushedConfig.current = JSON.stringify({
        members: state.members,
        teamLabels: state.teamLabels,
        calendars: state.calendars,
      })
      return
    }
    const sig = JSON.stringify({
      members: state.members,
      teamLabels: state.teamLabels,
      calendars: state.calendars,
    })
    if (sig === lastPushedConfig.current) return

    if (configPushTimer.current) clearTimeout(configPushTimer.current)
    configPushTimer.current = setTimeout(async () => {
      try {
        await saveAppConfig({
          members: state.members,
          teamLabels: state.teamLabels,
          calendars: state.calendars,
        })
        lastPushedConfig.current = sig
        actions.addSyncLog({
          time: dayjs().format('HH:mm'),
          type: 'config',
          msg: '설정 동기화 완료',
          ok: true,
        })
      } catch (e) {
        actions.addSyncLog({
          time: dayjs().format('HH:mm'),
          type: 'config',
          msg: `설정 동기화 실패: ${e.message}`,
          ok: false,
        })
      }
    }, 1500)
  }, [state.members, state.teamLabels, state.calendars]) // eslint-disable-line

  const pages = {
    today: <TodayPage />,
    calendar: <CalendarPage />,
    settings: <SettingsPage />,
    sync: <SyncPage />,
  }

  return (
    <div
      className="relative flex flex-col bg-slate-100 overflow-hidden"
      style={{
        width: '100%',
        maxWidth: 480,
        height: '100dvh',
        margin: '0 auto',
      }}
    >
      {/* 페이지 영역 */}
      <div className="flex-1 overflow-hidden relative">
        {pages[tab]}
      </div>

      {/* 하단 네비게이션 */}
      <NavBar active={tab} onChange={setTab} syncConnected={state.googleConnected} />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <AppInner />
    </StoreProvider>
  )
}
