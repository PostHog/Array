import { Audio } from "expo-av";
import {
  type CompletionSound,
  usePreferencesStore,
} from "@/features/preferences/stores/preferencesStore";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dropAsset = require("../../../../assets/sounds/drop.mp3");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const knockAsset = require("../../../../assets/sounds/knock.mp3");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const meepAsset = require("../../../../assets/sounds/meep.mp3");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const meepSmolAsset = require("../../../../assets/sounds/meep-smol.mp3");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ringAsset = require("../../../../assets/sounds/ring.mp3");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const shootAsset = require("../../../../assets/sounds/shoot.mp3");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const slideAsset = require("../../../../assets/sounds/slide.mp3");

const SOUND_ASSETS: Record<CompletionSound, number> = {
  meep: meepAsset,
  "meep-smol": meepSmolAsset,
  knock: knockAsset,
  ring: ringAsset,
  shoot: shootAsset,
  slide: slideAsset,
  drop: dropAsset,
};

let audioModeConfigured = false;

async function ensureAudioMode(): Promise<void> {
  if (audioModeConfigured) return;
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  audioModeConfigured = true;
}

export async function playCompletionSound(
  sound?: CompletionSound,
  volume?: number,
): Promise<void> {
  const prefs = usePreferencesStore.getState();
  const which = sound ?? prefs.completionSound;
  const vol = (volume ?? prefs.completionVolume) / 100;
  await ensureAudioMode();
  const { sound: player } = await Audio.Sound.createAsync(SOUND_ASSETS[which], {
    shouldPlay: true,
    volume: Math.max(0, Math.min(1, vol)),
  });
  player.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) {
      player.unloadAsync();
    }
  });
}

// Kept as an alias so existing call sites continue to work; routes through
// the user's selected completion sound.
export function playMeepSound(): Promise<void> {
  return playCompletionSound();
}
