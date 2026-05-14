import Foundation

struct WatchTaskEnvelope: Codable {
    let schemaVersion: Int
    let generatedAt: TimeInterval
    let isAuthenticated: Bool?
    let activeTaskId: String?
    let tasks: [WatchTaskSnapshot]

    enum CodingKeys: String, CodingKey {
        case schemaVersion
        case generatedAt
        case isAuthenticated
        case activeTaskId = "activeTaskId"
        case tasks = "tasks"
    }
}

struct WatchTaskSnapshot: Codable, Identifiable {
    let schemaVersion: Int
    let id: String
    let generatedAt: TimeInterval
    let source: String
    let taskId: String
    let taskRunId: String?
    let taskNumber: Int?
    let slug: String?
    let title: String
    let subtitle: String?
    let repository: String?
    let branch: String?
    let `internal`: Bool?
    let isArchived: Bool?
    let environment: String
    let status: String
    let statusText: String
    let currentTask: String?
    let createdAt: TimeInterval?
    let startedAt: TimeInterval?
    let updatedAt: TimeInterval?
    let completedAt: TimeInterval?
    let elapsedSeconds: Int
    let progress: WatchTaskProgress
    let checklist: [WatchTaskChecklistItem]
    let timeline: [WatchTaskTimelineItem]
    let approval: WatchTaskApproval?
    let blocker: WatchTaskBlocker?
    let lastError: String?
    let isStale: Bool
    let staleReason: String?
    let allowedActions: [String]
    let handoff: WatchTaskHandoff
}

struct WatchTaskProgress: Codable {
    let completed: Int
    let running: Int
    let pending: Int
    let failed: Int
    let total: Int
    let fraction: Double
}

struct WatchTaskChecklistItem: Codable, Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let status: String
    let priority: String?
    let depth: Int?
    let kind: String?
    let updatedAt: TimeInterval?
}

struct WatchTaskTimelineItem: Codable, Identifiable {
    let id: String
    let title: String
    let detail: String?
    let kind: String
    let timestamp: TimeInterval
}

struct WatchTaskApproval: Codable, Identifiable {
    let id: String
    let toolCallId: String
    let title: String
    let summary: String
    let detail: String?
    let risk: String
    let requestedAt: TimeInterval
    let options: [WatchTaskApprovalOption]
    let diffAvailable: Bool?
}

struct WatchTaskApprovalOption: Codable, Identifiable {
    let id: String
    let title: String
    let role: String
    let destructive: Bool?
}

struct WatchTaskBlocker: Codable {
    let title: String
    let detail: String?
    let kind: String
}

struct WatchTaskHandoff: Codable {
    let phoneUrl: String
    let macUrl: String?
    let webUrl: String?
}

struct WatchTaskCommand: Codable {
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
