import AVFoundation
import Capacitor
import Speech

// Talking into the inbox: Apple's speech recognizer turns what is said into the capture line as
// it is said. start() asks for the microphone and speech permissions the first time, listens,
// and sends "partial" events with the whole text so far; stop() ends it and the last event is
// the final text. On-device when the phone supports it, so nothing leaves the phone to dictate.

@objc(DictationPlugin)
public class DictationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DictationPlugin"
    public let jsName = "Dictation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    @objc func start(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.reject("Speech recognition is off for Mayorly. Turn it on in Settings, Privacy & Security, Speech Recognition.", "DENIED")
                return
            }
            let answered: (Bool) -> Void = { granted in
                guard granted else {
                    call.reject("The microphone is off for Mayorly. Turn it on in Settings, Privacy & Security, Microphone.", "DENIED")
                    return
                }
                DispatchQueue.main.async { self.begin(call) }
            }
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission(completionHandler: answered)
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission(answered)
            }
        }
    }

    private func begin(_ call: CAPPluginCall) {
        finish()
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            call.reject("Dictation is not available right now.")
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
            self.request = request
            let input = audio.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            audio.prepare()
            try audio.start()
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                if let result = result {
                    self?.notifyListeners(result.isFinal ? "final" : "partial", data: ["text": result.bestTranscription.formattedString])
                    if result.isFinal { self?.finish() }
                } else if error != nil {
                    self?.notifyListeners("final", data: ["text": ""])
                    self?.finish()
                }
            }
            call.resolve()
        } catch {
            finish()
            call.reject("Could not start listening: \(error.localizedDescription)")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Ending the audio lets the recognizer give its final text, which arrives as "final".
            self.request?.endAudio()
            self.audio.stop()
            self.audio.inputNode.removeTap(onBus: 0)
            call.resolve()
        }
    }

    private func finish() {
        if audio.isRunning {
            audio.stop()
            audio.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
