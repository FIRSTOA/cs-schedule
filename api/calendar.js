import { google } from 'googleapis'

// 서비스 계정 인증
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
}

function getCalendarId() {
  return process.env.VITE_GOOGLE_CALENDAR_ID || 'firstoa8@gmail.com'
}

// 앱 설정(팀원 등)을 저장하는 특수 이벤트의 식별 태그.
// summary와 description 첫 줄에 박혀 있어 다른 이벤트와 구분됨.
const CONFIG_EVENT_TAG = '__APP_CONFIG__'
// 설정 이벤트의 고정 날짜(아주 먼 과거 종일 이벤트로 1건만 유지)
const CONFIG_EVENT_DATE = '2000-01-01'

async function findConfigEvent(calendar, calendarId) {
  // q 파라미터로 태그 텍스트 검색 → 가장 빠르고 안정적
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
  // description은 "__APP_CONFIG__\n<JSON>" 형식
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

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const auth = getAuth()
    const calendar = google.calendar({ version: 'v3', auth })
    const calendarId = getCalendarId()
    const { action } = req.query

    // ── 전체 일정 가져오기 (페이지네이션 + 시간범위) ────────────────────────
    if (req.method === 'GET' && action === 'list') {
      // 과거 6개월 ~ 미래 12개월. 필요시 query로 override 가능.
      const now = new Date()
      const defaultMin = new Date(now)
      defaultMin.setMonth(defaultMin.getMonth() - 6)
      const defaultMax = new Date(now)
      defaultMax.setMonth(defaultMax.getMonth() + 12)
      const timeMin = req.query.timeMin || defaultMin.toISOString()
      const timeMax = req.query.timeMax || defaultMax.toISOString()

      let allItems = []
      let pageToken = undefined
      do {
        const response = await calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          maxResults: 2500,
          singleEvents: true,
          orderBy: 'startTime',
          showDeleted: false,
          ...(pageToken ? { pageToken } : {}),
        })
        allItems = allItems.concat(response.data.items || [])
        pageToken = response.data.nextPageToken
      } while (pageToken)
      // 설정 이벤트는 일반 일정 목록에서 제외
      const filtered = allItems.filter(ev => !(ev.summary || '').includes(CONFIG_EVENT_TAG))
      return res.status(200).json({ events: filtered })
    }

    // ── 앱 설정 가져오기 ──────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'config') {
      const ev = await findConfigEvent(calendar, calendarId)
      if (!ev) return res.status(200).json({ config: null })
      return res.status(200).json({ config: parseConfigDescription(ev.description), eventId: ev.id })
    }

    // ── 앱 설정 저장 (없으면 생성, 있으면 갱신) ─────────────────────────────
    if (req.method === 'PUT' && action === 'config') {
      const payload = req.body || {}
      const ev = await findConfigEvent(calendar, calendarId)
      const body = buildConfigEventBody(payload)
      if (ev) {
        const updated = await calendar.events.update({
          calendarId,
          eventId: ev.id,
          requestBody: body,
        })
        return res.status(200).json({ ok: true, eventId: updated.data.id })
      }
      const created = await calendar.events.insert({
        calendarId,
        requestBody: body,
      })
      return res.status(200).json({ ok: true, eventId: created.data.id })
    }

    // ── 일정 생성 ──────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'create') {
      const event = req.body
      const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
      })
      return res.status(200).json({ event: response.data })
    }

    // ── 일정 수정 ──────────────────────────────────────────────────────────
    if (req.method === 'PUT' && action === 'update') {
      const { eventId, ...event } = req.body
      if (!eventId) return res.status(400).json({ error: 'eventId required' })
      const response = await calendar.events.update({
        calendarId,
        eventId,
        requestBody: event,
      })
      return res.status(200).json({ event: response.data })
    }

    // ── 일정 삭제 ──────────────────────────────────────────────────────────
    if (req.method === 'DELETE' && action === 'delete') {
      const { eventId } = req.query
      if (!eventId) return res.status(400).json({ error: 'eventId required' })
      await calendar.events.delete({ calendarId, eventId })
      return res.status(200).json({ ok: true })
    }

    return res.status(404).json({ error: 'Unknown action' })
  } catch (err) {
    console.error('Calendar API error:', err)
    return res.status(500).json({ error: err.message })
  }
}
