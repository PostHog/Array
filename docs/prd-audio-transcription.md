# PRD: Audio Transcription & Task Extraction

## Overview

Enable users to record audio (calls, meetings, voice notes), automatically transcribe using AI, and extract actionable tasks that can be created directly in PostHog.

## Problem

Users have valuable conversations (calls, meetings, brainstorms) where tasks and action items are discussed, but:
- Manual note-taking is incomplete and distracting
- Context is lost between conversation and task creation
- Transcribing and extracting tasks manually is time-consuming
- No seamless way to turn conversation → actionable tasks

## Solution

Browser-based audio recording with AI-powered transcription and intelligent task extraction:
1. **Record** audio directly in the app
2. **Transcribe** using OpenAI Whisper via Vercel AI SDK
3. **Generate** concise summary of the conversation
4. **Extract** actionable tasks automatically using GPT
5. **Create** tasks in PostHog with one click

## V1 Requirements (Ship This Week)

### Functional Requirements

#### 1. Audio Recording
- ✅ Record audio from system/microphone via browser MediaRecorder API
- ✅ Real-time duration counter during recording
- ✅ Start/stop recording controls
- ✅ Save recordings to local storage (`userData/recordings/`)
- ✅ Audio format: WebM (cross-platform, compressed)

#### 2. Recording Management
- ✅ List all recordings with metadata (date, duration)
- ✅ Play back recordings in-app
- ✅ Delete recordings
- ✅ Persist metadata (duration, created_at, transcription status)

#### 3. Transcription
- ✅ Transcribe recording using OpenAI Whisper (via Vercel AI SDK)
- ✅ Show transcription status (processing/completed/error)
- ✅ Display full transcript text
- ✅ Generate 3-7 word summary title
- ✅ Handle transcription errors gracefully

#### 4. Task Extraction
- ✅ Automatically extract actionable tasks from transcript
- ✅ Use GPT-4o-mini for task identification
- ✅ Extract: feature requests, bug reports, requirements, action items
- ✅ Format: `{title: string, description: string}` with context

#### 5. Task Creation
- ✅ Bulk create tasks in PostHog from extracted tasks
- ✅ One-click "Create All Tasks" button
- ✅ Link transcript context to task descriptions
- ✅ Success/error feedback

### Non-Functional Requirements

- **Performance**: Transcription completes within 2x audio duration
- **Storage**: Audio files compressed to ~1MB per 10 minutes
- **Reliability**: Handle network failures, large files (25MB Whisper limit)
- **Privacy**: All recordings stored locally, API keys encrypted
- **UX**: Clear status indicators, error messages, loading states

### User Stories

**As a user, I want to:**
1. Record a call/meeting without leaving the app
2. Get an automatic transcript without manual typing
3. See a summary of what was discussed
4. Get a list of action items extracted automatically
5. Create PostHog tasks from those action items with one click
6. Access my recording history and transcripts

### UI/UX

**Recordings Tab (new)**
- Main view accessible from tab bar
- "Record" button (prominent, red when recording)
- Real-time duration counter during recording
- List of recordings (newest first)
- Each recording card shows:
  - Date/time
  - Duration
  - Play button
  - Transcribe button (if not transcribed)
  - Delete button
  - Transcript (if available)
  - Summary (if available)
  - Extracted tasks (if available)
  - "Create Tasks" button (if tasks extracted)

**Design System**
- Use Radix UI components (Button, Card, Flex, Text, etc.)
- Follow existing app styling patterns
- Responsive layout
- Keyboard shortcuts (future)

## Technical Architecture

### Core Technologies

**Vercel AI SDK**
- **Why**: Provider-agnostic abstraction, makes swapping providers trivial
- **Usage**: OpenAI provider for Whisper transcription and GPT task extraction
- **Future**: Swap to Anthropic, AssemblyAI, or local models by changing config

**Browser MediaRecorder API**
- **Why**: No native dependencies, cross-platform, works today
- **Format**: WebM with Opus audio codec
- **Fallback**: Error handling for unsupported browsers

