// Draws the modelgen icon (deep green squircle, isometric cube with a ruler-yellow top) to <out.png>, 1024x1024.
// Usage: swift scripts/make-icon.swift <out.png>
import AppKit

let px = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

// Squircle with the macOS icon margin.
ctx.saveGState()
ctx.addPath(CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824), cornerWidth: 185, cornerHeight: 185, transform: nil))
ctx.clip()
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
    CGColor(red: 0.24, green: 0.45, blue: 0.38, alpha: 1), CGColor(red: 0.13, green: 0.30, blue: 0.25, alpha: 1)
] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
ctx.restoreGState()

// Isometric cube.
let r: CGFloat = 270, c = CGPoint(x: 512, y: 500), h = r * 0.866
func p(_ dx: CGFloat, _ dy: CGFloat) -> CGPoint { CGPoint(x: c.x + dx, y: c.y + dy) }
let top = p(0, r), ur = p(h, r / 2), lr = p(h, -r / 2), bot = p(0, -r), ll = p(-h, -r / 2), ul = p(-h, r / 2)
func face(_ pts: [CGPoint], _ color: CGColor) {
    ctx.setFillColor(color)
    ctx.move(to: pts[0]); pts.dropFirst().forEach { ctx.addLine(to: $0) }; ctx.closePath()
    ctx.fillPath()
}
face([top, ur, c, ul], CGColor(red: 0.949, green: 0.761, blue: 0.188, alpha: 1))   // ruler yellow
face([ul, c, bot, ll], CGColor(red: 0.953, green: 0.961, blue: 0.949, alpha: 1))   // paper
face([c, ur, lr, bot], CGColor(red: 0.78, green: 0.83, blue: 0.80, alpha: 1))      // shade

// Edges.
ctx.setStrokeColor(CGColor(red: 0.13, green: 0.30, blue: 0.25, alpha: 1))
ctx.setLineWidth(14); ctx.setLineJoin(.round); ctx.setLineCap(.round)
ctx.move(to: ul); ctx.addLine(to: c); ctx.addLine(to: ur)
ctx.move(to: c); ctx.addLine(to: bot)
ctx.strokePath()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
