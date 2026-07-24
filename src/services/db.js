const { createClient } = require('@supabase/supabase-js')

let _supabase = null

function getSupabase() {
  if (_supabase) return _supabase
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
  }
  _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
  return _supabase
}

// ── Video records ─────────────────────────────────────────────

async function createVideoRecord(jobId, userId, metadata) {
  const { error } = await getSupabase()
    .from('videos')
    .insert({
      job_id:        String(jobId),
      user_id:       userId,
      niche:         metadata.niche ?? null,
      hook:          metadata.hook  ?? null,
      voice:         metadata.voice ?? null,
      caption_style: metadata.captionStyle ?? null,
      status:        'queued',
    })
  if (error) throw error
}

async function updateVideoRecord(jobId, updates) {
  const { error } = await getSupabase()
    .from('videos')
    .update(updates)
    .eq('job_id', String(jobId))
  if (error) console.error('[db] updateVideoRecord error:', error.message)
}

// ── Video list ────────────────────────────────────────────────

async function getVideosByUser(userId) {
  const { data, error } = await getSupabase()
    .from('videos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

async function recordClipUsage(filename, userId) {
  try {
    const { error } = await getSupabase()
      .from('clip_usage')
      .insert({ filename, user_id: userId })
    if (error) console.warn('[db] recordClipUsage error:', error.message)
  } catch (err) {
    console.warn('[db] recordClipUsage failed:', err.message)
  }
}

async function getRecentClipUsage(userId) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await getSupabase()
      .from('clip_usage')
      .select('filename')
      .eq('user_id', userId)
      .gte('used_at', since)
    if (error) {
      console.warn('[db] getRecentClipUsage error:', error.message)
      return {}
    }
    const freq = {}
    for (const row of data || []) {
      freq[row.filename] = (freq[row.filename] || 0) + 1
    }
    return freq
  } catch (err) {
    console.warn('[db] getRecentClipUsage failed:', err.message)
    return {}
  }
}

module.exports = {
  createVideoRecord,
  updateVideoRecord,
  getVideosByUser,
  recordClipUsage,
  getRecentClipUsage,
}
