import { useState, useEffect, useRef } from 'react'
import { useSidebar } from '../store/sidebarContext'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, Video, Play, Square, Loader, Check, Copy, X } from 'lucide-react'
import { useGenerationStore } from '../store/generationStore'
import { submitGenerate, fetchJobStatus, generateScript, generateSocialContent, authHeader } from '../lib/api'
import GenerateForm from '../components/GenerateForm'
import ProgressTracker from '../components/ProgressTracker'
import { usePostHog } from '@posthog/react'

export default function Generate() {
  const [searchParams] = useSearchParams()

  const {
    hook, niche, format, voice, musicMood, captionStyle, videoLength,
    jobId, status, progress, result, error, script,
    startGeneratingScript, setScriptReview, goToNicheLength, goBackToNicheLength,
    startSubmitting, setJobId, setProgress, setCompleted, setFailed, reset,
  } = useGenerationStore()

  const posthog = usePostHog()

  // Mutation 1: Generate script (synchronous GPT call, no queue)
  const scriptMutation = useMutation({
    mutationFn: generateScript,
    onMutate:   () => startGeneratingScript(),
    onSuccess:  (data) => {
      posthog?.capture('script_generated', { niche, voice, video_length: videoLength, music_mood: musicMood, caption_style: captionStyle })
      if (format === 'single_quote') {
        // single_quote has no editable script — go straight to render
        startSubmitting()
        submitMutation.mutate({
          hook,
          niche,
          format,
          voice:                 voice || 'onyx',
          captionStyle,
          musicMood,
          videoLength,
          preGeneratedNarration: data.narration,
          preGeneratedBeats:     data.beats,
        })
      } else {
        setScriptReview(data)
      }
    },
    onError:    (err)  => {
      posthog?.captureException(err)
      setFailed(err.message)
    },
  })

  // Mutation 2: Submit video job to queue
  const submitMutation = useMutation({
    mutationFn: submitGenerate,
    onMutate:   () => startSubmitting(),
    onSuccess:  (data) => {
      setJobId(data.jobId)
    },
    onError:    (err) => {
      posthog?.captureException(err)
      setFailed(err.message)
    },
  })

  // Poll every 2s while a job is in-flight
  const { data: pollData, error: pollError } = useQuery({
    queryKey: ['job', jobId],
    queryFn:  () => fetchJobStatus(jobId),
    enabled:  !!jobId && status === 'polling',
    refetchInterval: (query) => {
      const s = query.state.data?.status
      return (s === 'completed' || s === 'failed') ? false : 2000
    },
  })

  useEffect(() => {
    if (!pollData) return
    setProgress(pollData.progress ?? 0)
    if (pollData.status === 'completed') {
      posthog?.capture('video_completed', { niche, voice, video_length: videoLength, job_id: jobId })
      setCompleted({ ...pollData.result, jobId })
    } else if (pollData.status === 'failed') {
      posthog?.capture('video_generation_failed', { niche, voice, video_length: videoLength, job_id: jobId, reason: pollData.failedReason })
      setFailed(pollData.failedReason || 'Job failed')
    }
  }, [pollData, setProgress, setCompleted, setFailed, posthog, niche, voice, videoLength, jobId])

  useEffect(() => {
    if (pollError) setFailed(pollError.message)
  }, [pollError, setFailed])

  useEffect(() => {
    if (searchParams.get('preview') === 'completed' && import.meta.env.VITE_R2_PUBLIC_URL) {
      setCompleted({
        videoUrl: `${import.meta.env.VITE_R2_PUBLIC_URL.replace(/\/$/, '')}/videos/28.mp4`,
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleGenerateScript() {
    posthog?.capture('hook_submitted', { hook_length: hook.length, niche })
    goToNicheLength()
  }

  function handleConfirmNicheLength() {
    if (format === 'single_quote') {
      submitMutation.mutate({
        hook, niche, format, voice: voice || 'onyx', captionStyle, musicMood, videoLength,
        preGeneratedNarration: hook,
        preGeneratedBeats:     [],
      })
      return
    }
    scriptMutation.mutate({ hook, niche, format, voice, captionStyle, musicMood, videoLength })
  }

  function handleRenderVideo({ narration, beats }) {
    posthog?.capture('video_render_started', { niche, voice, video_length: videoLength, music_mood: musicMood, caption_style: captionStyle })
    submitMutation.mutate({
      hook,
      niche,
      format,
      voice:                 voice || 'onyx',
      captionStyle,
      musicMood,
      videoLength,
      preGeneratedNarration: narration,
      preGeneratedBeats:     beats,
    })
  }

  // Derive local stage from Zustand status
  const stage =
    status === 'submitting' || status === 'polling' ? 'generating_video' :
    status === 'completed'                          ? 'video_ready'      :
    status  // idle | generating_script | script_review | failed

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

    <div
      className="generate-scroll-area"
      style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--bg-page)',
        padding: '48px 24px 80px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 960 }}>

        {(stage === 'idle' || stage === 'niche_length') && (
          <IdleCanvas
            onSubmit={handleGenerateScript}
            onOpenSettings={goToNicheLength}
          />
        )}

        {stage === 'niche_length' && (
          <NicheLengthStep
            onBack={reset}
            onConfirm={handleConfirmNicheLength}
          />
        )}

        {stage === 'generating_script' && <GeneratingScriptView />}

        {stage === 'script_review' && (
          <ScriptReview
            script={script}
            onBack={goBackToNicheLength}
            onRender={handleRenderVideo}
          />
        )}

        {stage === 'generating_video' && (
          <GeneratingView progress={progress} status={status} />
        )}

        {stage === 'video_ready' && result && (
          <CompletedView result={result} onReset={reset} />
        )}

        {stage === 'failed' && (
          <FailedView error={error} onReset={reset} />
        )}

      </div>
    </div>
    </div>
  )
}

// ── Hook pool + idle canvas ───────────────────────────────────

const HOOK_POOL = [
  "The obstacle is the way. Every wall you hit is the path forward in disguise.",
  "Discipline is choosing what you want most over what you want now.",
  "The cave you fear to enter holds the treasure you seek.",
  "Your body can handle almost anything. It is your mind you have to convince.",
  "Pain is temporary. The version of yourself you are becoming is permanent.",
  "He who has a why to live can bear almost any how.",
  "We are what we repeatedly do. Excellence is not an act but a habit.",
  "The unexamined life is not worth living. What are you doing with yours.",
  "Stop waiting for the perfect moment. The perfect moment is the one where you decide to begin.",
  "Every rep you do when you do not want to is the rep that changes everything.",
  "Somewhere out there a civilization is looking up at their sky and wondering if they are alone.",
  "We are made of star stuff. Every atom in your body was forged in the heart of a dying star.",
  "The Navy SEAL rule for eliminating procrastination.",
  "The morning routine that built mental toughness.",
  "Why discipline beats motivation every single time.",
  "The Stoic method for turning setbacks into fuel.",
  "What Marcus Aurelius did every morning before the world woke up.",
  "The one rule Kobe Bryant never broke.",
  "Most people overestimate what they can do in a day and underestimate what they can do in a decade.",
  "You have power over your mind not outside events. Realize this and you will find strength.",
  "Waste no more time arguing about what a good man should be. Be one.",
  "The only difference between where you are and where you want to be is the work you are willing to do.",
  "Hard times create strong men. Strong men create good times.",
  "Do not pray for an easy life. Pray for the strength to endure a difficult one.",
  "The man who loves walking will walk further than the man who loves the destination.",
  "Comfort is the enemy of progress.",
  "Iron sharpens iron. Surround yourself accordingly.",
  "You do not rise to the level of your goals. You fall to the level of your systems.",
  "The universe is under no obligation to make sense to you. Go figure it out anyway.",
  "What you do in the dark is what puts you in the light.",
]

const ROTATING_SUBTITLES = [
  "Create cinematic faceless videos from any idea",
  "Turn a quote into a cinematic short",
  "Build a workout montage in minutes",
  "One idea. Real footage. Publish ready.",
  "Stoic wisdom. Cinematic cuts. No copyright.",
]

function RotatingSubtitle() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % ROTATING_SUBTITLES.length)
        setVisible(true)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <p style={{
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      fontWeight: 400,
      color: '#ebebeb',
      margin: '0 0 40px',
      textAlign: 'center',
      height: 24,
      transition: 'opacity 300ms ease, transform 300ms ease',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(6px)',
    }}>
      {ROTATING_SUBTITLES[index]}
    </p>
  )
}

