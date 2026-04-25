import { google } from 'googleapis'

// 서비스 계정 인증
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
}

// 환경변수 기본 캘린더 (설정 이벤트 보관처).
// 멀티 캘린더 도입 후에도 __APP_CONFIG__는 이 캘린더 한 곳에만 둠.
function getDefaultCalendarId() {
  return process.env.VITE_GOOGLE_CALENDAR_ID || 'firstoa8@gmail.com'
}

// 앱 설정(팀원/캘린더 등록부 등)을 저장하는 특수 이벤트의 식별 태그.
const CONFIG_EVENT_TAG = '__APP_CONFIG__'
const CONFIG_EVENT_DATE = '2000-01-01'

async function findConfigEvent(calendar, calendarId) {
  const res = await calendar.events.list({
    calendarId,
    q: CONFIG_EVENT_TAG,
    maxResults: 5,
    showDeleted: false,
    singleEvents: true,
  })
  const items = res.data.items || []
  return items.find(e => (e.summary || '').includes(CONFIG_EVENT_TAG)) || null
}

function parseConfigDescription(desc) {
  if (!desc) return {}
  const idx = desc.indexOf('{')
  if (idx === -1) return {}
  try {
    return JSON.parse(desc.slice(idx))
  } catch {
    return {}
  }
}

function buildConfigEventBody(payload) {
  return {
    summary: CONFIG_EVENT_TAG,
    description: `${CONFIG_EVENT_TAG}\n${JSON.stringify(payload)}`,
    start: { date: CONFIG_EVENT_DATE },
    end: { date: CONFIG_EVENT_DATE },
    transparency: 'transparent',
    visibility: 'private',
  }
}

