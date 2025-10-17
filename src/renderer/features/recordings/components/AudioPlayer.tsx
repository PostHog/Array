import { FastForward, Pause, Play, Rewind } from "@phosphor-icons/react";
import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

interface AudioPlayerProps {
  recordingId: string;
  duration: number;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ recordingId, duration }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsReady(false);

    const loadAudio = async () => {
      try {
        const buffer = await window.electronAPI.recordingGetFile(recordingId);
        if (!mounted) return;

        const blob = new Blob([buffer], { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;

        const audio = new Audio(url);

        // Wait for metadata to load
        await new Promise<void>((resolve) => {
          audio.addEventListener("loadedmetadata", () => resolve(), {
            once: true,
          });
        });

        if (!mounted) return;

        audioRef.current = audio;

        audio.addEventListener("timeupdate", () => {
          if (mounted) setCurrentTime(audio.currentTime);
        });

        audio.addEventListener("ended", () => {
          if (mounted) {
            setIsPlaying(false);
            setCurrentTime(0);
          }
        });

        audio.addEventListener("pause", () => {
          if (mounted) setIsPlaying(false);
        });

        audio.addEventListener("play", () => {
          if (mounted) setIsPlaying(true);
        });

        setIsReady(true);
      } catch (error) {
        console.error("Failed to load audio:", error);
      }
    };

    loadAudio();

    return () => {
      mounted = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, [recordingId]);

  const togglePlayPause = useCallback(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  }, [isPlaying]);

  const cyclePlaybackRate = useCallback(() => {
    if (!audioRef.current) return;
    const rates = [1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    audioRef.current.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  }, [playbackRate]);

  const skipBackward = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      audioRef.current.currentTime - 10,
    );
  }, []);

  const skipForward = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.min(
      duration,
      audioRef.current.currentTime + 10,
    );
  }, [duration]);

  useHotkeys(
    "space",
    (e) => {
      e.preventDefault();
      togglePlayPause();
    },
    { enableOnFormTags: false },
    [togglePlayPause],
  );

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2">
        <Button
          size="1"
          variant="ghost"
          color="gray"
          onClick={skipBackward}
          disabled={!isReady}
          title="Skip backward 10s"
        >
          <Rewind weight="fill" size={16} />
        </Button>

        <Button
          size="2"
          variant="soft"
          color={isPlaying ? "blue" : "gray"}
          onClick={togglePlayPause}
          disabled={!isReady}
        >
          {isPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
        </Button>

        <Button
          size="1"
          variant="ghost"
          color="gray"
          onClick={skipForward}
          disabled={!isReady}
          title="Skip forward 10s"
        >
          <FastForward weight="fill" size={16} />
        </Button>

        <Box style={{ flex: 1 }} />

        <Flex gap="2" align="center">
          <Text
            size="1"
            color="gray"
            style={{ minWidth: "80px", textAlign: "right" }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </Text>
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={cyclePlaybackRate}
            disabled={!isReady}
            style={{ minWidth: "40px" }}
          >
            <Text size="1">{playbackRate}x</Text>
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
