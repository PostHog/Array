import SwiftUI

@main
struct PostHogCodeWatchApp: App {
    @StateObject private var store = WatchTaskStore()

    var body: some Scene {
        WindowGroup {
            WatchHomeView()
                .environmentObject(store)
        }
    }
}
