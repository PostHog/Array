import SwiftUI

final class ExtensionDelegate: NSObject, WKExtensionDelegate {}

@main
struct PostHogCodeWatchApp: App {
    @WKExtensionDelegateAdaptor(ExtensionDelegate.self) var extensionDelegate
    @StateObject private var store = WatchMissionStore()

    var body: some Scene {
        WindowGroup {
            MissionRootView()
                .environmentObject(store)
        }
    }
}
