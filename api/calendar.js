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
      return res.status(200).json({ events: allItems })
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