const TYPEWRITER_PROMPTS = [
  "The obstacle is the way...",
  "Why discipline beats motivation every time...",
  "The morning routine David Goggins swears by...",
  "We are what we repeatedly do...",
  "The Navy SEAL rule for beating procrastination...",
  "Pain is temporary. Quitting lasts forever...",
]

function useTypewriter(prompts) {
  const [displayed, setDisplayed] = useState('')
  const [promptIndex, setPromptIndex] = useState(0)
  const [phase, setPhase] = useState('typing')

  useEffect(() => {
    const current = prompts[promptIndex]

    if (phase === 'typing') {
      if (displayed.length < current.length) {
        const t = setTimeout(() => setDisplayed(current.slice(0, displayed.length + 1)), 55)
        return () => clearTimeout(t)
      } else {
        const t = setTimeout(() => setPhase('erasing'), 1800)
        return () => clearTimeout(t)
      }
    }

    if (phase === 'erasing') {
      if (displayed.length > 0) {
        const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 28)
        return () => clearTimeout(t)
      } else {
        const t = setTimeout(() => {
          setPromptIndex(i => (i + 1) % prompts.length)
          setPhase('typing')
        }, 0)
        return () => clearTimeout(t)
      }
    }
  }, [displayed, phase, promptIndex, prompts])

  return displayed
}

