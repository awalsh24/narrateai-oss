import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Clock, Check, Play, X } from 'lucide-react'
import { fetchVideos, authHeader } from '../lib/api'
import { usePostHog } from '@posthog/react'

export default function History() {
  const { data: videos, isLoading, error } = useQuery({
    queryKey: ['videos'],
    queryFn:  fetchVideos,
  })

  return (
    <div style={{ padding: '36px 32px' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: '0 0 6px',
          letterSpacing: '-0.5px',
        }}>
          Video history
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Your previously generated videos
        </p>
      </div>

      {isLoading && <SkeletonGrid />}

      {error && (
        <div style={{
          padding: '14px 16px',
          background: 'rgba(255,45,45,0.1)',
          border: '1px solid rgba(255,45,45,0.3)',
          borderRadius: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: '#e87070',
        }}>
          Failed to load history: {error.message}
        </div>
      )}

      {!isLoading && !error && videos?.length === 0 && <EmptyHistory />}

      {!isLoading && !error && videos?.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
        }}>
          {videos.map(video => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}

    </div>
  )
}

function VideoCard({ video }) {
  const isComplete  = video.status === 'completed' && video.video_url
  const posthog     = usePostHog()
  const [modal, setModal]           = useState(false)
  const [captionCopied, setCaptionCopied] = useState(false)

  async function handleDownload(e) {
    e?.stopPropagation()
    posthog?.capture('video_downloaded', { niche: video.niche, source: 'history_page', job_id: video.job_id })
    const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api'
    const filename = `narrateai-${video.job_id || video.id}`
    const proxyUrl = `${API_BASE}/download?url=${encodeURIComponent(video.video_url)}&filename=${encodeURIComponent(filename)}`
    try {
      const response = await fetch(proxyUrl, { headers: authHeader() })
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${filename}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
    } catch (err) {
      console.error('Download failed:', err)
      window.open(video.video_url, '_blank')
    }
  }

  function handleCopyCaption(e) {
    e?.stopPropagation()
    if (!video.social_caption) return
    navigator.clipboard.writeText(video.social_caption).then(() => {
      setCaptionCopied(true)
      setTimeout(() => setCaptionCopied(false), 1500)
    })
  }

  return (
    <>
      <div
        onClick={() => isComplete && setModal(true)}
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
          cursor: isComplete ? 'pointer' : 'default',
        }}
      >
        {/* Thumbnail — 9:16 */}
        <div style={{
          position: 'relative',
          paddingTop: '177.78%',
          background: '#0a0a0a',
          borderBottom: '1px solid var(--border)',
        }}>
          {isComplete ? (
            <>
              <video
                src={video.video_url}
                muted
                playsInline
                preload="metadata"
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                }}
              />
              {/* Play overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.25)',
                transition: 'background 0.15s',
              }}>
                <div style={{
                  width: 36, height: 36,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(4px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,0.2)',
                }}>
                  <Play size={14} color="#fff" fill="#fff" style={{ marginLeft: 2 }} />
                </div>
              </div>
            </>
          ) : (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-tertiary)',
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}>
                {video.status === 'queued'    && 'QUEUED'}
                {video.status === 'active'    && 'PROCESSING'}
                {video.status === 'failed'    && 'FAILED'}
                {video.status === 'completed' && 'DONE'}
              </span>
            </div>
          )}

          {/* Niche badge */}
          <div style={{
            position: 'absolute', top: 8, left: 8,
            padding: '3px 7px',
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 3,
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            color: 'var(--text-secondary)',
            letterSpacing: '1px',
            backdropFilter: 'blur(4px)',
          }}>
            {video.niche?.toUpperCase()}
          </div>

          {/* Status dot */}
          <div style={{
            position: 'absolute', top: 8, right: 8,
            width: 7, height: 7,
            borderRadius: '50%',
            background:
              video.status === 'completed' ? '#22c55e' :
              video.status === 'failed'    ? 'var(--accent)' :
              '#eab308',
          }} />
        </div>

        {/* Meta */}
        <div style={{ padding: '12px 14px' }}>
          {video.title && (
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--text-muted)',
              margin: '0 0 4px',
              letterSpacing: '0.5px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {video.title}
            </p>
          )}

          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: 'var(--text-primary)',
            margin: '0 0 8px',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {video.hook || '—'}
          </p>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 8,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--text-muted)',
            }}>
              <Clock size={9} />
              {new Date(video.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isComplete && video.social_caption && (
                <button
                  onClick={handleCopyCaption}
                  title="Copy caption"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: captionCopied ? '#22c55e' : 'var(--text-muted)',
                    background: 'none',
                    padding: '4px 8px',
                    border: `1px solid ${captionCopied ? '#22c55e' : 'var(--border)'}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}
                >
                  {captionCopied ? <Check size={9} /> : 'copy'}
                </button>
              )}

              {isComplete && (
                <button
                  onClick={handleDownload}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    background: 'none',
                    padding: '4px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <Download size={9} />
                  MP4
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <VideoModal
          video={video}
          onClose={() => setModal(false)}
          onDownload={handleDownload}
        />
      )}
    </>
  )
}

function VideoModal({ video, onClose, onDownload }) {
  const [titleCopied, setTitleCopied]     = useState(false)
  const [captionCopied, setCaptionCopied] = useState(false)
  const isMobile = window.innerWidth < 640

  function handleCopyTitle() {
    if (!video.title) return
    navigator.clipboard.writeText(video.title).then(() => {
      setTitleCopied(true)
      setTimeout(() => setTitleCopied(false), 1500)
    })
  }

  function handleCopyCaption() {
    if (!video.social_caption) return
    navigator.clipboard.writeText(video.social_caption).then(() => {
      setCaptionCopied(true)
      setTimeout(() => setCaptionCopied(false), 1500)
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        padding: isMobile ? '12px' : '24px',
        overflowX: 'hidden',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          width: isMobile ? '95vw' : '90vw',
          maxWidth: isMobile ? '95vw' : 900,
          maxHeight: '95vh',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: isMobile ? 'sticky' : 'absolute',
            top: isMobile ? 0 : 16,
            right: isMobile ? 0 : 16,
            alignSelf: 'flex-end',
            zIndex: 10,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '6px',
            margin: isMobile ? '8px 8px 0 0' : 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={14} />
        </button>

        {/* Content: video + info */}
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 16 : 24,
          padding: isMobile ? 16 : 24,
          overflowY: 'auto',
          maxHeight: isMobile ? '90vh' : '80vh',
        }}>
          {/* Video */}
          <div style={{
            width: isMobile ? '100%' : 220,
            maxWidth: isMobile ? 280 : 220,
            alignSelf: isMobile ? 'center' : 'flex-start',
            aspectRatio: '9 / 16',
            flexShrink: 0,
            borderRadius: 8,
            overflow: 'hidden',
            background: '#0a0a0a',
          }}>
            <video
              src={video.video_url}
              autoPlay
              muted
              loop
              controls
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>

          {/* Info */}
          <div style={{
            flex: isMobile ? 'none' : 1,
            width: isMobile ? '100%' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            overflow: 'visible',
            paddingRight: 0,
          }}>
            {video.title && (
              <div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-muted)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}>
                  Title
                </div>
                <div
                  onClick={handleCopyTitle}
                  title="Click to copy"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 20,
                    fontWeight: 600,
                    color: titleCopied ? '#22c55e' : 'var(--text-primary)',
                    lineHeight: 1.3,
                    cursor: 'pointer',
                    transition: 'color 0.15s',
                  }}
                >
                  {titleCopied ? '✓ Copied' : video.title}
                </div>
              </div>
            )}

            <div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-muted)',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Hook
              </div>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
              }}>
                {video.hook || '—'}
              </div>
            </div>

            {video.social_caption && (
              <div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-muted)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}>
                  Caption
                </div>
                <div
                  onClick={handleCopyCaption}
                  title="Click to copy"
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    color: captionCopied ? '#22c55e' : 'var(--text-secondary)',
                    lineHeight: 1.6,
                    cursor: 'pointer',
                    transition: 'color 0.15s',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  {captionCopied ? '✓ Copied' : video.social_caption}
                </div>
              </div>
            )}

            <div style={{ marginTop: isMobile ? 0 : 'auto', paddingTop: 8 }}>
              <button
                onClick={onDownload}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isMobile ? 'center' : 'flex-start',
                  gap: 6,
                  width: isMobile ? '100%' : 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  background: 'none',
                  padding: '8px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <Download size={12} />
                Download MP4
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: 16,
    }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          animation: 'idle-pulse 1.4s ease-in-out infinite',
        }}>
          <div style={{ paddingTop: '177.78%', background: 'var(--bg-tertiary)' }} />
          <div style={{ padding: '12px 14px' }}>
            <div style={{ height: 10, background: 'var(--bg-tertiary)', borderRadius: 4, marginBottom: 8 }} />
            <div style={{ height: 10, width: '60%', background: 'var(--bg-tertiary)', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyHistory() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 320,
      gap: 14,
    }}>
      <div style={{
        width: 44, height: 44,
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.5,
      }}>
        <Clock size={18} color="var(--text-muted)" />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-muted)', marginBottom: 6 }}>
          No videos yet
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', opacity: 0.5, letterSpacing: '1px' }}>
          GENERATE YOUR FIRST VIDEO TO SEE IT HERE
        </div>
      </div>
    </div>
  )
}
