import { Box } from "@radix-ui/themes";
import { useEffect, useRef } from "react";

interface WaveformProps {
  audioUrl: string;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  isReady: boolean;
}

export function Waveform({
  audioUrl,
  currentTime,
  duration,
  onSeek,
  isReady,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformDataRef = useRef<number[]>([]);

  // Generate waveform data
  useEffect(() => {
    let mounted = true;

    const generateWaveform = async () => {
      try {
        const audioContext = new AudioContext();
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        if (!mounted) {
          audioContext.close();
          return;
        }

        // Sample the audio to create waveform
        const rawData = audioBuffer.getChannelData(0);
        const samples = 150; // Number of bars in waveform
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData: number[] = [];

        for (let i = 0; i < samples; i++) {
          const blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockStart + j]);
          }
          filteredData.push(sum / blockSize);
        }

        // Normalize
        const max = Math.max(...filteredData);
        const normalizedData = filteredData.map((v) => v / max);

        if (mounted) {
          waveformDataRef.current = normalizedData;
        }

        audioContext.close();
      } catch (error) {
        console.error("Failed to generate waveform:", error);
      }
    };

    if (audioUrl && isReady) {
      generateWaveform();
    }

    return () => {
      mounted = false;
    };
  }, [audioUrl, isReady]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformDataRef.current.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const data = waveformDataRef.current;
    const barWidth = width / data.length;
    const barGap = 1;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw bars
    data.forEach((value, i) => {
      const barHeight = value * height * 0.8; // 80% of height for padding
      const x = i * barWidth;
      const y = (height - barHeight) / 2;

      // Progress indicator: different color for played portion
      const progress = currentTime / duration;
      const barProgress = i / data.length;

      if (barProgress < progress) {
        ctx.fillStyle = "var(--accent-9)"; // Played portion
      } else {
        ctx.fillStyle = "var(--gray-6)"; // Unplayed portion
      }

      ctx.fillRect(x, y, barWidth - barGap, barHeight);
    });
  }, [currentTime, duration]);

  return (
    <Box style={{ width: "100%", height: "60px", position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={800}
        height={60}
        style={{
          width: "100%",
          height: "100%",
          cursor: "pointer",
        }}
        onClick={(e) => {
          if (!isReady) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const percent = x / rect.width;
          const newTime = percent * duration;
          onSeek(newTime);
        }}
      />
    </Box>
  );
}
