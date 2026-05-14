import SwiftUI

@main
struct PostHogCodeWatchApp: App {
    @StateObject private var store = WatchMissionStore()

    var body: some Scene {
        WindowGroup {
            TasksRootView()
                .environmentObject(store)
        }
    }
}
