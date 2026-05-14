import Foundation
import SwiftUI
import WatchConnectivity

@MainActor
final class WatchTaskStore: NSObject, ObservableObject {
    @Published var envelope: WatchTaskEnvelope?
    @Published var connectionState: String = "Waiting for iPhone"
    @Published var lastCommandStatus: String?
    @Published var lastEnvelopeStatus: String?

    let haptics = HapticsPolicy()
    private let cacheKey = "watch_task_envelope"

    var tasks: [WatchTaskSnapshot] { envelope?.tasks ?? [] }

    var activeTask: WatchTaskSnapshot? {
        guard let envelope else { return tasks.first }
        if let activeId = envelope.activeTaskId {
            return envelope.tasks.first { $0.id == activeId } ?? envelope.tasks.first
        }
        return envelope.tasks.first
    }

    override init() {
        super.init()
        loadCachedEnvelope()
        activateSession()
        requestSnapshot()
    }

    func requestSnapshot() {
        lastCommandStatus = "Requesting latest tasks…"
        send(command: WatchTaskCommand(
            id: UUID().uuidString,
            type: "request_snapshot",
            taskId: "snapshot",
            taskRunId: nil,
            toolCallId: nil,
            optionId: nil,
            displayText: "Request latest task snapshot",
            answers: nil,
            customInput: nil,
            url: nil
        ))
    }

    func send(command: WatchTaskCommand) {
        lastCommandStatus = "Sending…"
        guard WCSession.isSupported() else {
            lastCommandStatus = "iPhone relay unavailable"
            return
        }

        let payload = encodeDictionary(command)
        let message: [String: Any] = ["type": "task_command", "payload": payload]
        let session = WCSession.default
        activateSession()

        if session.isReachable {
            session.sendMessage(message, replyHandler: { [weak self] reply in
                Task { @MainActor in
                    self?.haptics.actionAccepted()
                    self?.lastCommandStatus = (reply["ok"] as? Bool) == true ? "Sent" : "Failed"
                }
            }, errorHandler: { [weak self] _ in
                Task { @MainActor in
                    self?.lastCommandStatus = "Failed"
                }
            })
        } else {
            do {
                try session.updateApplicationContext(message)
                haptics.actionAccepted()
                lastCommandStatus = "Queued for iPhone"
            } catch {
                lastCommandStatus = "Failed"
            }
        }
    }

    private func activateSession() {
        guard WCSession.isSupported() else {
            connectionState = "WatchConnectivity unavailable"
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private func handleEnvelopePayload(_ payload: Any?) {
        guard let payload else {
            lastEnvelopeStatus = "Envelope missing payload"
            return
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: payload)
            let envelope = try JSONDecoder().decode(WatchTaskEnvelope.self, from: data)
            self.envelope = envelope
            self.connectionState = "Live"
            self.lastEnvelopeStatus = "iPhone update received at \(Date().formatted(date: .omitted, time: .standard))"
            if let activeId = envelope.activeTaskId,
               let active = envelope.tasks.first(where: { $0.id == activeId }) {
                haptics.apply(snapshot: active)
            } else if let first = envelope.tasks.first {
                haptics.apply(snapshot: first)
            }
            cache(data: data)
        } catch {
            connectionState = "Snapshot decode failed"
            lastEnvelopeStatus = error.localizedDescription
        }
    }

    private func encodeDictionary<T: Encodable>(_ value: T) -> [String: Any] {
        guard
            let data = try? JSONEncoder().encode(value),
            let object = try? JSONSerialization.jsonObject(with: data),
            let dictionary = object as? [String: Any]
        else { return [:] }
        return dictionary
    }

    private func cache(data: Data) {
        UserDefaults.standard.set(data, forKey: cacheKey)
    }

    private func loadCachedEnvelope() {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return }
        envelope = try? JSONDecoder().decode(WatchTaskEnvelope.self, from: data)
        if envelope != nil { connectionState = "Cached" }
    }
}

extension WatchTaskStore: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor in
            self.connectionState = activationState == .activated ? "Connected" : "Disconnected"
            if let payload = session.receivedApplicationContext["payload"] {
                self.handleEnvelopePayload(payload)
            }
            if activationState == .activated {
                self.requestSnapshot()
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in
            guard applicationContext["type"] as? String == "task_envelope" else { return }
            self.handleEnvelopePayload(applicationContext["payload"])
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in
            guard message["type"] as? String == "task_envelope" else { return }
            self.handleEnvelopePayload(message["payload"])
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        Task { @MainActor in
            guard message["type"] as? String == "task_envelope" else {
                replyHandler(["ok": false, "error": "unknown_type"])
                return
            }
            self.handleEnvelopePayload(message["payload"])
            replyHandler(["ok": true])
        }
    }
}