function IdleCanvas({ onSubmit, onOpenSettings }) {
  const { hook, setHook } = useGenerationStore()
  const textareaRef = useRef(null)
  const canvasRef = useRef(null)
  const typedPlaceholder = useTypewriter(TYPEWRITER_PROMPTS)
  const { setSidebarCollapsed } = useSidebar()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const particles = []
    const COUNT = 80

    function resize() {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.5,
        speed: Math.random() * 0.4 + 0.1,
        opacity: Math.random() * 0.4 + 0.05,
      })
    }

    let raf
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${p.opacity})`
        ctx.fill()
        p.y -= p.speed
        if (p.y < -4) {
          p.y = canvas.height + 4
          p.x = Math.random() * canvas.width
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const [exampleLines] = useState(() => {
    const shuffled = [...HOOK_POOL].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, 3)
  })

  const [shuffleIndex, setShuffleIndex] = useState(null)

  function handleShuffle() {
    const available = HOOK_POOL.filter((_, i) => i !== shuffleIndex)
    const next = available[Math.floor(Math.random() * available.length)]
    const nextIndex = HOOK_POOL.indexOf(next)
    setHook(next)
    setShuffleIndex(nextIndex)
  }

  function handleExampleClick(text) {
    setHook(text)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && hook.trim()) {
      onSubmit()
    }
  }

  return (
    <div style={{ position: 'relative', minHeight: 'calc(100vh - 48px)' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
      />
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        minHeight: 'calc(100vh - 48px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px 80px',
      }}
    >
      {/* App title */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <h1 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 48,
          fontWeight: 300,
          color: '#ffffff',
          margin: 0,
          letterSpacing: '-0.02em',
        }}>
          NarrateAI
        </h1>
      </div>

      {/* Subtitle */}
      <RotatingSubtitle />

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <div style={{
          height: 34,
          paddingInline: 16,
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(255,255,255,0.10)',
          color: '#e0e0e0',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          cursor: 'default',
          userSelect: 'none',
        }}>
          Single video
        </div>
        <div style={{
          height: 34,
          paddingInline: 16,
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.06)',
          background: 'transparent',
          color: '#333333',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'default',
          userSelect: 'none',
        }}>
          Bulk video
          <span style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#444',
          }}>
            Soon
          </span>
        </div>
      </div>

      {/* Prompt box */}
      <div style={{ width: '100%', maxWidth: 680, position: 'relative' }}>
        <div
          style={{
            position: 'relative',
            background: '#111111',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 18,
            transition: 'border-color 150ms ease',
          }}
          onFocusCapture={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.30)' }}
          onBlurCapture={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)' }}
        >
          <textarea
            ref={textareaRef}
            value={hook}
            onChange={e => setHook(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setSidebarCollapsed(true)}
            className="prompt-textarea"
            style={{
              width: '100%',
              minHeight: 72,
              maxHeight: 240,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: '20px 96px 20px 20px',
              fontFamily: 'var(--font-sans)',
              fontSize: 15,
              color: 'var(--text-primary)',
              lineHeight: 1.6,
              boxSizing: 'border-box',
              display: 'block',
              overflowY: 'auto',
            }}
          />
          {!hook && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              padding: '20px 96px 20px 20px',
              fontFamily: 'var(--font-sans)',
              fontSize: 15,
              color: '#ebebeb',
              lineHeight: 1.6,
              pointerEvents: 'none',
              userSelect: 'none',
            }}>
              {typedPlaceholder}
              <span style={{
                display: 'inline-block',
                width: 2,
                height: '1em',
                background: '#ebebeb',
                marginLeft: 1,
                verticalAlign: 'text-bottom',
                animation: 'blink-cursor 1s step-end infinite',
              }} />
            </div>
          )}

          {/* Shuffle button */}
          <button
            type="button"
            onClick={handleShuffle}
            title="Shuffle prompt"
            style={{
              position: 'absolute',
              right: 52,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: '#444',
              transition: 'color 150ms',
              borderRadius: 6,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#888' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#444' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8"/>
              <line x1="4" y1="20" x2="21" y2="3"/>
              <polyline points="21 16 21 21 16 21"/>
              <line x1="15" y1="15" x2="21" y2="21"/>
            </svg>
          </button>

          {/* Submit arrow */}
          <button
            type="button"
            onClick={() => { if (hook.trim()) onSubmit() }}
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 38,
              height: 38,
              borderRadius: 999,
              background: 'var(--cta-bg)',
              border: 'none',
              cursor: hook.trim() ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: hook.trim() ? 1 : 0.25,
              transition: 'opacity 150ms, transform 120ms',
              flexShrink: 0,
            }}
            onMouseEnter={e => { if (hook.trim()) e.currentTarget.style.transform = 'translateY(-50%) scale(1.06)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(-50%) scale(1)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cta-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>

        {/* Micro-toolbar */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            title="Style settings"
            onClick={onOpenSettings}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ebebeb',
              transition: 'border-color 150ms, background 150ms, color 150ms',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
              e.currentTarget.style.color = '#ffffff'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              e.currentTarget.style.color = '#ebebeb'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
          </button>
        </div>

        {/* Example hooks */}
        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: '#ebebeb',
            textAlign: 'center',
            margin: '0 0 4px',
          }}>
            Try one
          </p>
          {exampleLines.map((line, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleExampleClick(line)}
              style={{
                background: 'none',
                border: 'none',
                padding: '4px 0',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: '#ebebeb',
                lineHeight: 2,
                textAlign: 'center',
                display: 'block',
                width: '100%',
                transition: 'color 150ms',
                textDecoration: 'none',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = '#ebebeb'
                e.currentTarget.style.textDecoration = 'underline'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = '#ebebeb'
                e.currentTarget.style.textDecoration = 'none'
              }}
            >
              {line}
            </button>
          ))}
        </div>
      </div>
    </div>
    </div>
  )
}

// ── Animated ellipsis helper ──────────────────────────────────

function AnimatedEllipsis() {
  const [dots, setDots] = useState('')
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500)
    return () => clearInterval(id)
  }, [])
  return <span style={{ display: 'inline-block', minWidth: 22, textAlign: 'left' }}>{dots}</span>
}

// ── Generating script stage ───────────────────────────────────

function GeneratingScriptView() {
  return (
    <div className="animate-fade-in" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'center',
      minHeight: 360,
    }}>
      <h1 style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'clamp(28px, 5vw, 48px)',
        fontWeight: 700,
        color: '#ffffff',
        margin: '0 0 16px',
        letterSpacing: '-0.04em',
        lineHeight: 1.05,
      }}>
        Writing your story<AnimatedEllipsis />
      </h1>
      <p style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 16,
        color: '#ebebeb',
        margin: 0,
        lineHeight: 1.6,
      }}>
        Crafting your script...
      </p>
    </div>
  )
}

// ── Script review stage ───────────────────────────────────────

function ScriptReview({ script, onBack, onRender }) {
  const [beats, setBeats] = useState(() => script?.beats || [])

  function updateBeatNarration(beatIndex, value) {
    setBeats(prev => prev.map((b, i) => i === beatIndex ? { ...b, narration: value } : b))
  }

  function handleRender() {
    const narration = beats
      .filter(b => b.type !== 'flash' && b.narration)
      .map(b => b.narration)
      .join(' ')
    onRender({
      narration: narration || script?.narration || '',
      beats,
    })
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 40,
          fontWeight: 700,
          color: '#ffffff',
          margin: '0 0 12px',
          letterSpacing: '-0.04em',
          lineHeight: 1.05,
        }}>
          Review your script
        </h1>
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 16,
          color: '#ebebeb',
          margin: 0,
          lineHeight: 1.6,
        }}>
          Edit any section before rendering your video.
        </p>
      </div>

      {/* Card */}
      <div style={{
        background: '#0f0f0f',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 32,
        boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {beats.map((beat, idx) => {
            const isFlash = beat.type === 'flash'
            const label   = beat.label || beat.type.toUpperCase()
            const hint    = beat.hint  || ''

            if (isFlash) {
              return (
                <div
                  key={idx}
                  style={{
                    background: '#111111',
                    borderRadius: 10,
                    padding: '12px 18px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#fff',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>
                    ⚡ {label}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    color: '#9CA3AF',
                  }}>
                    {hint || 'flash cuts — no narration'}
                  </span>
                </div>
              )
            }

            return (
              <div
                key={idx}
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10,
                  padding: '14px 18px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#ebebeb',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                    {label}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    color: '#ebebeb',
                  }}>
                    {hint}
                  </span>
                </div>
                <textarea
                  value={beat.narration || ''}
                  onChange={e => updateBeatNarration(idx, e.target.value)}
                  placeholder={`Write the ${label.toLowerCase()} section...`}
                  rows={3}
                  style={{
                    width: '100%',
                    background: '#0d0d0d',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    color: '#ebebeb',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 14,
                    lineHeight: 1.7,
                    resize: 'vertical',
                    outline: 'none',
                    transition: 'border-color 0.15s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e  => { e.target.style.borderColor = 'rgba(255,255,255,0.22)' }}
                  onBlur={e   => { e.target.style.borderColor = 'rgba(255,255,255,0.08)' }}
                />
              </div>
            )
          })}
        </div>

        <VisualPlan beats={beats} />

        <div className="script-review-actions" style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              flex: 1,
              height: 52,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 12,
              color: '#ebebeb',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'
              e.currentTarget.style.color = '#ffffff'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'
              e.currentTarget.style.color = '#ebebeb'
            }}
          >
            ← Back to settings
          </button>
          <button
            type="button"
            onClick={handleRender}
            style={{
              flex: 2,
              height: 52,
              background: 'var(--cta-bg)',
              border: 'none',
              borderRadius: 12,
              color: 'var(--cta-text)',
              fontFamily: 'var(--font-sans)',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            Render video →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Visual plan — renders actual beat data ────────────────────

function VisualPlan({ beats = [] }) {
  const [open, setOpen] = useState(false)

  function formatDuration(beat) {
    if (beat.type === 'flash') {
      return `${beat.clip_count}×${beat.clip_duration}s`
    }
    return `${(beat.clip_count * beat.clip_duration).toFixed(1)}s`
  }

  return (
    <div style={{
      marginTop: 16,
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '11px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          fontWeight: 500,
          color: '#555',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          textAlign: 'left',
        }}
      >
        <span style={{
          display: 'inline-block',
          transition: 'transform 0.15s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 9,
        }}>
          ▸
        </span>
        Visual plan
      </button>

      {open && (
        <div className="animate-fade-in" style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
          }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                {['Beat', 'Duration', 'Clip type'].map(h => (
                  <th key={h} style={{
                    padding: '8px 16px',
                    textAlign: 'left',
                    color: '#555',
                    fontWeight: 500,
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {beats.map((beat, i) => (
                <tr key={i}>
                  <td style={{ padding: '9px 16px', color: '#aaa', borderBottom: i < beats.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', fontSize: 12, whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {(beat.label || beat.type || '').toUpperCase()}
                  </td>
                  <td style={{ padding: '9px 16px', color: '#666', borderBottom: i < beats.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', whiteSpace: 'nowrap' }}>
                    {formatDuration(beat)}
                  </td>
                  <td style={{ padding: '9px 16px', color: '#666', borderBottom: i < beats.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', whiteSpace: 'nowrap' }}>
                    {beat.hint || beat.mood || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Video generating stage ────────────────────────────────────

function GeneratingView({ progress, status }) {
  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: 40 }}>
        <h1 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 40,
          fontWeight: 700,
          color: '#ffffff',
          margin: '0 0 16px',
          letterSpacing: '-0.04em',
          lineHeight: 1.05,
        }}>
          Rendering your video
        </h1>
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 16,
          color: '#ebebeb',
          margin: 0,
          lineHeight: 1.6,
        }}>
          Scenes are being scored, voiced, and cut. Usually 2–4 minutes.
        </p>
      </div>

      <div style={{
        height: 3,
        background: '#1a1a1a',
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 32,
      }}>
        <div
          className={status === 'polling' ? 'progress-shimmer' : ''}
          style={{
            height: '100%',
            width: `${progress}%`,
            background: status === 'polling' ? undefined : '#DC2626',
            borderRadius: 2,
            transition: 'width 0.8s ease',
          }}
        />
      </div>

      <ProgressTracker progress={progress} status={status} />
    </div>
  )
}

// ── Completed / video ready stage ─────────────────────────────

function CompletedView({ result, onReset }) {
  const initialVideoUrl = result.videoUrl
  const isLocal  = initialVideoUrl && !initialVideoUrl.startsWith('http')
  const { hook, niche, script, jobId } = useGenerationStore()
  const narration = script?.narration || result?.narration || ''
  const [downloading, setDownloading] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const posthog = usePostHog()

  // Edit style state
  const baseVideoUrl   = result.baseVideoUrl   || null
  const timestampsUrl  = result.timestampsUrl  || null
  const initialStyle   = result.captionStyle   || 'clean'
  const [currentVideoUrl, setCurrentVideoUrl] = useState(initialVideoUrl)
  const [activeStyle, setActiveStyle]         = useState(initialStyle)
  const [selectedStyle, setSelectedStyle]     = useState(initialStyle)
  const [reRenderLoading, setReRenderLoading] = useState(false)
  const [reRenderError, setReRenderError]     = useState(null)
  const canEditStyle = !isLocal && !!baseVideoUrl && !!timestampsUrl

  const videoUrl = currentVideoUrl

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  function slugify(text) {
    return (text || '')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .join('-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'narrateai-video'
  }

  async function handleDownload() {
    if (downloading) return
    setDownloading(true)
    posthog?.capture('video_downloaded', { niche, source: 'generate_page' })

    const filename = slugify(hook) || 'narrateai-video'

    try {
      const BASE = import.meta.env.VITE_API_URL || ''
      const proxyUrl = `${BASE}/api/download?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(filename)}`
      const response = await fetch(proxyUrl, {
        headers: { ...authHeader() },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename + '.mp4'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
    } catch (err) {
      console.error('[download] failed:', err.message)
      // Last resort fallback
      window.location.href = videoUrl
    } finally {
      setDownloading(false)
    }
  }

  async function handleReCaption() {
    if (reRenderLoading || selectedStyle === activeStyle) return
    setReRenderLoading(true)
    setReRenderError(null)
    try {
      const BASE = import.meta.env.VITE_API_URL || ''
      const resp = await fetch(`${BASE}/api/re-caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          baseVideoUrl,
          timestampsUrl,
          captionStyle: selectedStyle,
          jobId: result.jobId,
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${resp.status}`)
      }
      const { videoUrl: newUrl } = await resp.json()
      setCurrentVideoUrl(newUrl)
      setActiveStyle(selectedStyle)
    } catch (err) {
      setReRenderError(err.message || 'Re-render failed')
    } finally {
      setReRenderLoading(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <h1 style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'clamp(24px, 3vw, 36px)',
        fontWeight: 700,
        color: '#ffffff',
        margin: '0 0 28px 0',
        letterSpacing: '-0.04em',
        lineHeight: 1.05,
      }}>
        Your video is ready
      </h1>

      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 24 : 40,
        alignItems: 'flex-start',
        width: '100%',
      }}>
        {/* Left column — video + buttons */}
        <div style={{ width: isMobile ? '100%' : 300, flexShrink: 0 }}>
          {/* 9:16 video frame */}
          <div style={{
            position: 'relative',
            paddingBottom: '177.78%',
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
            background: '#000',
          }}>
            {isLocal ? (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 10,
              }}>
                <Video size={28} color="#9CA3AF" />
                <span style={{
                  fontFamily: 'var(--font-sans)', fontSize: 11,
                  color: '#9CA3AF', textAlign: 'center', padding: '0 20px',
                }}>
                  Video saved locally — upload to R2 to preview here
                </span>
              </div>
            ) : (
              <video
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                src={videoUrl}
                controls
                autoPlay
                muted
                loop
                playsInline
              />
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button
              onClick={isLocal || downloading ? undefined : handleDownload}
              disabled={isLocal || downloading}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 44,
                background: isLocal ? 'rgba(255,255,255,0.05)' : 'var(--cta-bg)',
                border: isLocal ? '1px solid rgba(255,255,255,0.08)' : 'none',
                borderRadius: 10,
                color: isLocal ? '#555' : 'var(--cta-text)',
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                fontWeight: 600,
                cursor: isLocal ? 'not-allowed' : 'pointer',
                opacity: isLocal ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { if (!isLocal) e.currentTarget.style.opacity = '0.88' }}
              onMouseLeave={e => { if (!isLocal) e.currentTarget.style.opacity = '1' }}
            >
              <Download size={14} />
              {downloading ? 'Downloading...' : 'Download'}
            </button>

            <button
              onClick={onReset}
              style={{
                flex: 1,
                height: 44,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10,
                color: '#ebebeb',
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'
                e.currentTarget.style.color = '#ffffff'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'
                e.currentTarget.style.color = '#ebebeb'
              }}
            >
              New video →
            </button>
          </div>

          {/* Edit style panel */}
          {canEditStyle && (
            <div style={{
              marginTop: 16,
              background: '#111111',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              padding: '14px 16px',
            }}>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                fontWeight: 600,
                color: '#ebebeb',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 10,
              }}>
                Edit style
              </div>

              {/* Compact style selector */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                {['clean', 'bold', 'cinematic', 'glow'].map(s => {
                  const labels = { clean: 'Clean', bold: 'Bold', cinematic: 'Cinematic', glow: 'Glow' }
                  const isSelected = selectedStyle === s
                  const isActive   = activeStyle === s
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSelectedStyle(s)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: isSelected ? '1.5px solid rgba(255,255,255,0.30)' : '1.5px solid rgba(255,255,255,0.08)',
                        background: isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                        fontSize: 12,
                        fontWeight: 500,
                        color: isSelected ? '#e0e0e0' : '#ebebeb',
                        transition: 'all 0.1s',
                        position: 'relative',
                      }}
                    >
                      {labels[s]}
                      {isActive && !isSelected && (
                        <span style={{
                          marginLeft: 'auto',
                          fontSize: 9,
                          color: '#ebebeb',
                          fontWeight: 400,
                        }}>active</span>
                      )}
                      {isActive && isSelected && (
                        <Check size={10} style={{ marginLeft: 'auto' }} />
                      )}
                    </button>
                  )
                })}
              </div>

              {reRenderError && (
                <div style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  color: '#DC2626',
                  marginBottom: 8,
                }}>
                  {reRenderError}
                </div>
              )}

              <button
                onClick={handleReCaption}
                disabled={reRenderLoading || selectedStyle === activeStyle}
                style={{
                  width: '100%',
                  height: 36,
                  background: (reRenderLoading || selectedStyle === activeStyle) ? 'rgba(255,255,255,0.05)' : 'var(--cta-bg)',
                  border: 'none',
                  borderRadius: 8,
                  color: (reRenderLoading || selectedStyle === activeStyle) ? '#333' : 'var(--cta-text)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: (reRenderLoading || selectedStyle === activeStyle) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s',
                }}
              >
                {reRenderLoading
                  ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Re-rendering captions…</>
                  : 'Apply'
                }
              </button>
            </div>
          )}
        </div>

        {/* Right column — social content */}
        <div style={{ flex: 1, minWidth: 0, width: isMobile ? '100%' : 'auto' }}>
          <SocialContent hook={hook} niche={niche} narration={narration} jobId={jobId} autoGenerate />
        </div>
      </div>
    </div>
  )
}

// ── Niche + length picker stage ───────────────────────────────

const FORMATS = [
  {
    id: 'quote_drop',
    label: 'Quote + Beat Drop',
    desc: 'Philosopher quote builds, then the beat hits. Fast cuts of warriors and statues.',
  },
  {
    id: 'workout_montage',
    label: 'Workout Montage',
    desc: 'Dark athlete footage. Original motivational speech. No copyrighted clips.',
  },
  {
    id: 'single_quote',
    label: 'Single Quote',
    desc: 'One line. One dark clip. Nothing else.',
  },
]

const VIDEO_LENGTHS = [
  { value: 15, label: '15s', desc: 'Single quote' },
  { value: 30, label: '30s', desc: 'Short form'   },
  { value: 45, label: '45s', desc: 'Full edit'    },
  { value: 60, label: '60s', desc: 'Deep cut'     },
]

const VOICES = [
  { id: 'onyx',    name: 'Atlas',  desc: 'Male · American · Deep & cinematic'        },
  { id: 'echo',    name: 'Cipher', desc: 'Male · British · Measured & authoritative' },
  { id: 'fable',   name: 'Ember',  desc: 'Female · American · Warm & narrative'      },
  { id: 'alloy',   name: 'Vale',   desc: 'Male · American · Neutral & clear'         },
  { id: 'nova',    name: 'Soleil', desc: 'Female · American · Bright & engaging'     },
  { id: 'shimmer', name: 'Aria',   desc: 'Female · British · Airy & intimate'        },
]

const MOODS = ['Dark', 'Epic', 'Calm', 'Tense', 'Uplifting']
const MOOD_LABELS = { Tense: 'Hype', Uplifting: 'Cinematic' }

const VOICE_SAMPLE_TEXT = 'The obstacle is the way. Every setback is a setup for something greater.'

// Shared card background — real video frame grab (served from public/)
const PREVIEW_BG_IMAGE = "url('/caption-preview-bg.png')"
const PREVIEW_BG_FALLBACK = 'linear-gradient(180deg, #1a1a2e 0%, #16213e 40%, #0f0e17 100%)'

const CAPTION_STYLES = [
  {
    id: 'clean',
    label: 'Clean',
    desc: 'Impact white, centered',
    preview: (
      <div style={{
        backgroundImage: PREVIEW_BG_IMAGE,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#1a1a2e',
        borderRadius: 6,
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 10px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)' }} />
        <span style={{
          position: 'relative',
          fontFamily: 'Impact, "Arial Narrow", Arial, sans-serif',
          fontSize: 22,
          fontWeight: 900,
          color: '#fff',
          textTransform: 'uppercase',
          textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
          letterSpacing: 1,
          lineHeight: 1.2,
        }}>
          DISCIPLINE<br />BUILDS DESTINY
        </span>
      </div>
    ),
  },
  {
    id: 'bold',
    label: 'Bold',
    desc: 'Word highlight, CapCut style',
    preview: (
      <div style={{
        backgroundImage: PREVIEW_BG_IMAGE,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#1a1a2e',
        borderRadius: 6,
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 10px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)' }} />
        <span style={{
          position: 'relative',
          fontFamily: 'Impact, "Arial Narrow", Arial, sans-serif',
          fontSize: 20,
          fontWeight: 900,
          color: '#fff',
          textTransform: 'uppercase',
          textShadow: '1px 1px 4px rgba(0,0,0,0.8)',
          letterSpacing: 1,
        }}>
          DISCIPLINE{' '}
          <span style={{
            background: '#CC0000',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: 2,
          }}>
            BUILDS
          </span>
          {' '}DESTINY
        </span>
      </div>
    ),
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    desc: 'Single word, maximum impact',
    preview: (
      <div style={{
        backgroundImage: PREVIEW_BG_IMAGE,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#1a1a2e',
        borderRadius: 6,
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)' }} />
        <span style={{
          position: 'relative',
          fontFamily: 'Impact, "Arial Narrow", Arial, sans-serif',
          fontSize: 42,
          fontWeight: 900,
          color: '#fff',
          textTransform: 'uppercase',
          textShadow: '0 0 20px rgba(255,255,255,0.8)',
          letterSpacing: 2,
          animation: 'subtlePulse 2s ease-in-out infinite',
          display: 'inline-block',
        }}>
          RISE
        </span>
      </div>
    ),
  },
  {
    id: 'glow',
    label: 'Glow',
    desc: 'Emphasis word illuminated',
    preview: (
      <div style={{
        backgroundImage: PREVIEW_BG_IMAGE,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#1a1a2e',
        borderRadius: 6,
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 10px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)' }} />
        <span style={{
          position: 'relative',
          fontFamily: 'Impact, "Arial Narrow", Arial, sans-serif',
          fontSize: 20,
          fontWeight: 900,
          color: 'rgba(255,255,255,0.75)',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
          DISCIPLINE{' '}
          <span style={{
            color: '#fff',
            textShadow: '0 0 15px rgba(255,255,255,0.9), 0 0 30px rgba(255,255,255,0.4)',
          }}>
            BUILDS
          </span>
          {' '}DESTINY
        </span>
      </div>
    ),
  },
]

function WaveformViz({ active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 14, flexShrink: 0 }}>
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          style={{
            width: 2,
            height: '100%',
            borderRadius: 1,
            background: active ? '#111111' : '#D1D5DB',
            transformOrigin: 'center',
            animation: active
              ? `waveform-bar 0.7s ease-in-out ${i * 0.08}s infinite`
              : 'none',
            transition: 'background 0.2s',
          }}
        />
      ))}
    </div>
  )
}

function NicheLengthStep({ onBack, onConfirm }) {
  const {
    format, setFormat,
    videoLength, setVideoLength,
    voice, setVoice,
    musicMood, setMusicMood,
    captionStyle, setCaptionStyle,
  } = useGenerationStore()

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [playing, setPlaying] = useState(null)
  const audioRef = useRef(null)

  function handlePlayVoice(e, voiceId) {
    e.stopPropagation()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    if (playing === voiceId) { setPlaying(null); return }
    const audio = new Audio(`${import.meta.env.BASE_URL}voice-samples/${voiceId}.mp3`)
    audioRef.current = audio
    audio.play().catch(() => {})
    audio.addEventListener('ended', () => { setPlaying(null); audioRef.current = null })
    setPlaying(voiceId)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onBack}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 200,
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 48, right: 0, bottom: 0, width: 400,
        background: '#0f0f0f',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
        padding: '24px 24px 32px',
        animation: 'slide-in-right 180ms ease forwards',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 500, color: '#ffffff' }}>
            Video settings
          </span>
          <button type="button" onClick={onBack} style={{
            width: 28, height: 28, borderRadius: 6, background: 'none',
            border: '1px solid rgba(255,255,255,0.10)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#ebebeb', transition: 'color 150ms, border-color 150ms',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#ebebeb'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* FORMAT section */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ebebeb', marginBottom: 10 }}>Format</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {FORMATS.map(f => {
              const isSelected = format === f.id
              return (
                <button key={f.id} type="button" onClick={() => setFormat(f.id)} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                  border: isSelected ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.06)',
                  background: isSelected ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer', transition: 'all 150ms',
                }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}
                >
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: isSelected ? '#e0e0e0' : '#ebebeb' }}>{f.label}</span>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#ebebeb', marginTop: 2 }}>{f.desc}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* LENGTH section */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ebebeb', marginBottom: 10 }}>Length</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {VIDEO_LENGTHS.map(l => {
              const isSelected = videoLength === l.value
              return (
                <button key={l.value} type="button" onClick={() => setVideoLength(l.value)} style={{
                  flex: 1, padding: '10px 8px', borderRadius: 10, textAlign: 'center',
                  border: isSelected ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.06)',
                  background: isSelected ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer', transition: 'all 150ms',
                }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}
                >
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 500, color: isSelected ? '#e0e0e0' : '#ebebeb' }}>{l.label}</div>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#ebebeb', marginTop: 2 }}>{l.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Customize style accordion */}
        <div style={{ marginBottom: 24 }}>
          <button type="button" onClick={() => setAdvancedOpen(o => !o)} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: advancedOpen ? '10px 10px 0 0' : 10,
            cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: '#ebebeb',
            transition: 'border-radius 150ms',
          }}>
            <span>Customize style</span>
            <span style={{ fontSize: 11, color: '#ebebeb', transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms', display: 'inline-block' }}>▾</span>
          </button>

          {advancedOpen && (
            <div style={{
              padding: '16px 14px', background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)', borderTop: 'none',
              borderRadius: '0 0 10px 10px', display: 'flex', flexDirection: 'column', gap: 20,
            }}>

              {/* Music mood */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ebebeb', marginBottom: 10 }}>
                  Music mood
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {MOODS.map(m => {
                    const isSelected = musicMood === m
                    return (
                      <button key={m} type="button" onClick={() => setMusicMood(m)} style={{
                        height: 32, paddingInline: 12, borderRadius: 999,
                        border: isSelected ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.06)',
                        background: isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                        color: isSelected ? '#e0e0e0' : '#ebebeb',
                        fontFamily: 'var(--font-sans)', fontSize: 13,
                        fontWeight: isSelected ? 500 : 400,
                        cursor: 'pointer',
                        transition: 'background 150ms, color 150ms, border-color 150ms',
                        whiteSpace: 'nowrap',
                      }}
                        onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#ffffff' } }}
                        onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#ebebeb' } }}
                      >
                        {MOOD_LABELS[m] || m}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Voice */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ebebeb', marginBottom: 10 }}>
                  Voice
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {VOICES.map(v => {
                    const isPlaying  = playing === v.id
                    const isSelected = voice === v.id
                    return (
                      <button key={v.id} type="button" onClick={() => setVoice(v.id)} style={{
                        display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
                        background: isSelected ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                        border: isSelected ? '1px solid rgba(255,255,255,0.20)' : '1px solid rgba(255,255,255,0.06)',
                        borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        transition: 'border-color 150ms, background 150ms', outline: 'none',
                      }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <button type="button" onClick={e => handlePlayVoice(e, v.id)}
                            className={`play-btn${isPlaying ? ' playing' : ''}`}
                            style={{
                              width: 28, height: 28, borderRadius: '50%',
                              border: isPlaying ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.12)',
                              background: isPlaying ? 'var(--accent-dim)' : 'rgba(255,255,255,0.04)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', flexShrink: 0, transition: 'all 150ms',
                            }}
                          >
                            {isPlaying
                              ? <Square size={8} color="var(--accent)" fill="var(--accent)" />
                              : <Play size={9} color="#555" fill="#555" />
                            }
                          </button>
                          <WaveformViz active={isPlaying} />
                        </div>
                        <div>
                          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: '#ebebeb', lineHeight: 1.3 }}>
                            {v.name}
                          </div>
                          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#ebebeb', marginTop: 2 }}>
                            {v.desc}
                          </div>
                          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: '#ebebeb', marginTop: 5, fontStyle: 'italic', lineHeight: 1.4 }}>
                            "{VOICE_SAMPLE_TEXT}"
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Caption style */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ebebeb', marginBottom: 10 }}>
                  Caption style
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {CAPTION_STYLES.map(cs => {
                    const isSelected = captionStyle === cs.id
                    return (
                      <button key={cs.id} type="button" onClick={() => setCaptionStyle(cs.id)} style={{
                        border: isSelected ? '2px solid rgba(255,255,255,0.50)' : '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10, background: 'transparent', padding: 0,
                        cursor: 'pointer', textAlign: 'left',
                        transition: 'border-color 150ms', overflow: 'hidden',
                      }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)' }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                      >
                        {cs.preview}
                        <div style={{ background: '#0f0e17', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '7px 10px 8px' }}>
                          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: isSelected ? '#fff' : 'rgba(255,255,255,0.75)', letterSpacing: '0.04em' }}>
                            {cs.label}
                          </div>
                          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2, lineHeight: 1.4 }}>
                            {cs.desc}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Generate button */}
        <button type="button" onClick={onConfirm} style={{
          width: '100%', height: 48, borderRadius: 10, border: 'none',
          background: 'var(--cta-bg)', color: 'var(--cta-text)',
          fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500,
          cursor: 'pointer',
          transition: 'opacity 150ms', opacity: 1,
        }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          Generate script →
        </button>

      </div>
    </>
  )
}

// ── Failed stage ──────────────────────────────────────────────

function FailedView({ error, onReset }) {
  return (
    <div className="animate-fade-in">
      <h1 style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 40,
        fontWeight: 700,
        color: '#ffffff',
        margin: '0 0 20px',
        letterSpacing: '-0.04em',
        lineHeight: 1.05,
      }}>
        Generation failed
      </h1>
      <div style={{
        padding: '16px 20px',
        background: 'rgba(220,38,38,0.08)',
        border: '1px solid rgba(220,38,38,0.15)',
        borderRadius: 12,
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        color: '#DC2626',
        marginBottom: 24,
        lineHeight: 1.6,
      }}>
        {error || 'An unexpected error occurred. Check the worker logs.'}
      </div>
      <button
        onClick={onReset}
        style={{
          padding: '0 28px',
          height: 52,
          background: 'var(--cta-bg)',
          border: 'none',
          borderRadius: 12,
          color: 'var(--cta-text)',
          fontFamily: 'var(--font-sans)',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
      >
        Try again
      </button>
    </div>
  )
}

// ── Social content generator ──────────────────────────────────

function SocialContent({ hook, niche, narration, jobId, autoGenerate = false }) {
  const [content, setContent]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [copied, setCopied]       = useState(null)
  const posthog                   = usePostHog()

  async function handleGenerate() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const data = await generateSocialContent({ narration, niche, hook, jobId })
      setContent(data)
    } catch {
      setError('Failed to generate. Try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoGenerate) handleGenerate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleCopy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      posthog?.capture('social_content_copied', { content_type: key, niche })
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 600,
        color: '#ffffff',
        marginBottom: 14,
      }}>
        Social content
      </div>

      {loading && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '40px 0',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
        }}>
          <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
          Writing your social content...
        </div>
      )}

      {error && (
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          color: '#DC2626',
          marginBottom: 12,
          textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      {content && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Title */}
          <div style={{
            background: '#111111',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: '10px 12px',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}>
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                fontWeight: 600,
                color: '#ebebeb',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                Title
              </span>
              <button
                type="button"
                onClick={() => handleCopy(content.title, 'title')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  color: copied === 'title' ? '#16A34A' : '#ebebeb',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { if (copied !== 'title') e.currentTarget.style.color = '#ebebeb' }}
                onMouseLeave={e => { if (copied !== 'title') e.currentTarget.style.color = '#ebebeb' }}
              >
                {copied === 'title' ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              fontWeight: 500,
              color: '#ebebeb',
              lineHeight: 1.5,
            }}>
              {content.title}
            </div>
          </div>

          {/* Caption + hashtags — single line */}
          <div style={{
            background: '#111111',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: '10px 12px',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}>
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                fontWeight: 600,
                color: '#ebebeb',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                Caption + Hashtags
              </span>
              <button
                type="button"
                onClick={() => handleCopy(content.caption, 'caption')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  color: copied === 'caption' ? '#16A34A' : '#ebebeb',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { if (copied !== 'caption') e.currentTarget.style.color = '#ebebeb' }}
                onMouseLeave={e => { if (copied !== 'caption') e.currentTarget.style.color = '#ebebeb' }}
              >
                {copied === 'caption' ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: '#ebebeb',
              lineHeight: 1.6,
              wordBreak: 'break-word',
            }}>
              {content.caption}
            </div>
          </div>

          {/* Regenerate */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              color: '#ebebeb',
              textAlign: 'center',
              marginTop: 4,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.color = '#ebebeb' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#ebebeb' }}
          >
            {loading ? 'Regenerating...' : 'Regenerate'}
          </button>

        </div>
      )}
    </div>
  )
}
