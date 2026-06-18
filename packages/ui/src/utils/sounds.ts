import type { CompletionSound } from "@posthog/ui/features/settings/settingsStore";
import bubblesUrl from "../assets/sounds/bubbles.mp3";
import daniloUrl from "../assets/sounds/danilo.mp3";
import dropUrl from "../assets/sounds/drop.mp3";
import guitarUrl from "../assets/sounds/guitar.mp3";
import knockUrl from "../assets/sounds/knock.mp3";
import meepUrl from "../assets/sounds/meep.mp3";
import meepSmolUrl from "../assets/sounds/meep-smol.mp3";
import reviUrl from "../assets/sounds/revi.mp3";
import ringUrl from "../assets/sounds/ring.mp3";
import shootUrl from "../assets/sounds/shoot.mp3";
import slideUrl from "../assets/sounds/slide.mp3";
import switchUrl from "../assets/sounds/switch.mp3";
import wilhelmUrl from "../assets/sounds/wilhelm.mp3";

const SOUND_URLS: Record<Exclude<CompletionSound, "none">, string> = {
  guitar: guitarUrl,
  danilo: daniloUrl,
  revi: reviUrl,
  meep: meepUrl,
  "meep-smol": meepSmolUrl,
  bubbles: bubblesUrl,
  drop: dropUrl,
  knock: knockUrl,
  ring: ringUrl,
  shoot: shootUrl,
  slide: slideUrl,
  switch: switchUrl,
  wilhelm: wilhelmUrl,
};

let currentAudio: HTMLAudioElement | null = null;

export function playCompletionSound(sound: CompletionSound, volume = 80): void {
  if (sound === "none") return;

  const url = SOUND_URLS[sound];
  if (!url) return;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(100, volume)) / 100;
  currentAudio = audio;
  audio.play().catch(() => {
    // Audio play can fail if user hasn't interacted with the page yet
  });
  audio.addEventListener("ended", () => {
    if (currentAudio === audio) {
      currentAudio = null;
    }
  });
}
