import Foundation
import WatchKit

@MainActor
final class HapticsPolicy {
    private var lastApprovalId: String?
    private var lastTerminalMissionId: String?
    private var lastFailureMissionId: String?
    private var lastApprovalHapticAt: Date = .distantPast
    private var lastActionHapticAt: Date = .distantPast

    private let approvalCooldown: TimeInterval = 20
    private let actionCooldown: TimeInterval = 0.6

    func apply(snapshot: WatchMissionSnapshot) {
        let now = Date()

        if let approval = snapshot.approval,
           approval.id != lastApprovalId,
           now.timeIntervalSince(lastApprovalHapticAt) > approvalCooldown {
            lastApprovalId = approval.id
            lastApprovalHapticAt = now
            WKInterfaceDevice.current().play(.notification)
        }

        if snapshot.status == "completed", snapshot.id != lastTerminalMissionId {
            lastTerminalMissionId = snapshot.id
            WKInterfaceDevice.current().play(.success)
        }

        if (snapshot.status == "failed" || snapshot.status == "blocked" || snapshot.status == "stale"),
           snapshot.id != lastFailureMissionId {
            lastFailureMissionId = snapshot.id
            WKInterfaceDevice.current().play(.failure)
        }
    }

    func actionAccepted() {
        let now = Date()
        guard now.timeIntervalSince(lastActionHapticAt) > actionCooldown else { return }
        lastActionHapticAt = now
        WKInterfaceDevice.current().play(.click)
    }
}
