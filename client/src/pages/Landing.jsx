import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

// ── Nav ──────────────────────────────────────────────────────
function Nav() {
  return (
    <nav style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      background: '#0a0a0a',
      borderBottom: '1px solid #1f1f1f',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      padding: '0 32px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        maxWidth: 1100,
        margin: '0 auto',
      }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <span style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 18,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            userSelect: 'none',
          }}>
            Narrate<span style={{ color: '#DC2626' }}>AI</span>
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link
            to="/generate"
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 14,
              fontWeight: 500,
              color: '#a1a1a1',
              textDecoration: 'none',
            }}
          >
            Open app
          </Link>
          <Link
            to="/generate"
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              color: '#ffffff',
              textDecoration: 'none',
              background: '#DC2626',
              borderRadius: 6,
              padding: '8px 16px',
              display: 'inline-block',
            }}
          >
            Start free
          </Link>
        </div>
      </div>
    </nav>
  )
}

// ── Hero ─────────────────────────────────────────────────────
function Hero() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return (
    <section style={{ background: '#0a0a0a' }}>
      {/* Hero inner — two column on desktop, stacked on mobile */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'flex-start' : 'center',
        gap: isMobile ? 40 : 80,
        maxWidth: 1100,
        margin: '0 auto',
        padding: isMobile ? '100px 24px 60px' : '0 40px',
        minHeight: isMobile ? 'auto' : '100vh',
      }}>
        {/* Left: text content */}
        <div style={{
          flex: isMobile ? 'none' : 1,
          width: isMobile ? '100%' : 'auto',
          minWidth: 0,
        }}>
          <p style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#6b6b6b',
            marginBottom: 24,
          }}>
            Real footage. No AI images.
          </p>
          <h1 style={{
            fontSize: isMobile ? 36 : 'clamp(40px, 5vw, 64px)',
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: '-0.03em',
            color: '#ffffff',
            margin: '0 0 24px',
          }}>
            Faceless videos that actually look cinematic.
          </h1>
          <p style={{
            fontSize: 18,
            color: '#a1a1a1',
            lineHeight: 1.6,
            margin: '0 0 36px',
            maxWidth: 480,
          }}>
            Turn a philosopher quote, a motivational monologue, or a cosmic question into a fully edited short-form video. Real footage, AI narration, word-level captions — ready to post.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a
              href="/generate"
              style={{
                display: 'inline-block',
                background: '#DC2626',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 15,
                padding: '14px 28px',
                borderRadius: 6,
                textDecoration: 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#b91c1c' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#DC2626' }}
            >
              Start free
            </a>
            <span style={{ fontSize: 13, color: '#6b6b6b' }}>No credit card required</span>
          </div>
        </div>

        {/* Right: three video examples — horizontal scroll on mobile */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 12,
          width: isMobile ? '100%' : 'auto',
          overflowX: isMobile ? 'auto' : 'visible',
          flexShrink: 0,
          alignItems: 'flex-end',
          paddingBottom: isMobile ? 8 : 0,
        }}>
          {[
            { src: '/video-examples/1.mp4', label: 'Mindset',    height: 380 },
            { src: '/video-examples/2.mp4', label: 'Philosophy', height: 440 },
            { src: '/video-examples/3.mp4', label: 'Cosmos',     height: 380 },
          ].map(function(v) {
            return (
              <div key={v.label} style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{
                  width: isMobile ? 120 : 160,
                  height: isMobile ? 280 : v.height,
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#111111',
                  border: '1px solid #1f1f1f',
                }}>
                  <video
                    src={v.src}
                    autoPlay
                    muted
                    loop
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <p style={{
                  fontSize: 12,
                  color: '#6b6b6b',
                  marginTop: 10,
                  fontWeight: 500,
                }}>
                  {v.label}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ── Differentiator bar ────────────────────────────────────────
const FACTS = [
  { stat: '1,500+ real clips', desc: 'Human-shot cinematography' },
  { stat: 'Zero copyright risk', desc: 'Every asset is free to use' },
  { stat: 'Beat-matched editing', desc: 'Cuts timed to your music' },
  { stat: 'Ready to post', desc: 'TikTok, Reels, YouTube Shorts' },
]

function DifferentiatorBar() {
  return (
    <div style={{
      background: '#111111',
      borderTop: '1px solid #1f1f1f',
      borderBottom: '1px solid #1f1f1f',
      padding: '32px',
    }}>
      <div style={{
        maxWidth: 1100,
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
      }}
      className="landing-facts-grid"
      >
        {FACTS.map((fact, i) => (
          <div
            key={fact.stat}
            style={{
              padding: '0 28px',
              borderLeft: i > 0 ? '1px solid #1f1f1f' : 'none',
            }}
          >
            <div style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              color: '#ffffff',
              marginBottom: 4,
            }}>
              {fact.stat}
            </div>
            <div style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 12,
              color: '#6b6b6b',
            }}>
              {fact.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── How it works ──────────────────────────────────────────────
const STEPS = [
  {
    num: '01',
    title: 'Enter your hook',
    desc: 'Start with your opening line. A philosophical insight, a dark story, a cosmic idea — one sentence is all it takes.',
  },
  {
    num: '02',
    title: 'Pick your niche and voice',
    desc: 'Choose Mindset, Philosophy, Cosmos, or another category. Select a voice, caption style, and music mood.',
  },
  {
    num: '03',
    title: 'Download and post',
    desc: 'Cinematic real footage is selected, scored, and assembled with narration and word-level captions. Ready in minutes.',
  },
]

function HowItWorks() {
  return (
    <section style={{
      background: '#0a0a0a',
      padding: '96px 32px',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 11,
          fontWeight: 600,
          color: '#6b6b6b',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 20,
        }}>
          How it works
        </div>

        <h2 style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 36,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          margin: '0 0 56px',
        }}>
          From idea to posted video in minutes
        </h2>

        <div className="landing-steps" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 48,
        }}>
          {STEPS.map(step => (
            <div key={step.num}>
              <div style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 12,
                fontWeight: 600,
                color: '#DC2626',
                marginBottom: 12,
                letterSpacing: '0.04em',
              }}>
                {step.num}
              </div>
              <div style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 16,
                fontWeight: 600,
                color: '#ffffff',
                marginBottom: 10,
              }}>
                {step.title}
              </div>
              <div style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 14,
                color: '#a1a1a1',
                lineHeight: 1.6,
              }}>
                {step.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Features grid ─────────────────────────────────────────────
const FEATURES = [
  {
    title: 'Real cinematography',
    desc: 'Every clip is human-shot footage, not AI-generated images. Your videos look real because they are.',
  },
  {
    title: 'Copyright free',
    desc: 'Every clip, image, and music track is cleared for commercial use. No claims, no strikes, no appeals.',
  },
  {
    title: 'AI narration',
    desc: 'Six voices built for cinematic content. Word-level Whisper captions synced to the millisecond and burned in.',
  },
  {
    title: 'Beat-matched editing',
    desc: 'The pipeline scores each clip against your story and assembles them into a visual arc. Hook, build, resolve.',
  },
  {
    title: 'Philosopher quotes',
    desc: 'Drop in a line from Nietzsche, Seneca, or Marcus Aurelius. The pipeline builds a full cinematic video around it.',
  },
  {
    title: 'Social content',
    desc: 'Titles, captions, and hashtags generated for TikTok, YouTube, and Instagram after every video.',
  },
]

function FeaturesGrid() {
  return (
    <section style={{
      background: '#111111',
      padding: '96px 32px',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 36,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          margin: '0 0 48px',
        }}>
          Everything included
        </h2>

        <div className="landing-features-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}>
          {FEATURES.map(f => (
            <div
              key={f.title}
              style={{
                background: '#0a0a0a',
                border: '1px solid #1f1f1f',
                borderRadius: 8,
                padding: 24,
              }}
            >
              <div style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 15,
                fontWeight: 600,
                color: '#ffffff',
              }}>
                {f.title}
              </div>
              <div style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 13,
                color: '#a1a1a1',
                lineHeight: 1.6,
                marginTop: 8,
              }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Pricing ───────────────────────────────────────────────────
// ── Final CTA ─────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section style={{
      background: '#111111',
      borderTop: '1px solid #1f1f1f',
      padding: '96px 32px',
      textAlign: 'center',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h2 className="landing-final-headline" style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 40,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          margin: '0 0 16px',
        }}>
          Start making cinematic videos today
        </h2>

        <p style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 16,
          color: '#6b6b6b',
          margin: '0 0 36px',
        }}>
          Free to start. No credit card required.
        </p>

        <Link
          to="/generate"
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 16,
            fontWeight: 600,
            color: '#ffffff',
            textDecoration: 'none',
            background: '#DC2626',
            borderRadius: 6,
            height: 52,
            padding: '0 36px',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          Make your first video
        </Link>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────
function Footer() {
  return (
    <footer style={{
      background: '#0a0a0a',
      borderTop: '1px solid #1f1f1f',
      padding: '32px',
    }}>
      <div style={{
        maxWidth: 1100,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <span style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 14,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '-0.02em',
        }}>
          Narrate<span style={{ color: '#DC2626' }}>AI</span>
        </span>

      </div>

      <div style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 12,
        color: '#6b6b6b',
        textAlign: 'center',
      }}>
        Real footage. Real results.
      </div>
    </footer>
  )
}

// ── Page ──────────────────────────────────────────────────────
export default function Landing() {
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh' }}>
      <Nav />
      <Hero />
      <DifferentiatorBar />
      <HowItWorks />
      <FeaturesGrid />
      <FinalCTA />
      <Footer />
    </div>
  )
}