**React Query**
- **Why**: Handles data fetching, caching, optimistic updates
- **Usage**: Recording list, transcription status polling
- **Benefit**: No new Zustand store needed

### Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process                │
│                                                   │
│  RecordingsView.tsx                              │
│    ↓                                             │
│  useRecordings.ts (React Query)                  │
│    ↓                                             │
│  window.electronAPI.recording*()                 │
└──────────────────┬──────────────────────────────┘
                   │ IPC
┌──────────────────┴──────────────────────────────┐
│                  Main Process                     │
│                                                   │
│  recording.ts (Service)                          │
│    ├─ MediaRecorder handling                     │
│    ├─ File system storage                        │
│    ├─ Vercel AI SDK                              │
│    │   ├─ OpenAI Whisper (transcription)         │
│    │   └─ GPT-4o-mini (summary + extraction)     │
│    └─ IPC handlers                               │
│                                                   │
│  transcription-prompts.ts                        │
│    ├─ SUMMARY_PROMPT                             │
│    └─ TASK_EXTRACTION_PROMPT                     │
└───────────────────────────────────────────────────┘
```

### File Structure

**New Files:**
```
src/
├── main/
│   └── services/
│       ├── recording.ts                 # Core recording service
│       └── transcription-prompts.ts     # Prompt configuration
└── renderer/
    ├── components/
    │   └── RecordingsView.tsx           # Main UI
    └── hooks/
        └── useRecordings.ts             # Recording state hook
```

**Modified Files:**
```
src/
├── main/
│   ├── index.ts                         # Register IPC
│   └── preload.ts                       # Expose API
├── renderer/
│   └── components/
│       └── MainLayout.tsx               # Add tab
└── shared/
    └── types.ts                         # Recording types
```

### Data Models

```typescript
interface Recording {
  id: string                   // Filename
  filename: string
  duration: number             // Seconds
  created_at: string          // ISO 8601
  file_path: string           // Absolute path
  transcription?: {
    status: 'processing' | 'completed' | 'error'
    text: string
    summary?: string
    extracted_tasks?: Array<{
      title: string
      description: string
    }>
    error?: string
  }
}
```

### IPC API

```typescript
// Recording lifecycle
window.electronAPI.recordingStart()
  → Promise<{recordingId: string, startTime: string}>

window.electronAPI.recordingStop(recordingId, audioData, duration)
  → Promise<Recording>

// Recording management
window.electronAPI.recordingList()
  → Promise<Recording[]>

window.electronAPI.recordingDelete(recordingId)
  → Promise<boolean>

window.electronAPI.recordingGetFile(recordingId)
  → Promise<ArrayBuffer>

// Transcription
window.electronAPI.recordingTranscribe(recordingId, openaiApiKey)
  → Promise<TranscriptionResult>
