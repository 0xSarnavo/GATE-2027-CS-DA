import AppKit

func render(_ source: String, _ destination: String, _ width: Int, _ height: Int) {
    guard let image = NSImage(contentsOfFile: source),
          let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                                        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0,
                                        bitsPerPixel: 0),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Could not open \(source)")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: width, height: height),
               from: .zero, operation: .sourceOver, fraction: 1)
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode \(destination)")
    }
    try! data.write(to: URL(fileURLWithPath: destination))
}

guard (4...5).contains(CommandLine.arguments.count),
      let width = Int(CommandLine.arguments[3]),
      let height = CommandLine.arguments.count == 5 ? Int(CommandLine.arguments[4]) : width else {
    fatalError("Usage: swift render.swift SOURCE.svg OUTPUT.png WIDTH [HEIGHT]")
}
render(CommandLine.arguments[1], CommandLine.arguments[2], width, height)
