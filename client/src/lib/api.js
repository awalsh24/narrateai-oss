const BASE = (import.meta.env.VITE_API_URL || '') + '/api'

// Single-user local mode: the backend attributes every request to the one
// configured user, so no auth token is needed.
export function authHeader() {
  return {}
}

// ── Generation ────────────────────────────────────────────────

export async function submitGenerate({ hook, niche, voice, captionStyle, musicMood, videoLength, preGeneratedNarration, preGeneratedBeats }) {
  const res = await fetch(`${BASE}/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body:    JSON.stringify({ hook, niche, voice, captionStyle, musicMood, videoLength, preGeneratedNarration, preGeneratedBeats }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()   // { jobId, status, pollUrl }
}

export async function fetchJobStatus(jobId) {
  const res = await fetch(`${BASE}/generate/${jobId}`, { headers: authHeader() })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()   // { jobId, status, progress, result, failedReason }
}

export async function generateScript({ hook, niche, format, voice, captionStyle, musicMood, videoLength }) {
  const res = await fetch(`${BASE}/generate-script`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body:    JSON.stringify({ hook, niche, format, voice, captionStyle, musicMood, videoLength }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()   // { narration, structure, beats }
}

export async function generateIdeas({ niche, seed }) {
  const res = await fetch(`${BASE}/generate-ideas`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body:    JSON.stringify({ niche, seed }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()   // string[]
}

// ── Video history ─────────────────────────────────────────────

export async function fetchVideos() {
  const res = await fetch(`${BASE}/videos`, { headers: authHeader() })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()   // Video[]
}

// ── Social content ────────────────────────────────────────────

export async function generateSocialContent({ narration, niche, hook, jobId }) {
  const res = await fetch(`${BASE}/generate-social`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ hook, niche, narration: narration?.slice(0, 400), jobId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}
