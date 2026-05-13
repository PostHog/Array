import Foundation

struct WatchMissionEnvelope: Codable {
    let schemaVersion: Int
    let generatedAt: TimeInterval
    let activeMissionId: String?
    let missions: [WatchMissionSnapshot]
}

struct WatchMissionSnapshot: Codable, Identifiable {
    let schemaVersion: Int
    let id: String
    let generatedAt: TimeInterval
    let source: String
    let taskId: String
    let taskRunId: String?
    let taskNumber: Int?
    let slug: String?
    let title: String
    let repository: String?
    let branch: String?
    let environment: String
    let status: String
    let statusText: String
    let currentTask: String?
    let createdAt: TimeInterval?
    let startedAt: TimeInterval?
    let updatedAt: TimeInterval?
    let completedAt: TimeInterval?
    let elapsedSeconds: Int
    let progress: WatchMissionProgress
    let checklist: [WatchMissionChecklistItem]
    let timeline: [WatchMissionTimelineItem]
    let approval: WatchMissionApproval?
    let blocker: WatchMissionBlocker?
    let lastError: String?
    let isStale: Bool
    let staleReason: String?
    let allowedActions: [String]
    let handoff: WatchMissionHandoff
}

struct WatchMissionProgress: Codable {
    let completed: Int
    let running: Int
    let pending: Int
    let failed: Int
    let total: Int
    let fraction: Double
}

struct WatchMissionChecklistItem: Codable, Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let status: String
    let priority: String?
    let depth: Int?
    let kind: String?
    let updatedAt: TimeInterval?
}

struct WatchMissionTimelineItem: Codable, Identifiable {
    let id: String
    let title: String
    let detail: String?
    let kind: String
    let timestamp: TimeInterval
}

struct WatchMissionApproval: Codable, Identifiable {
    let id: String
    let toolCallId: String
    let title: String
    let summary: String
    let detail: String?
    let risk: String
    let requestedAt: TimeInterval
    let options: [WatchMissionApprovalOption]
    let diffAvailable: Bool?
}

struct WatchMissionApprovalOption: Codable, Identifiable {
    let id: String
    let title: String
    let role: String
    let destructive: Bool?
}

struct WatchMissionBlocker: Codable {
    let title: String
    let detail: String?
    let kind: String
}

struct WatchMissionHandoff: Codable {
    let phoneUrl: String
    let macUrl: String?
    let webUrl: String?
}

struct WatchMissionCommand: Codable {
    let id: String
    let type: String
    let taskId: String
    let taskRunId: String?
    let toolCallId: String?
    let optionId: String?
    let displayText: String?
    let answers: [String: String]?
    let customInput: String?
    let url: String?
}
