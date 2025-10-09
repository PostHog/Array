import { type BrowserWindow, Notification } from "electron";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class MeetingDetector {
  private checkInterval: NodeJS.Timeout | null = null;
  private meetingInProgress = false;
  private notificationShown = false;
  private getMainWindow: () => BrowserWindow | null;
  private onStartRecording: () => void;

  constructor(
    getMainWindow: () => BrowserWindow | null,
    onStartRecording: () => void,
  ) {
    this.getMainWindow = getMainWindow;
    this.onStartRecording = onStartRecording;
  }

  start(): void {
    // Check every 5 seconds
    this.checkInterval = setInterval(() => {
      this.checkForMeeting();
    }, 5000);

    // Check immediately on start
    this.checkForMeeting();
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async checkForMeeting(): Promise<void> {
    try {
      let meetingDetected = false;
      let detectedApp = "Meeting";

      // Check if any browsers or meeting apps are running
      const { stdout: psOutput } = await execAsync("ps aux");
      const processes = psOutput;

      // Check for Google Meet - use tab title to detect meeting
      if (!meetingDetected && processes.toLowerCase().includes("google chrome")) {
        try {
          const { stdout: chromeTitle } = await execAsync(
            'osascript -e \'tell application "Google Chrome" to get title of active tab of first window\' 2>/dev/null || echo ""'
          );

          const title = chromeTitle.toLowerCase().trim();
          if (title.includes("meet.google.com") || title.includes("google meet")) {
            meetingDetected = true;
            detectedApp = "Google Meet";
          }
        } catch (err) {
          // Ignore AppleScript errors
        }
      }

      // Check for Zoom - detect when in active meeting (has UDP connections for audio/video)
      if (!meetingDetected && processes.toLowerCase().includes("zoom.us")) {
        try {
          const { stdout: zoomUdp } = await execAsync("lsof -i UDP -a -c zoom.us 2>/dev/null | grep -v LISTEN | wc -l");
          const udpCount = Number.parseInt(zoomUdp.trim(), 10);
          // Zoom uses UDP for audio/video when in an active meeting
          if (udpCount > 0) {
            meetingDetected = true;
            detectedApp = "Zoom";
          }
        } catch (err) {
          // Ignore lsof errors
        }
      }

      if (meetingDetected && !this.meetingInProgress) {
        this.meetingInProgress = true;
        this.showRecordingNotification();
      } else if (!meetingDetected && this.meetingInProgress) {
        this.meetingInProgress = false;
        this.notificationShown = false;
      }
    } catch (error) {
      console.error("Error checking for meeting:", error);
    }
  }

  private showRecordingNotification(): void {
    if (this.notificationShown) {
      return;
    }

    this.notificationShown = true;

    try {
      const notification = new Notification({
        title: "Meeting Detected",
        body: "Array will start recording when you click this notification",
        silent: false,
        urgency: "critical",
        timeoutType: "never",
      });

      notification.on("click", () => {
        const mainWindow = this.getMainWindow();
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
        this.onStartRecording();
      });

      notification.once("failed", (_event, error) => {
        console.error("Notification failed:", error);
      });

      notification.show();
    } catch (error) {
      console.error("Error creating/showing notification:", error);
    }
  }
}
