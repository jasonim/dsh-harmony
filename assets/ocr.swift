// DSH Harmony local Vision OCR helper.
// Derived from the MIT-licensed helpers in ZSeven-W/dsh-ios and dsh-android.

import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write(Data("dsh-harmony ocr: usage: ocr <image.png>\n".utf8))
    exit(2)
}

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write(Data("dsh-harmony ocr: could not read image\n".utf8))
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true

do {
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
} catch {
    FileHandle.standardError.write(Data("dsh-harmony ocr: Vision failed\n".utf8))
    exit(1)
}

let width = Double(cgImage.width)
let height = Double(cgImage.height)
var items: [[String: Any]] = []
for observation in (request.results ?? []) {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let bounds = observation.boundingBox
    items.append([
        "text": candidate.string,
        "confidence": round(Double(candidate.confidence) * 100) / 100,
        "x": Int(bounds.minX * width),
        "y": Int((1 - bounds.maxY) * height),
        "w": Int(bounds.width * width),
        "h": Int(bounds.height * height),
    ])
}

let data = try JSONSerialization.data(withJSONObject: ["count": items.count, "items": items])
print(String(data: data, encoding: .utf8)!)
