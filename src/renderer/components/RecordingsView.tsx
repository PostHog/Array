import {
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Kbd,
  Text,
  Card,
} from "@radix-ui/themes";
import {
  PlayIcon,
  StopIcon,
  TrashIcon,
  FileTextIcon,
  CheckIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import type { Recording } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useAuthStore } from "../stores/authStore";
import { useTaskStore } from "../stores/taskStore";
import { useTabStore } from "../stores/tabStore";
import { useRecording } from "../hooks/useRecording";
import { useTranscription } from "../hooks/useTranscription";
import { useMeetingDetection } from "../hooks/useMeetingDetection";

interface RecordingsViewProps {
  startRecordingTrigger?: number;
}

export function RecordingsView({ startRecordingTrigger }: RecordingsViewProps) {
  const { openaiApiKey } = useAuthStore();
  const { createTask } = useTaskStore();
  const { addTab } = useTabStore();

  // Custom hooks for recording, transcription, and meeting detection
  const {
    isRecording,
    recordingDuration,
    error: recordingError,
    handleStartRecording,
    handleStopRecording,
  } = useRecording();

  const { transcribingId, handleTranscribe } = useTranscription();

  // Remaining component state
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [viewingTranscription, setViewingTranscription] = useState<Recording | null>(null);
  const [createdTaskIds, setCreatedTaskIds] = useState<Set<string>>(new Set());
  const [selectedTaskIndex, setSelectedTaskIndex] = useState<number | null>(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const transcriptionContentRef = useRef<HTMLDivElement | null>(null);

  // Use meeting detection hook
  useMeetingDetection(startRecordingTrigger, isRecording, handleStartRecording);

  // Merge recording errors with component errors
  useEffect(() => {
    if (recordingError) {
      setError(recordingError);
    }
  }, [recordingError]);

  // Load recordings on mount
  useEffect(() => {
    loadRecordings();
  }, []);

  // Set initial selection when recordings load
  useEffect(() => {
    if (recordings.length > 0 && selectedIndex === null) {
      setSelectedIndex(0);
    }
  }, [recordings.length]);

  // Set initial task selection when transcription panel opens
  useEffect(() => {
    if (viewingTranscription && viewingTranscription.transcription?.extracted_tasks?.length) {
      setSelectedTaskIndex(0);
    } else {
      setSelectedTaskIndex(null);
    }
  }, [viewingTranscription]);

  // Handle keyboard shortcuts for closing transcription panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewingTranscription && e.key === "Escape") {
        setViewingTranscription(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewingTranscription]);

  // Scroll selected task into view (manual scroll to prevent ancestor scrolling)
  useEffect(() => {
    if (selectedTaskIndex !== null && viewingTranscription && transcriptionContentRef.current) {
      const taskElement = document.querySelector(`[data-task-index="${selectedTaskIndex}"]`) as HTMLElement;
      const container = transcriptionContentRef.current;

      if (taskElement && container) {
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;

        const taskTop = taskElement.offsetTop;
        const taskBottom = taskTop + taskElement.offsetHeight;

        // Scroll only if element is outside visible area
        if (taskTop < containerTop) {
          container.scrollTop = taskTop;
        } else if (taskBottom > containerBottom) {
          container.scrollTop = taskBottom - container.clientHeight;
        }
      }
    }
  }, [selectedTaskIndex, viewingTranscription]);

  // Keyboard navigation for recordings list
  const handleKeyNavigation = useCallback(
    (direction: "up" | "down") => {
      // If transcription panel is open, navigate tasks instead
      if (viewingTranscription?.transcription?.extracted_tasks?.length) {
        const tasksCount = viewingTranscription.transcription.extracted_tasks.length;
        const startIndex = selectedTaskIndex ?? 0;
        if (direction === "up") {
          setSelectedTaskIndex(Math.max(0, startIndex - 1));
        } else {
          setSelectedTaskIndex(Math.min(tasksCount - 1, startIndex + 1));
        }
      } else {
        // Navigate recordings list
        const startIndex = selectedIndex ?? 0;
        if (direction === "up") {
          setSelectedIndex(Math.max(0, startIndex - 1));
        } else {
          setSelectedIndex(Math.min(recordings.length - 1, startIndex + 1));
        }
      }
    },
    [recordings.length, selectedIndex, viewingTranscription, selectedTaskIndex],
  );

  const handleSelectCurrent = useCallback(async () => {
    // If transcription panel is open, create the selected task
    if (viewingTranscription?.transcription?.extracted_tasks?.length && selectedTaskIndex !== null) {
      const task = viewingTranscription.transcription.extracted_tasks[selectedTaskIndex];
      const taskKey = `${viewingTranscription.id}-${task.title}`;

      // Don't create if already created
      if (!createdTaskIds.has(taskKey)) {
        await handleCreateTaskFromExtraction(task.title, task.description);
      }
      return;
    }

    // Otherwise, open the selected recording
    if (selectedIndex === null || !recordings[selectedIndex]) return;

    const recording = recordings[selectedIndex];
    setViewingTranscription(recording);
  }, [recordings, selectedIndex, viewingTranscription, selectedTaskIndex, createdTaskIds]);

  const handleTranscribeRecording = useCallback(async (recording: Recording) => {
    if (!openaiApiKey) {
      setError("OpenAI API key not configured. Please add it in Sources.");
      return;
    }

    const result = await handleTranscribe(recording, openaiApiKey, (updatedRecording) => {
      setRecordings((prev) =>
        prev.map((r) => (r.id === updatedRecording.id ? updatedRecording : r)),
      );
      if (viewingTranscription?.id === updatedRecording.id) {
        setViewingTranscription(updatedRecording);
      }
    });

    if (result.error) {
      setError(result.error);
    }
  }, [openaiApiKey, handleTranscribe, viewingTranscription]);

  const handlePlayPauseToggle = useCallback(async () => {
    if (!viewingTranscription) return;

    if (playingId === viewingTranscription.id && isPlaying) {
      handlePausePlayback();
    } else if (playingId === viewingTranscription.id) {
      await handleResumePlayback();
    } else {
      await handlePlayRecording(viewingTranscription);
    }
  }, [viewingTranscription, playingId, isPlaying]);

  const handleRetranscribe = useCallback(async () => {
    if (!viewingTranscription) return;
    await handleTranscribeRecording(viewingTranscription);
  }, [viewingTranscription, handleTranscribeRecording]);

  useHotkeys(
    "up",
    () => handleKeyNavigation("up"),
    { enableOnFormTags: false },
    [handleKeyNavigation],
  );
  useHotkeys(
    "down",
    () => handleKeyNavigation("down"),
    { enableOnFormTags: false },
    [handleKeyNavigation],
  );
  useHotkeys(
    "enter",
    handleSelectCurrent,
    { enableOnFormTags: false },
    [handleSelectCurrent],
  );
  useHotkeys(
    "space",
    (e) => {
      e.preventDefault();
      handlePlayPauseToggle();
    },
    { enableOnFormTags: false },
    [handlePlayPauseToggle],
  );

  const loadRecordings = async () => {
    try {
      const recordingsList =
        await window.electronAPI.recordingList();
      setRecordings(recordingsList);
    } catch (err) {
      console.error("Failed to load recordings:", err);
      setError("Failed to load recordings");
    }
  };

  // Wrapper to handle post-recording actions (reload and auto-transcribe)
  const handleStopRecordingWithActions = async () => {
    const result = await handleStopRecording();
    if (result.success) {
      await loadRecordings();

      // Automatically transcribe the recording if OpenAI API key is configured
      if (openaiApiKey && result.recording) {
        const transcribeResult = await handleTranscribe(
          result.recording,
          openaiApiKey,
          (updatedRecording) => {
            setRecordings((prev) =>
              prev.map((r) =>
                r.id === updatedRecording.id ? updatedRecording : r,
              ),
            );
            if (viewingTranscription?.id === updatedRecording.id) {
              setViewingTranscription(updatedRecording);
            }
          },
        );

        if (transcribeResult.error) {
          setError(transcribeResult.error);
        }
      }
    }
  };

  // Keyboard shortcuts for recording
  useHotkeys(
    "r",
    () => {
      if (viewingTranscription) {
        handleRetranscribe();
      } else if (!isRecording) {
        handleStartRecording();
      }
    },
    { enableOnFormTags: false },
    [handleRetranscribe, viewingTranscription, isRecording, handleStartRecording],
  );
  useHotkeys(
    "s",
    () => {
      if (isRecording) {
        handleStopRecordingWithActions();
      }
    },
    { enableOnFormTags: false },
    [isRecording, handleStopRecordingWithActions],
  );

  const handlePlayRecording = async (recording: Recording) => {
    try {
      // Get the recording file from main process
      const arrayBuffer = await window.electronAPI.recordingGetFile(
        recording.id,
      );

      // Create a blob from the array buffer
      const blob = new Blob([arrayBuffer], { type: "audio/webm" });
      const url = URL.createObjectURL(blob);

      // Create audio element
      const audio = new Audio(url);
      audioElementRef.current = audio;

      // Set up event listeners
      audio.onended = () => {
        setIsPlaying(false);
        setAudioProgress(0);
        URL.revokeObjectURL(url);
      };

      audio.ontimeupdate = () => {
        if (audio.duration) {
          setAudioProgress((audio.currentTime / audio.duration) * 100);
        }
      };

      setPlayingId(recording.id);
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error("Failed to play recording:", err);
      setError("Failed to play recording");
    }
  };

  const handlePausePlayback = () => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleResumePlayback = async () => {
    if (audioElementRef.current) {
      await audioElementRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (percentage: number) => {
    if (audioElementRef.current && audioElementRef.current.duration) {
      audioElementRef.current.currentTime = (percentage / 100) * audioElementRef.current.duration;
      setAudioProgress(percentage);
    }
  };

  const handleDeleteRecording = async (recordingId: string) => {
    try {
      await window.electronAPI.recordingDelete(recordingId);
      await loadRecordings();
    } catch (err) {
      console.error("Failed to delete recording:", err);
      setError("Failed to delete recording");
    }
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const handleCreateTaskFromExtraction = async (title: string, description: string) => {
    try {
      const task = await createTask(title, description);
      if (task) {
        setCreatedTaskIds(prev => new Set([...prev, `${viewingTranscription?.id}-${title}`]));
        // Open the task in a new tab
        addTab({
          id: task.id,
          type: "task-detail",
          title: task.title,
          data: task,
        });
      }
    } catch (err) {
      console.error("Failed to create task:", err);
      setError("Failed to create task");
    }
  };

  return (
    <Flex height="100vh" style={{ overflow: "hidden" }}>
      {/* Main content */}
      <Flex
        direction="column"
        style={{
          flex: viewingTranscription ? "0 0 50%" : "1",
          transition: "flex 0.2s ease",
          overflow: "hidden"
        }}
      >
        {/* Header */}
        <Flex
          p="4"
          justify="between"
          align="center"
          style={{ borderBottom: "1px solid var(--gray-6)" }}
        >
          <Heading size="5">Call Recordings</Heading>
          {isRecording ? (
            <Flex align="center" gap="3">
              <Text size="2" weight="bold" color="red">
                Recording: {formatDuration(recordingDuration)}
              </Text>
              <Flex align="center" gap="2">
                <Text size="2" color="red">
                  Stop
                </Text>
                <Kbd size="1">S</Kbd>
              </Flex>
            </Flex>
          ) : (
            <Flex align="center" gap="2">
              <Text size="2">
                Record
              </Text>
              <Kbd size="1">R</Kbd>
            </Flex>
          )}
        </Flex>

        {/* Error message */}
        {error && (
          <Box p="4" style={{ borderBottom: "1px solid var(--gray-6)", backgroundColor: "var(--red-2)" }}>
            <Text size="2" color="red">
              {error}
            </Text>
          </Box>
        )}

        {/* Recordings List */}
        <Box style={{ flex: 1, overflowY: "auto", overflowAnchor: "none" }}>
          {recordings.length > 0 ? (
            recordings.map((recording, index) => {
              const isSelected = selectedIndex === index;
              return (
                <Flex
                  key={recording.id}
                  p="3"
                  align="center"
                  gap="3"
                  style={{
                    borderBottom: "1px solid var(--gray-6)",
                    backgroundColor: isSelected
                      ? (viewingTranscription ? "var(--gray-3)" : "var(--accent-3)")
                      : "transparent",
                    cursor: "pointer",
                    transition: "background-color 0.1s"
                  }}
                  onClick={() => {
                    setSelectedIndex(index);
                    setViewingTranscription(recording);
                  }}
                  onMouseEnter={() => !viewingTranscription && !isSelected && setSelectedIndex(index)}
                >
                  {/* Duration and status icons */}
                  <Flex direction="column" align="start" minWidth="80px">
                    <Text size="2" weight="medium">
                      {formatDuration(recording.duration)}
                    </Text>
                    <Text size="1" color="gray">
                      {formatDate(recording.created_at)}
                    </Text>
                  </Flex>

                  {/* Title/filename and transcription status */}
                  <Flex direction="column" gap="1" flexGrow="1" style={{ minWidth: 0 }}>
                    <Text size="2" truncate>
                      {recording.transcription?.summary || recording.filename}
                    </Text>
                    {transcribingId === recording.id ? (
                      <Text size="1" color="blue">
                        Transcribing and extracting tasks...
                      </Text>
                    ) : recording.transcription && (
                      <Text
                        size="1"
                        color={
                          recording.transcription.status === "completed"
                            ? "green"
                            : recording.transcription.status === "error"
                              ? "red"
                              : "gray"
                        }
                      >
                        {recording.transcription.status === "completed"
                          ? "Transcribed"
                          : recording.transcription.status}
                      </Text>
                    )}
                  </Flex>

                  {/* Delete button */}
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteRecording(recording.id);
                    }}
                  >
                    <TrashIcon />
                  </IconButton>
                </Flex>
              );
            })
          ) : (
            <Flex align="center" justify="center" p="8">
              <Text size="2" color="gray">
                No recordings yet. Click "Start Recording" to begin.
              </Text>
            </Flex>
          )}
        </Box>
      </Flex>

      {/* Side panel for transcription */}
      {viewingTranscription && (
        <Flex
          direction="column"
          style={{
            flex: "0 0 50%",
            borderLeft: "1px solid var(--gray-6)",
            backgroundColor: "var(--color-panel)",
            height: "100vh"
          }}
        >
          {/* Header */}
          <Flex
            p="4"
            justify="between"
            align="center"
            style={{ borderBottom: "1px solid var(--gray-6)" }}
          >
            <Flex direction="column" gap="1">
              <Heading size="4">
                {viewingTranscription.transcription?.summary || "Transcription"}
              </Heading>
              <Text size="1" color="gray">
                {viewingTranscription.filename}
              </Text>
            </Flex>
            <Flex align="center" gap="3">
              <Flex align="center" gap="2">
                <Button
                  size="1"
                  variant="soft"
                  onClick={handleRetranscribe}
                  disabled={transcribingId === viewingTranscription.id}
                >
                  Re-transcribe
                </Button>
                <Kbd size="1">R</Kbd>
              </Flex>
              <Flex align="center" gap="2">
                <Text
                  size="2"
                  style={{ cursor: "pointer" }}
                  onClick={() => setViewingTranscription(null)}
                >
                  Close
                </Text>
                <Kbd size="1">Esc</Kbd>
              </Flex>
            </Flex>
          </Flex>

          {/* Audio Player */}
          <Box p="4" style={{ borderBottom: "1px solid var(--gray-6)" }}>
            <Flex direction="column" gap="2">
              <Flex align="center" gap="3">
                {playingId === viewingTranscription.id && isPlaying ? (
                  <IconButton
                    size="2"
                    variant="soft"
                    onClick={handlePausePlayback}
                  >
                    <StopIcon />
                  </IconButton>
                ) : (
                  <IconButton
                    size="2"
                    variant="soft"
                    onClick={() => {
                      if (playingId === viewingTranscription.id) {
                        handleResumePlayback();
                      } else {
                        handlePlayRecording(viewingTranscription);
                      }
                    }}
                  >
                    <PlayIcon />
                  </IconButton>
                )}
                <Kbd size="1">Space</Kbd>
                <Box flexGrow="1">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={playingId === viewingTranscription.id ? audioProgress : 0}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    style={{
                      width: "100%",
                      cursor: "pointer",
                    }}
                  />
                </Box>
              </Flex>
            </Flex>
          </Box>

          {/* Content */}
          <Box p="4" flexGrow="1" style={{ overflowY: "auto" }} ref={transcriptionContentRef as any}>
            {/* Extracted Tasks */}
            {viewingTranscription.transcription?.extracted_tasks &&
             viewingTranscription.transcription.extracted_tasks.length > 0 && (
              <Box mb="4">
                <Heading size="3" mb="3">Extracted Tasks</Heading>
                <Flex direction="column" gap="2">
                  {viewingTranscription.transcription.extracted_tasks.map((task, index) => {
                    const taskKey = `${viewingTranscription.id}-${task.title}`;
                    const isCreated = createdTaskIds.has(taskKey);
                    const isSelected = selectedTaskIndex === index;

                    return (
                      <Card
                        key={index}
                        data-task-index={index}
                        style={{
                          backgroundColor: isSelected ? "var(--accent-3)" : undefined,
                          cursor: "pointer"
                        }}
                        onClick={() => setSelectedTaskIndex(index)}
                      >
                        <Flex justify="between" align="start" gap="3">
                          <Flex direction="column" gap="2" flexGrow="1">
                            <Text size="2" weight="bold">
                              {task.title}
                            </Text>
                            <Text size="1" color="gray">
                              {task.description}
                            </Text>
                          </Flex>
                          {isSelected && !isCreated && (
                            <Flex align="center" gap="2">
                              <Kbd size="1">Enter</Kbd>
                              <Text size="2">Create</Text>
                            </Flex>
                          )}
                          {isCreated && (
                            <Flex align="center" gap="2">
                              <CheckIcon color="green" />
                              <Text size="2" color="green">Created</Text>
                            </Flex>
                          )}
                        </Flex>
                      </Card>
                    );
                  })}
                </Flex>
              </Box>
            )}

            {/* Transcription Text */}
            <Box>
              <Heading size="3" mb="3">Full Transcript</Heading>
              <Text size="2" style={{ whiteSpace: "pre-wrap", lineHeight: "1.6" }}>
                {viewingTranscription.transcription?.text}
              </Text>
            </Box>
          </Box>
        </Flex>
      )}
    </Flex>
  );
}
