"use node";

/**
 * pdf.js (utilisé par pdf-parse) crée une `DOMMatrix` dès son chargement. L'environnement Node de Convex n'en
 * fournit pas (et le module natif @napi-rs/canvas n'y est pas disponible) : sans elle, tout PDF échoue avec
 * « DOMMatrix is not defined ». Cette version minimale (matrice affine 2D) suffit à la lecture du texte.
 */
class MinimalDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init?: number[] | string | MinimalDOMMatrix) {
    const v = Array.isArray(init) ? init : init && typeof init === "object" ? [init.a, init.b, init.c, init.d, init.e, init.f] : null;
    if (v && v.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = v;
    else if (v && v.length === 16) [this.a, this.b, this.c, this.d, this.e, this.f] = [v[0], v[1], v[4], v[5], v[12], v[13]];
  }
  get is2D() { return true; }
  get isIdentity() { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0; }
  multiplySelf(o: MinimalDOMMatrix) {
    const { a, b, c, d, e, f } = this;
    this.a = a * o.a + c * o.b; this.b = b * o.a + d * o.b;
    this.c = a * o.c + c * o.d; this.d = b * o.c + d * o.d;
    this.e = a * o.e + c * o.f + e; this.f = b * o.e + d * o.f + f;
    return this;
  }
  preMultiplySelf(o: MinimalDOMMatrix) {
    const r = new MinimalDOMMatrix(o).multiplySelf(this);
    [this.a, this.b, this.c, this.d, this.e, this.f] = [r.a, r.b, r.c, r.d, r.e, r.f];
    return this;
  }
  multiply(o: MinimalDOMMatrix) { return new MinimalDOMMatrix(this).multiplySelf(o); }
  translateSelf(tx = 0, ty = 0) { return this.multiplySelf(new MinimalDOMMatrix([1, 0, 0, 1, tx, ty])); }
  translate(tx = 0, ty = 0) { return new MinimalDOMMatrix(this).translateSelf(tx, ty); }
  scaleSelf(sx = 1, sy = sx) { return this.multiplySelf(new MinimalDOMMatrix([sx, 0, 0, sy, 0, 0])); }
  scale(sx = 1, sy = sx) { return new MinimalDOMMatrix(this).scaleSelf(sx, sy); }
  invertSelf() {
    const det = this.a * this.d - this.b * this.c;
    if (!det) { this.a = this.b = this.c = this.d = this.e = this.f = NaN; return this; }
    const { a, b, c, d, e, f } = this;
    this.a = d / det; this.b = -b / det; this.c = -c / det; this.d = a / det;
    this.e = (c * f - d * e) / det; this.f = (b * e - a * f) / det;
    return this;
  }
  inverse() { return new MinimalDOMMatrix(this).invertSelf(); }
  transformPoint(p: { x?: number; y?: number } = {}) {
    const x = p.x ?? 0, y = p.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.DOMMatrix === "undefined") g.DOMMatrix = MinimalDOMMatrix;
if (typeof g.Path2D === "undefined") g.Path2D = class { addPath() {} };
if (typeof g.ImageData === "undefined") g.ImageData = class { constructor(public data: unknown, public width: number, public height: number) {} };