// 단일 캘린더 일정 페치 (페이지네이션 포함). 설정 이벤트는 자동 제외.
async function fetchCalendarEvents(calendar, calId, timeMin, timeMax) {
  let items = []
  let pageToken = undefined
  do {
    const response = await calendar.events.list({
      calendarId: calId,
      timeMin,
      timeMax,
      maxResults: 2500,
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      ...(pageToken ? { pageToken } : {}),
    })
    items = items.concat(response.data.items || [])
    pageToken = response.data.nextPageToken
  } while (pageToken)
  // 각 이벤트에 출처 calendarId 메타 부착
  return items
    .filter(ev => !(ev.summary || '').includes(CONFIG_EVENT_TAG))
    .map(ev => ({ ...ev, _calendarId: calId }))
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const auth = getAuth()
    const calendar = google.calendar({ version: 'v3', auth })
    const defaultCalId = getDefaultCalendarId()
    const { action } = req.query

    // ── 디버그: 서비스 계정이 접근 가능한 캘린더 전체 목록 ────────────────────
    // 응답: { calendars: [{ id, summary, accessRole }, ...] }
    // 코드의 DEFAULT_CALENDARS와 비교해 어떤 캘린더가 실제 공유돼 있는지 확인용.
    if (req.method === 'GET' && action === 'debug-list') {
      const all = []
      let pageToken = undefined
      do {
        const resp = await calendar.calendarList.list({
          maxResults: 250,
          showHidden: true,
          ...(pageToken ? { pageToken } : {}),
        })
        for (const item of resp.data.items || []) {
          all.push({
            id: item.id,
            summary: item.summary,
            accessRole: item.accessRole,
            primary: item.primary || false,
          })
        }
        pageToken = resp.data.nextPageToken
      } while (pageToken)
      return res.status(200).json({
        serviceAccountEmail: (await auth.getCredentials()).client_email,
        count: all.length,
        calendars: all,
      })
    }

    // ── 멀티 캘린더 일정 가져오기 ─────────────────────────────────────────────
    // calendarIds=id1,id2,id3 → 병렬 fetch. 미지정 시 기본 캘린더만.
    if (req.method === 'GET' && action === 'list') {
      const now = new Date()
      const defaultMin = new Date(now)
      defaultMin.setMonth(defaultMin.getMonth() - 6)
      const defaultMax = new Date(now)
      defaultMax.setMonth(defaultMax.getMonth() + 12)
      const timeMin = req.query.timeMin || defaultMin.toISOString()
      const timeMax = req.query.timeMax || defaultMax.toISOString()

      const ids = (req.query.calendarIds || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      const targetIds = ids.length > 0 ? ids : [defaultCalId]

      // 각 캘린더 병렬 fetch — 일부 실패해도 다른 건 진행
      const results = await Promise.allSettled(
        targetIds.map(cid => fetchCalendarEvents(calendar, cid, timeMin, timeMax))
      )
      const events = []
      const errors = []
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          events.push(...r.value)
        } else {
          const reason = r.reason || {}
          // googleapis 에러는 reason.errors[0].reason / reason.code / reason.response?.data?.error 에 상세 정보가 들어있음
          const googleErr = reason.response?.data?.error || {}
          const detail = googleErr.errors?.[0] || reason.errors?.[0] || {}
          errors.push({
            calendarId: targetIds[idx],
            error: reason.message || String(reason),
            code: reason.code || googleErr.code || null,
            reason: detail.reason || null,
            domain: detail.domain || null,
            detailMessage: detail.message || googleErr.message || null,
          })
        }
      })
      return res.status(200).json({ events, errors })
    }

    // ── 앱 설정 가져오기 (기본 캘린더 한 곳에서만) ────────────────────────────
    if (req.method === 'GET' && action === 'config') {
      const ev = await findConfigEvent(calendar, defaultCalId)
      if (!ev) return res.status(200).json({ config: null })
      return res.status(200).json({ config: parseConfigDescription(ev.description), eventId: ev.id })
    }

    // ── 앱 설정 저장 ───────────────────────────────────────────────────────────
    if (req.method === 'PUT' && action === 'config') {
      const payload = req.body || {}
      const ev = await findConfigEvent(calendar, defaultCalId)
      const body = buildConfigEventBody(payload)
      if (ev) {
        const updated = await calendar.events.update({
          calendarId: defaultCalId,
          eventId: ev.id,
          requestBody: body,
        })
        return res.status(200).json({ ok: true, eventId: updated.data.id })
      }
      const created = await calendar.events.insert({
        calendarId: defaultCalId,
        requestBody: body,
      })
      return res.status(200).json({ ok: true, eventId: created.data.id })
    }

    // ── 일정 생성 (대상 캘린더 지정 가능) ─────────────────────────────────────
    if (req.method === 'POST' && action === 'create') {
      const { calendarId: bodyCalId, ...event } = req.body
      const targetId = req.query.calendarId || bodyCalId || defaultCalId
      const response = await calendar.events.insert({
        calendarId: targetId,
        requestBody: event,
      })
      return res.status(200).json({ event: { ...response.data, _calendarId: targetId } })
    }

    // ── 일정 수정 (대상 캘린더 지정 가능) ─────────────────────────────────────
    if (req.method === 'PUT' && action === 'update') {
      const { eventId, calendarId: bodyCalId, ...event } = req.body
      const targetId = req.query.calendarId || bodyCalId || defaultCalId
      if (!eventId) return res.status(400).json({ error: 'eventId required' })
      const response = await calendar.events.update({
        calendarId: targetId,
        eventId,
        requestBody: event,
      })
      return res.status(200).json({ event: { ...response.data, _calendarId: targetId } })
    }

    // ── 일정 삭제 (대상 캘린더 지정 가능) ─────────────────────────────────────
    if (req.method === 'DELETE' && action === 'delete') {
      const { eventId, calendarId: queryCalId } = req.query
      const targetId = queryCalId || defaultCalId
      if (!eventId) return res.status(400).json({ error: 'eventId required' })
      await calendar.events.delete({ calendarId: targetId, eventId })
      return res.status(200).json({ ok: true })
    }

    // ── 일정 이동 (출처 캘린더 → 대상 캘린더) ─────────────────────────────────
    // body: { fromCalendarId, toCalendarId, eventId, eventBody }
    // 1) events.move로 원자적 이동 (eventId 유지) — 같은 서비스 계정 캘린더 간 권장 방식
    // 2) 이동 후 본문(제목/시간/메모/색상 등) 변경분을 update로 반영
    // 실패 시 옛 방식(insert + delete)으로 fallback. insert+delete는 delete 실패 시
    // 옛 캘린더에 잔존 이벤트가 남아 다음 import에 새 일정처럼 잡히는 문제가 있음.
    if (req.method === 'POST' && action === 'move') {
      const { fromCalendarId, toCalendarId, eventId, eventBody } = req.body || {}
      if (!fromCalendarId || !toCalendarId || !eventId || !eventBody) {
        return res.status(400).json({ error: 'fromCalendarId, toCalendarId, eventId, eventBody required' })
      }
      try {
        const moved = await calendar.events.move({
          calendarId: fromCalendarId,
          eventId,
          destination: toCalendarId,
        })
        const updated = await calendar.events.update({
          calendarId: toCalendarId,
          eventId: moved.data.id,
          requestBody: eventBody,
        })
        return res.status(200).json({
          event: { ...updated.data, _calendarId: toCalendarId },
          deleted: true,
          deleteError: null,
        })
      } catch (moveErr) {
        try {
          const created = await calendar.events.insert({
            calendarId: toCalendarId,
            requestBody: eventBody,
          })
          let deleted = true
          let deleteError = null
          try {
            await calendar.events.delete({ calendarId: fromCalendarId, eventId })
          } catch (e) {
            deleted = false
            deleteError = e.message
          }
          return res.status(200).json({
            event: { ...created.data, _calendarId: toCalendarId },
            deleted,
            deleteError,
            moveFallback: moveErr.message,
          })
        } catch (insertErr) {
          return res.status(500).json({
            error: `move 실패 + insert 실패: ${moveErr.message} / ${insertErr.message}`,
          })
        }
      }
    }

    return res.status(404).json({ error: 'Unknown action' })
  } catch (err) {
    console.error('Calendar API error:', err)
    return res.status(500).json({ error: err.message })
  }
}
