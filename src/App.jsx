import { useState, useEffect, useRef, useCallback } from 'react'
import { StoreProvider, useStore } from '@/store/useStore.jsx'
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
  googleEventToSchedule,
} from '@/lib/calendarApi'

const AUTO_SYNC_INTERVAL = 5 * 60 * 1000 // 5분

// 일정 하나를 구글 캘린더에 반영하는 함수
async function pushScheduleToGoogle(s) {
  const workDate = s.workDate || s.date
  const startHour = s.team === 'A' ? 9 : s.team === 'B' ? 12 : s.team === 'C' ? 15 : 18
  const endHour = startHour
  const endMin = 30
  const statusTag = s.status === '완료' ? '[완료] ' : s.status === '특이' ? '[특이] ' : s.status === '진행중' ? '[진행중] ' : ''
  const colorId = s.status === '완료' ? '8' : s.status === '특이' ? '11' : s.status === '진행중' ? '5' : undefined
  const baseTitle = s.member && s.member !== '미배정' ? `${s.member} / ${s.title}` : s.title
  const eventBody = {
    summary: `${statusTag}${baseTitle}`,
    ...(colorId ? { colorId } : {}),
    location: s.location || s.address || '',
    description: [
      s.memo ? `메모: ${s.memo}` : '',
      `팀: ${s.team}팀`,
      `담당자: ${s.member || '미배정'}`,
      `상태: ${s.status || '예정'}`,
      s.phone ? `연락처: ${s.phone}` : '',
    ].filter(Boolean).join('\n'),
    start: {
      dateTime: `${workDate}T${String(startHour).padStart(2, '0')}:00:00+09:00`,
      timeZone: 'Asia/Seoul',
    },
    end: {
      dateTime: `${workDate}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00+09:00`,
      timeZone: 'Asia/Seoul',
    },
  }
  if (s.googleEventId) {
    return { ...s, _updated: true, eventBody }
  } else {
    return { ...s, _created: true, eventBody }
  }
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

  // ── 가져오기 핵심 로직 ────────────────────────────────────────────────────
  const doImport = useCallback(async () => {
    try {
      const events = await fetchAllEvents()
      let nextId = Math.max(...state.schedules.map(s => s.id || 0), 0) + 1
      const mapped = events.map(ev => {
        const s = googleEventToSchedule(ev)
        s.id = s.id || nextId++
        return s
      })
      actions.importFromGoogle(mapped)
      actions.setGoogleConnected(true)
      const now = dayjs()
      actions.addSyncLog({ time: now.format('HH:mm'), type: 'import', msg: `자동 동기화 완료 (${mapped.length}개)`, ok: true })
      return true
    } catch (e) {
      actions.setGoogleConnected(false)
      return false
    }
  }, [state.schedules, actions])

  // ── 반영하기 핵심 로직 ────────────────────────────────────────────────────
  const doExport = useCallback(async (schedules) => {
    const today = dayjs().format('YYYY-MM-DD')
    const targets = schedules.filter(s => (s.workDate || s.date) >= today)
    if (targets.length === 0) return
    let successCount = 0
    let failCount = 0
    const successIds = []
    for (const s of targets) {
      try {
        const workDate = s.workDate || s.date
        const startHour = s.team === 'A' ? 9 : s.team === 'B' ? 12 : s.team === 'C' ? 15 : 18
        const endHour = startHour
        const endMin = 30
        const statusTag = s.status === '완료' ? '[완료] ' : s.status === '특이' ? '[특이] ' : s.status === '진행중' ? '[진행중] ' : ''
        const colorId = s.status === '완료' ? '8' : s.status === '특이' ? '11' : s.status === '진행중' ? '5' : undefined
        // 담당자 이름이 이미 title 앞에 포함된 경우 중복 방지
        const titleAlreadyHasMember = s.member && s.member !== '미배정' && s.title.startsWith(`${s.member} / `)
        const baseTitle = s.member && s.member !== '미배정' && !titleAlreadyHasMember ? `${s.member} / ${s.title}` : s.title
        const eventBody = {
          summary: `${statusTag}${baseTitle}`,
          ...(colorId ? { colorId } : {}),
          location: s.location || s.address || '',
          description: [
            s.memo ? `메모: ${s.memo}` : '',
            `팀: ${s.team}팀`,
            `담당자: ${s.member || '미배정'}`,
            `상태: ${s.status || '예정'}`,
            s.phone ? `연락처: ${s.phone}` : '',
          ].filter(Boolean).join('\n'),
          start: {
            dateTime: `${workDate}T${String(startHour).padStart(2, '0')}:00:00+09:00`,
            timeZone: 'Asia/Seoul',
          },
          end: {
            dateTime: `${workDate}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00+09:00`,
            timeZone: 'Asia/Seoul',
          },
        }
        if (s.googleEventId) {
          await updateEvent(s.googleEventId, eventBody)
          successIds.push(s.id)
        } else {
          const created = await createEvent(eventBody)
          // googleEventId 부여하면서 동시에 localDirty 해제
          actions.updateSchedule({ ...s, googleEventId: created.id, localDirty: false })
        }
        successCount++
      } catch (e) {
        console.error('자동 반영 실패:', s.title, e)
        failCount++
      }
    }
    if (successIds.length > 0) {
      actions.clearLocalDirty(successIds)
    }
    if (successCount > 0) {
      actions.addSyncLog({
        time: dayjs().format('HH:mm'),
        type: 'export',
        msg: `자동 반영 완료 (${successCount}개${failCount > 0 ? `, 실패 ${failCount}개` : ''})`,
        ok: failCount === 0,
      })
    }
  }, [actions])

  // ── 앱 시작 시 최초 동기화 + 5분 자동 동기화 ─────────────────────────────
  useEffect(() => {
    // 최초 가져오기
    doImport().then(() => {
      initialLoadDone.current = true
    })
    // 5분마다 자동 가져오기
    autoSyncTimer.current = setInterval(() => doImport(), AUTO_SYNC_INTERVAL)
    return () => {
      if (autoSyncTimer.current) clearInterval(autoSyncTimer.current)
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
      <NavBar active={tab} onChange={setTab} />
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
