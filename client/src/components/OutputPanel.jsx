import { Download, Share2, Video } from 'lucide-react'
import ProgressTracker from './ProgressTracker'

export default function OutputPanel({ status, progress, result, error, onReset }) {

  if (status === 'idle') {
    return <EmptyState />
  }

  if (status === 'submitting' || status === 'polling') {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Top crimson progress bar */}
        <div style={{
          height: 3,
          background: 'var(--border)',
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 32,
          flexShrink: 0,
        }}>
          <div
            className={status === 'polling' ? 'progress-shimmer' : ''}
            style={{
              height: '100%',
              width: `${progress}%`,
              background: status === 'polling' ? undefined : 'var(--accent)',
              borderRadius: 2,
              transition: 'width 0.8s ease',
            }}
          />
        </div>

        <SectionHeader>Generating your video</SectionHeader>
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--text-tertiary)',
          marginBottom: 28,
          lineHeight: 1.6,
        }}>
          Each scene is being scored, voiced, and cut. This takes 2–4 minutes.
        </p>
        <ProgressTracker progress={progress} status={status} />
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="animate-fade-in" style={{ padding: 8 }}>
        <SectionHeader>Generation failed</SectionHeader>
        <div style={{
          padding: '14px 16px',
          background: 'rgba(255,45,45,0.1)',
          border: '1px solid rgba(255,45,45,0.3)',
          borderRadius: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: '#e87070',
          marginBottom: 16,
        }}>
          {error || 'An unexpected error occurred. Check the worker logs.'}
        </div>
        <button
          onClick={onReset}
          style={{
            padding: '11px 20px',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '1px',
            cursor: 'pointer',
          }}
        >
          TRY AGAIN
        </button>
      </div>
    )
  }

  if (status === 'completed' && result) {
    const videoUrl = result.videoUrl
    const isLocal  = videoUrl && !videoUrl.startsWith('http')

    function handleDownload() {
      const a = document.createElement('a')
      a.href = videoUrl
      a.download = 'narrateai-video.mp4'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }

    return (
      <div className="animate-fade-in" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        height: '100%',
      }}>
        <SectionHeader style={{ alignSelf: 'flex-start' }}>Your video is ready</SectionHeader>

        {/* 9:16 video frame — fills panel height */}
        <div style={{
          height: 'min(80vh, 700px)',
          aspectRatio: '9 / 16',
          width: 'auto',
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: '#000',
          position: 'relative',
          flexShrink: 0,
        }}>
          {isLocal ? (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Video size={32} color="var(--text-muted)" />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                color: 'var(--text-muted)', textAlign: 'center', padding: '0 16px',
              }}>
                Video saved locally — upload to R2 to preview here
              </span>
            </div>
          ) : (
            <video
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              src={videoUrl}
              controls
              autoPlay
              muted
              loop
              playsInline
            />
          )}
        </div>

        {/* 3-button row — equal width */}
        <div style={{
          display: 'flex',
          gap: 8,
          width: '100%',
          maxWidth: 360,
        }}>
          {/* Download — filled crimson */}
          <button
            onClick={isLocal ? undefined : handleDownload}
            disabled={isLocal}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              padding: '11px 0',
              background: isLocal ? 'var(--bg-tertiary)' : 'var(--accent)',
              borderRadius: 6,
              color: isLocal ? 'var(--text-disabled)' : '#fff',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '1px',
              cursor: isLocal ? 'not-allowed' : 'pointer',
              opacity: isLocal ? 0.5 : 1,
              border: 'none',
            }}
          >
            <Download size={13} />
            DOWNLOAD
          </button>

          {/* TODO: Implement TikTok direct publish via TikTok Creator API */}
          <button
            disabled
            title="TikTok publishing coming soon"
            style={{
              flex: 1,
              padding: '11px 0',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-placeholder)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '1px',
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <Share2 size={11} />
            TIKTOK
          </button>

          {/* TODO: Implement Instagram Reels publish via Instagram Graph API */}
          <button
            disabled
            title="Instagram publishing coming soon"
            style={{
              flex: 1,
              padding: '11px 0',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-placeholder)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '1px',
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <Share2 size={11} />
            INSTAGRAM
          </button>
        </div>

        {/* Generate another */}
        <button
          onClick={onReset}
          style={{
            width: '100%',
            maxWidth: 360,
            padding: '11px 0',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '1px',
            cursor: 'pointer',
          }}
        >
          GENERATE ANOTHER VIDEO
        </button>

        {/* Narration + beat summary */}
        {(result.narration || result.beats) && (
          <div style={{
            padding: '14px 16px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            width: '100%',
            maxWidth: 360,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            {result.narration && (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: 8 }}>
                  NARRATION
                </div>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {result.narration}
                </div>
              </div>
            )}
            {result.beats && result.beats.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: 8 }}>
                  BEAT SHEET
                </div>
                {result.beats.map((b, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    padding: '5px 0',
                    borderBottom: i < result.beats.length - 1 ? '1px solid var(--border)' : 'none',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                  }}>
                    <span style={{ color: 'var(--accent)', minWidth: 16 }}>{b.beat_number}</span>
                    <span style={{ color: 'var(--text-primary)', minWidth: 64, textTransform: 'uppercase', fontSize: 10 }}>{b.type}</span>
                    <span>{b.clip_count}×{b.clip_duration}s</span>
                    <span style={{ color: 'var(--text-tertiary)', marginLeft: 'auto', fontSize: 10 }}>{b.mood}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return null
}

function SectionHeader({ children, style }) {
  return (
    <h2 style={{
      fontFamily: 'var(--font-display)',
      fontSize: 20,
      fontWeight: 500,
      color: 'var(--text-primary)',
      margin: '0 0 8px',
      letterSpacing: '-0.3px',
      ...style,
    }}>
      {children}
    </h2>
  )
}

function EmptyState() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 20,
      userSelect: 'none',
    }}>
      {/* 9:16 placeholder frame — fills 80% panel height */}
      <div
        className="empty-frame-pulse"
        style={{
          height: 'min(80vh, 700px)',
          aspectRatio: '9 / 16',
          width: 'auto',
          borderRadius: 10,
          border: '1px solid #374151',
          background: '#111111',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {/* Play triangle */}
        <div style={{
          width: 0,
          height: 0,
          borderTop: '16px solid transparent',
          borderBottom: '16px solid transparent',
          borderLeft: '28px solid var(--border-light)',
          marginLeft: 8,
        }} />
      </div>

      <div style={{ textAlign: 'center', maxWidth: 280 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontStyle: 'italic',
          color: 'rgba(255,255,255,0.9)',
          marginBottom: 8,
          lineHeight: 1.3,
          letterSpacing: '-0.3px',
        }}>
          Your video will appear here
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-placeholder)',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
        }}>
          Fill in the form and generate
        </div>
      </div>
    </div>
  )
}
