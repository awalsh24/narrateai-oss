import { create } from 'zustand'

export const useGenerationStore = create((set) => ({
  // Form state
  hook:         '',
  niche:        'Stoicism',
  format:       'quote_drop',
  voice:        'onyx',
  musicMood:    'Dark',
  captionStyle: 'clean',
  videoLength:  30,

  // Job state
  jobId:    null,
  // idle | generating_script | script_review | submitting | polling | completed | failed
  status:   'idle',
  progress: 0,
  result:   null,
  error:    null,
  script:   null,   // { narration, structure, beats } from /api/generate-script

  // Form actions
  setHook:         (hook)         => set({ hook }),
  setNiche:        (niche)        => set({ niche }),
  setFormat:       (format)       => set({ format }),
  setVoice:        (voice)        => set({ voice }),
  setMusicMood:    (musicMood)    => set({ musicMood }),
  setCaptionStyle: (captionStyle) => set({ captionStyle }),
  setVideoLength:  (videoLength)  => set({ videoLength }),
  goToNicheLength: ()             => set({ status: 'niche_length', error: null }),
  goBackToNicheLength: ()         => set({ status: 'niche_length', error: null }),

  // Script generation actions
  startGeneratingScript: () => set({ status: 'generating_script', error: null }),
  setScriptReview:       (script) => set({ status: 'script_review', script }),

  // Video job actions
  startSubmitting: () => set({ status: 'submitting', error: null }),
  setJobId:        (jobId) => set({ jobId, status: 'polling', progress: 0 }),
  setProgress:     (progress) => set({ progress }),
  setCompleted:    (result) => set({ status: 'completed', progress: 100, result }),
  setFailed:       (error) => set({ status: 'failed', error }),
  reset:           () => set({
    jobId: null, status: 'idle', progress: 0, result: null, error: null, script: null,
  }),
}))
