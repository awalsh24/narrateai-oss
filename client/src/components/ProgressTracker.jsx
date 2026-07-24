import { Check } from 'lucide-react'

const STEPS = [
  { label: 'Script written',            threshold: 20  },
  { label: 'Selecting footage...',      threshold: 45  },
  { label: 'Generating voiceover...',   threshold: 55  },
  { label: 'Syncing captions...',       threshold: 65  },
  { label: 'Color grading...',          threshold: 80  },
  { label: 'Finalizing...',             threshold: 90  },
  { label: 'Uploading...',              threshold: 96  },
  { label: 'Done',                      threshold: 100 },
]

export default function ProgressTracker({ progress = 0 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {STEPS.map((step, i) => {
        const done   = progress >= step.threshold
        const active = !done && progress >= (STEPS[i - 1]?.threshold ?? 0)

        return (
          <div
            key={step.label}
            className={done ? 'animate-slide-in' : ''}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 0',
              borderBottom: i < STEPS.length - 1 ? '1px solid var(--border)' : 'none',
              opacity: done ? 1 : active ? 0.8 : 0.3,
              transition: 'opacity 0.4s ease',
            }}
          >
            {/* Icon */}
            <div style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: done ? 'none' : active ? '1px solid var(--accent)' : '1px solid var(--border-light)',
              background: done ? 'var(--accent)' : active ? 'var(--accent-dim)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.3s ease',
            }}>
              {done
                ? <Check size={12} color="#fff" strokeWidth={2.5} />
                : active
                  ? <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: 'var(--accent)', display: 'block',
                      animation: 'idle-pulse 1.2s ease-in-out infinite',
                    }} />
                  : <span style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: 'var(--border-light)', display: 'block',
                    }} />
              }
            </div>

            {/* Label */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: done ? 600 : 500,
              color: done ? '#ffffff' : active ? '#ffffff' : '#ebebeb',
              letterSpacing: '0.3px',
              flex: 1,
            }}>
              {step.label}
            </span>

            {/* Right badge */}
            {done && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--accent)',
                fontWeight: 600,
                letterSpacing: '0.5px',
              }}>
                DONE
              </span>
            )}
            {active && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: '#ebebeb',
              }}>
                {progress}%
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
