import { useState, useEffect } from 'react'
import { Loader, Shuffle, Sparkles } from 'lucide-react'
import { useGenerationStore } from '../store/generationStore'
import { generateIdeas } from '../lib/api'

export default function GenerateForm({ onSubmit, isLoading }) {
  const {
    hook, niche,
    setHook,
  } = useGenerationStore()

  const [diceLoading, setDiceLoading]       = useState(false)
  const [improveLoading, setImproveLoading] = useState(false)
  const [diceHover, setDiceHover]           = useState(false)
  const [improveHover, setImproveHover]     = useState(false)
  const [hookExamples, setHookExamples]     = useState([])

  useEffect(() => {
    generateIdeas({ niche: niche || 'Motivational' })
      .then(ideas => {
        if (Array.isArray(ideas) && ideas.length > 0) {
          const shuffled = [...ideas].sort(() => Math.random() - 0.5)
          setHookExamples(shuffled.slice(0, 3))
        }
      })
      .catch(() => {}) // silent — keep static fallback
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  async function handleRandomHook() {
    if (diceLoading) return
    setDiceLoading(true)
    try {
      const result = await generateIdeas({ niche })
      if (result && result.length > 0) setHook(result[0])
    } catch {
      // silent
    } finally {
      setDiceLoading(false)
    }
  }

  async function handleImproveHook() {
    if (improveLoading || !hook.trim()) return
    setImproveLoading(true)
    try {
      const result = await generateIdeas({ niche, seed: hook.trim().slice(0, 60) })
      if (result && result.length > 0) setHook(result[0])
    } catch {
      // silent
    } finally {
      setImproveLoading(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Cinematic prompt container ── */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 24,
        padding: 28,
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
        position: 'relative',
      }}>

        {/* Top row: label + dice button */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}>
          <button
            type="button"
            onClick={handleRandomHook}
            disabled={diceLoading}
            onMouseEnter={() => setDiceHover(true)}
            onMouseLeave={() => setDiceHover(false)}
            title="Generate random hook"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 8,
              border: 'none',
              background: diceHover ? '#F3F4F6' : 'transparent',
              cursor: diceLoading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s, opacity 0.15s',
              opacity: diceLoading ? 0.4 : diceHover ? 1 : 0.55,
              flexShrink: 0,
            }}
          >
            {diceLoading
              ? <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: '#6B7280' }} />
              : <Shuffle size={14} color="#374151" />
            }
          </button>
        </div>

        {/* Textarea */}
        <textarea
          value={hook}
          onChange={e => setHook(e.target.value)}
          placeholder="Write your hook or paste a quote..."
          rows={5}
          required
          minLength={10}
          className="prompt-textarea"
          style={{
            width: '100%',
            minHeight: 120,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            padding: 0,
            color: '#111111',
            fontFamily: 'var(--font-sans)',
            fontSize: 18,
            lineHeight: 1.7,
            fontWeight: 400,
            boxSizing: 'border-box',
          }}
        />

        {/* Inspiration examples */}
        {!hook.trim() && (
          <div style={{ marginTop: 16 }}>
            {hookExamples.map((ex, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setHook(ex.replace(/^"|"$/g, ''))}
                style={{
                  display: 'block',
                  background: 'none',
                  border: 'none',
                  padding: '3px 0',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 14,
                  color: '#9CA3AF',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                  lineHeight: 1.6,
                  borderRadius: 0,
                  margin: '0',
                  width: 'calc(100% + 16px)',
                  marginLeft: -8,
                  paddingLeft: 8,
                  paddingRight: 8,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = '#111111'
                  e.currentTarget.style.background = '#F3F4F6'
                  e.currentTarget.style.borderRadius = '6px'
                  e.currentTarget.style.padding = '4px 8px'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = '#9CA3AF'
                  e.currentTarget.style.background = 'none'
                  e.currentTarget.style.borderRadius = '0'
                  e.currentTarget.style.padding = '3px 8px'
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: '#F3F4F6', margin: '20px 0 0' }} />

        {/* Bottom utility row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 14,
        }}>
          <button
            type="button"
            onClick={handleImproveHook}
            disabled={improveLoading || !hook.trim()}
            onMouseEnter={() => setImproveHover(true)}
            onMouseLeave={() => setImproveHover(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: (improveLoading || !hook.trim()) ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 500,
              color: improveLoading
                ? '#C4C9D4'
                : !hook.trim()
                  ? '#D1D5DB'
                  : improveHover
                    ? '#111111'
                    : '#9CA3AF',
              transition: 'color 0.15s',
            }}
          >
            {improveLoading
              ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : <Sparkles size={12} />
            }
            Improve hook
          </button>

          <span style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: hook.length > 400 ? '#DC2626' : '#C4C9D4',
            transition: 'color 0.15s',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {hook.length > 0 ? `${hook.length} chars` : ''}
          </span>
        </div>
      </div>

      {/* ── Continue button ── */}
      <div className="generate-sticky-footer">
      <button
        type="submit"
        disabled={isLoading || hook.trim().length < 10}
        className={`btn-generate${isLoading ? ' btn-generating' : ''}`}
        style={{
          width: '100%',
          height: 56,
          background: hook.trim().length < 10 && !isLoading ? '#D1D5DB' : '#DC2626',
          border: 'none',
          borderRadius: 12,
          color: '#FFFFFF',
          fontFamily: 'var(--font-sans)',
          fontSize: 16,
          fontWeight: 600,
          cursor: (isLoading || hook.trim().length < 10) ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s ease, box-shadow 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
        onMouseEnter={e => {
          if (!isLoading && hook.trim().length >= 10) {
            e.currentTarget.style.background = '#B91C1C'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(220,38,38,0.2)'
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = hook.trim().length < 10 && !isLoading ? '#D1D5DB' : '#DC2626'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {isLoading
          ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
          : 'Continue →'
        }
      </button>
      </div>

    </form>
  )
}