```

### Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **Vercel AI SDK** | Provider-agnostic, production-ready, easy provider swaps |
| **Browser Recording** | No native deps, cross-platform, works today |
| **Prompts in Code** | Ship fast, easy to move to editable file later |
| **React Query** | Standard data fetching, no new state layer |
| **Local Storage** | Privacy-first, no upload costs, instant access |
| **WebM Format** | Cross-platform, compressed, MediaRecorder default |

## V1 Out of Scope

❌ Meeting auto-detection (Zoom/Meet)
❌ Multiple transcription provider UI
❌ User-editable prompts UI
❌ Real-time streaming transcription
❌ Recording-only mode (no PostHog)
❌ Cloud storage/sync
❌ Speaker diarization
❌ Custom vocabulary/terminology

## Future Improvements (Priority Order)

### P0: Based on User Feedback
1. **Meeting Auto-Detection**
   - Detect active Zoom/Google Meet sessions
   - Show notification to start recording
   - Auto-name recordings by meeting title
   - *Build when*: Users manually start recordings often

2. **User-Editable Prompts**
   - Move prompts to `~/.array/prompts.json`
   - UI to edit summary and extraction prompts
   - Prompt templates (standup, brainstorm, bug triage)
   - *Build when*: Users want custom task extraction logic

### P1: Enhanced Functionality
3. **Provider Selection**
   - UI to choose transcription provider
   - Support: OpenAI, Anthropic, AssemblyAI, local Whisper
   - Provider-specific settings (language, model)
   - *Build when*: Users request specific providers or cost concerns

4. **Real-Time Streaming**
   - Live transcription while recording
   - Show transcript building in real-time
   - Early task extraction
   - *Build when*: Users record long sessions (>30 min)

5. **Recording-Only Mode**
   - Use Array without PostHog (pure recorder)
   - Export tasks to Markdown/CSV
   - Standalone app mode
   - *Build when*: Users want tool without PostHog

### P2: Power User Features
6. **Advanced Editing**
   - Edit transcripts before task creation
   - Manually add/remove extracted tasks
   - Timestamp navigation
   - *Build when*: Transcription accuracy issues reported

7. **Organization & Search**
   - Tag recordings
   - Search transcripts
   - Folders/projects
   - Export transcripts
   - *Build when*: Users have 50+ recordings

8. **Team Features**
   - Share recordings with team
   - Shared prompt templates
   - Team transcription usage/costs
   - *Build when*: Teams using Array together

9. **Integration Enhancements**
   - Auto-tag tasks by meeting type
   - Link to calendar events
   - Attach to GitHub issues
   - Slack notifications
   - *Build when*: Integration requests from users

## Success Metrics

### V1 Goals (First Month)
- **Adoption**: 30% of active users record at least 1 audio
- **Usage**: Average 3 recordings per user per week
- **Conversion**: 70% of transcriptions → tasks created
- **NPS**: +40 from users who transcribe recordings

### Key Metrics to Track
- Recordings created per user
- Transcription completion rate
- Tasks created from transcriptions
- Time saved (estimated)
- Feature request themes
- Error rates (transcription failures, API issues)

### User Feedback Questions
1. How often do you record calls/meetings?
2. Is the transcription accurate enough?
3. Are extracted tasks relevant and actionable?
4. What other providers would you want?
5. What features are missing?

## Open Questions

### Pre-Launch
- [ ] Should we require OpenAI API key upfront or use Array's key with usage limits?
- [ ] How do we handle 25MB Whisper file size limit? (error message vs auto-chunking)
- [ ] Should recordings auto-transcribe or wait for user action? (cost concern)

### Post-Launch (answer based on data)
- [ ] Do users want meeting auto-detection?
- [ ] Do users record mostly short (<10 min) or long (>30 min) sessions?
- [ ] Is OpenAI Whisper accuracy good enough or do we need alternatives?
- [ ] Do users want to edit prompts or are defaults sufficient?
- [ ] Should we add speaker diarization (who said what)?

## Launch Plan

### Phase 1: Internal Testing (Week 1)
- Build and test locally
- Record real meetings
- Validate transcription quality
- Iterate on UI/UX

### Phase 2: Beta Users (Week 2)
- Ship to 10-20 beta users
- Gather feedback on accuracy and usefulness
- Monitor error rates and API costs
- Fix critical bugs

### Phase 3: General Availability (Week 3)
- Announce in app
- Update docs
- Monitor metrics
- Plan next iteration based on feedback

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **Poor transcription accuracy** | Use OpenAI Whisper (best in class), allow editing |
| **High API costs** | Manual transcription trigger, warn on large files |
| **Browser recording fails** | Clear error messages, fallback instructions |
| **Large file handling** | Show 25MB limit error, suggest shorter recordings |
| **Privacy concerns** | Local storage, encrypted keys, clear data policy |
| **Low adoption** | User education, in-app tutorial, example use cases |

## Appendix

### Competitive Analysis
- **Otter.ai**: Strong transcription, expensive, no task extraction
- **Fireflies.ai**: Meeting bot, not local, privacy concerns
- **Notion AI**: Meeting notes, requires Notion, no direct recording
- **Array advantage**: Integrated with task management, local-first, extensible

### Research & References
- [Vercel AI SDK Docs](https://sdk.vercel.ai/docs)
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [MDN MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

---

**Document Status**: Draft v1.0
**Last Updated**: 2025-10-15
**Owner**: Product / Engineering
**Next Review**: Post-launch + 2 weeks
