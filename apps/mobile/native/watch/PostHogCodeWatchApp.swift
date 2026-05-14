import SwiftUI

@main
struct PostHogCodeWatchApp: App {
    @StateObject private var store = WatchMissionStore()

    var body: some Scene {
        WindowGroup {
            MissionRootView()
                .environmentObject(store)
        }
    }
}
