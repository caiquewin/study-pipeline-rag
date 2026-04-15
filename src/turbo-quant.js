/**
 * TurboQuant — Data-oblivious vector quantization
 *
 * Paper: https://arxiv.org/html/2504.19874v1
 *
 * Provides two quantizers:
 *   TurboQuantMSE  — minimises mean-squared error (MSE)
 *   TurboQuantProd — preserves inner products (unbiased estimator)
 *
 * Both work without training data by applying a random orthogonal rotation
 * that makes coordinates approximately i.i.d. Gaussian, allowing optimal
 * independent scalar quantization via the Lloyd-Max algorithm.
 */

// ── Math helpers ──────────────────────────────────────────────────────────────

/** Standard Gaussian PDF */
function gaussianPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** Error function (Abramowitz & Stegun 7.1.26, max error 1.5×10⁻⁷) */
function erf(x) {
    const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429]
    const t = 1 / (1 + 0.3275911 * Math.abs(x))
    const poly = t * (a[0] + t * (a[1] + t * (a[2] + t * (a[3] + t * a[4]))))
    const v = 1 - poly * Math.exp(-x * x)
    return x >= 0 ? v : -v
}

/** Standard Gaussian CDF */
function gaussianCDF(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2))
}

/** Dot product */
function dot(a, b) {
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i] * b[i]
    return s
}

/** L2 norm */
function norm(v) {
    return Math.sqrt(dot(v, v))
}

/** Matrix-vector product A (d×d) · v (d) — row-major A stored as Array of rows */
function matVec(A, v) {
    const d = v.length
    const out = new Float64Array(d)
    for (let i = 0; i < d; i++) {
        const row = A[i]
        for (let j = 0; j < d; j++) out[i] += row[j] * v[j]
    }
    return out
}

/** Transposed matrix-vector product Aᵀ · v */
function matVecT(A, v) {
    const d = v.length
    const out = new Float64Array(d)
    for (let j = 0; j < d; j++) {
        const row = A[j]
        for (let i = 0; i < d; i++) out[i] += row[i] * v[j]
    }
    return out
}

// ── Box-Muller N(0,1) sampler ─────────────────────────────────────────────────
export function randn() {
    let u, v
    do { u = Math.random() } while (u === 0)
    do { v = Math.random() } while (v === 0)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ── Lloyd-Max optimal scalar quantizer for N(0,1) ────────────────────────────

/**
 * Iterates the Lloyd-Max algorithm to find optimal centroids and decision
 * boundaries for quantizing X ~ N(0,1) into k = 2^bits levels.
 *
 * Centroid update:
 *   c_i = E[X | t_{i-1} ≤ X < t_i]
 *       = (φ(t_{i-1}) - φ(t_i)) / (Φ(t_i) - Φ(t_{i-1}))
 *
 * Boundary update (nearest-neighbour condition):
 *   t_i = (c_i + c_{i+1}) / 2
 */
function lloydMax(bits, maxIter = 1000, tol = 1e-14) {
    const k = 1 << bits
    const range = 4.5          // initialise centroids over ±4.5σ

    let centroids = Array.from({ length: k }, (_, i) =>
        -range + (2 * range * (i + 0.5)) / k
    )

    for (let iter = 0; iter < maxIter; iter++) {
        // Compute boundaries (midpoints)
        const boundaries = [Number.NEGATIVE_INFINITY]
        for (let i = 0; i < k - 1; i++) {
            boundaries.push((centroids[i] + centroids[i + 1]) / 2)
        }
        boundaries.push(Number.POSITIVE_INFINITY)

        // Update centroids
        const next = centroids.map((_, i) => {
            const a = boundaries[i]
            const b = boundaries[i + 1]
            const phiA = isFinite(a) ? gaussianPDF(a) : 0
            const phiB = isFinite(b) ? gaussianPDF(b) : 0
            const PhiA = isFinite(a) ? gaussianCDF(a) : 0
            const PhiB = isFinite(b) ? gaussianCDF(b) : 1
            const denom = PhiB - PhiA
            // Guard against empty cells at the tails
            return denom < 1e-15 ? (a + b) / 2 : (phiA - phiB) / denom
        })

        const maxDiff = Math.max(...next.map((c, i) => Math.abs(c - centroids[i])))
        centroids = next
        if (maxDiff < tol) break
    }

    const boundaries = [Number.NEGATIVE_INFINITY]
    for (let i = 0; i < k - 1; i++) {
        boundaries.push((centroids[i] + centroids[i + 1]) / 2)
    }
    boundaries.push(Number.POSITIVE_INFINITY)

    return { centroids, boundaries }
}

/** Binary search: return the bin index for `value` given sorted `boundaries` */
function findBin(value, boundaries) {
    let lo = 0, hi = boundaries.length - 2
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (value < boundaries[mid + 1]) hi = mid
        else lo = mid + 1
    }
    return lo
}

// ── Random orthogonal rotation matrix ────────────────────────────────────────

/**
 * Returns a d×d random orthogonal matrix Q (Haar-distributed over O(d))
 * computed via Gram-Schmidt on a random Gaussian matrix.
 */
function randomOrthogonalMatrix(d) {
    // Build a d×d Gaussian matrix stored column-wise as an array of column vectors
    const cols = Array.from({ length: d }, () =>
        Array.from({ length: d }, randn)
    )

    // Gram-Schmidt: orthonormalise each column against prior columns
    for (let j = 0; j < d; j++) {
        const v = cols[j]
        for (let k = 0; k < j; k++) {
            const proj = dot(v, cols[k])
            for (let i = 0; i < d; i++) v[i] -= proj * cols[k][i]
        }
        const n = norm(v)
        for (let i = 0; i < d; i++) v[i] /= n || 1
    }

    // Transpose into row-major layout expected by matVec
    const Q = Array.from({ length: d }, () => new Float64Array(d))
    for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) Q[i][j] = cols[j][i]
    }
    return Q
}

// ── TurboQuantMSE ─────────────────────────────────────────────────────────────

/**
 * MSE-optimal vector quantizer.
 *
 * Encoding (b bits/coord, total b·d bits):
 *   1. σ = ‖x‖ / √d          (per-vector scale; rotated coords ≈ N(0, σ²))
 *   2. y = Π · x              (random orthogonal rotation)
 *   3. idx_i = Lloyd-Max(y_i / σ)   for each i
 *
 * Decoding:
 *   1. ŷ_i = centroid[idx_i] · σ
 *   2. x̂ = Πᵀ · ŷ
 *
 * Theoretical distortion:
 *   D_mse ≤ (√(3π)/2) / 4^b  ≈ 2.72 × lower bound
 */
export class TurboQuantMSE {
    /**
     * @param {number} d    dimension of the vectors
     * @param {number} bits bits per coordinate, 1 ≤ bits ≤ 8
     */
    constructor(d, bits) {
        if (bits < 1 || bits > 8) throw new RangeError('bits must be between 1 and 8')
        this.d = d
        this.bits = bits
        this.k = 1 << bits

        const { centroids, boundaries } = lloydMax(bits)
        this.centroids = centroids
        this.boundaries = boundaries

        this.rotation = randomOrthogonalMatrix(d)
    }

    /**
     * Encode x ∈ ℝ^d.
     * @param  {number[]|Float64Array} x
     * @returns {{ indices: Uint8Array, scale: number }}
     */
    encode(x) {
        const arr = Array.from(x)
        const scale = norm(arr) / Math.sqrt(this.d)

        // Rotate
        const y = matVec(this.rotation, arr)

        // Quantise each coordinate
        const indices = new Uint8Array(this.d)
        for (let i = 0; i < this.d; i++) {
            const normalised = scale > 0 ? y[i] / scale : 0
            indices[i] = findBin(normalised, this.boundaries)
        }

        return { indices, scale }
    }

    /**
     * Decode back to ℝ^d.
     * @param  {{ indices: Uint8Array, scale: number }}
     * @returns {Float64Array}
     */
    decode({ indices, scale }) {
        // Reconstruct rotated vector from centroids
        const yHat = new Float64Array(this.d)
        for (let i = 0; i < this.d; i++) {
            yHat[i] = this.centroids[indices[i]] * scale
        }
        // Rotate back
        return matVecT(this.rotation, yHat)
    }

    /** Convenience: encode then immediately decode */
    roundTrip(x) {
        return this.decode(this.encode(x))
    }

    /**
     * Theoretical upper bound on normalised MSE: D_mse / ‖x‖²
     * (averaged over all coordinates, equals the per-coord distortion)
     */
    theoreticalDistortion() {
        return (Math.sqrt(3 * Math.PI) / 2) / Math.pow(4, this.bits)
    }
}

// ── TurboQuantProd ────────────────────────────────────────────────────────────

/**
 * Inner-product-preserving vector quantizer.
 *
 * Uses (bits−1) bits for an MSE sub-quantizer plus 1 bit of
 * Quantized Johnson-Lindenstrauss (QJL) on the residual to provide an
 * *unbiased* inner product estimator at the same total bit-budget.
 *
 * Encoding:
 *   1. Encode x with MSE at (bits−1) bits → x̂_mse, r = x − x̂_mse
 *   2. s = sign(gᵀr),  g ~ N(0, I_d) (precomputed once per instance)
 *   3. Store mseCode, s ∈ {±1}, ‖r‖
 *
 * Inner product estimation with query y:
 *   ⟨y, x⟩ ≈ ⟨y, x̂_mse⟩  +  √(π/2) · ‖r‖ · s · (gᵀy)
 *
 * The second term is unbiased:
 *   E_g[sign(gᵀr) · gᵀy] = √(2/π) · ⟨r,y⟩/‖r‖
 *   ⟹ E[correction] = ⟨r,y⟩  ✓
 */
export class TurboQuantProd {
    /**
     * @param {number} d    dimension
     * @param {number} bits total bits per coordinate (≥ 2)
     */
    constructor(d, bits) {
        if (bits < 2) throw new RangeError('TurboQuantProd requires bits >= 2')
        this.d = d
        this.bits = bits

        // MSE sub-quantizer at (bits−1) bits
        this.mse = new TurboQuantMSE(d, bits - 1)

        // Fixed random Gaussian vector for QJL
        this.g = Float64Array.from({ length: d }, randn)
    }

    /**
     * Encode x ∈ ℝ^d.
     * @param  {number[]|Float64Array} x
     * @returns {{ mseCode: object, qjlBit: 1|-1, residualNorm: number }}
     */
    encode(x) {
        const arr = Array.from(x)

        // Step 1 — MSE encode/decode at (bits−1) bits
        const mseCode = this.mse.encode(arr)
        const xMse = this.mse.decode(mseCode)

        // Step 2 — Residual
        const residual = arr.map((xi, i) => xi - xMse[i])
        const residualNorm = norm(residual)

        // Step 3 — QJL: 1-bit sign of gᵀr
        const qjlBit = dot(Array.from(this.g), residual) >= 0 ? 1 : -1

        return { mseCode, qjlBit, residualNorm }
    }

    /**
     * Estimate ⟨y, x⟩ without full decoding.
     * This is the primary operation for attention-style workloads.
     *
     * @param  {number[]|Float64Array} y  query vector
     * @param  encoded                    output of encode(x)
     * @returns {number}
     */
    estimateInnerProduct(y, { mseCode, qjlBit, residualNorm }) {
        const yArr = Array.from(y)

        // Term 1: ⟨y, x̂_mse⟩
        const xMse = this.mse.decode(mseCode)
        const term1 = dot(yArr, Array.from(xMse))

        // Term 2: unbiased QJL correction
        // Derivation: E[sign(gᵀr) · gᵀy] = √(2/π) · ⟨r,y⟩/‖r‖
        // So:  ⟨r,y⟩ ≈ √(π/2) · ‖r‖ · sign(gᵀr) · (gᵀy)
        const gDotY = dot(Array.from(this.g), yArr)
        const term2 = Math.sqrt(Math.PI / 2) * residualNorm * qjlBit * gDotY

        return term1 + term2
    }

    /**
     * Full decode to ℝ^d.
     * Prefer estimateInnerProduct for inner-product workloads — it uses
     * the QJL bit and is more accurate for that task.
     * @returns {Float64Array}
     */
    decode({ mseCode }) {
        return this.mse.decode(mseCode)
    }
}

// ── Metrics ───────────────────────────────────────────────────────────────────

/**
 * Measure normalised MSE between original and reconstructed vector.
 * Returns distortion = ‖x − x̂‖² / ‖x‖²
 */
export function msDistortion(x, xHat) {
    const xArr = Array.from(x)
    const xHatArr = Array.from(xHat)
    const errNorm = norm(xArr.map((xi, i) => xi - xHatArr[i]))
    const origNorm = norm(xArr)
    return origNorm === 0 ? 0 : (errNorm * errNorm) / (origNorm * origNorm)
}

/**
 * Relative inner-product error between exact ⟨x,y⟩ and estimated value.
 * Returns |exact − estimated| / (‖x‖·‖y‖)
 */
export function innerProductError(x, y, estimated) {
    const exact = dot(Array.from(x), Array.from(y))
    return Math.abs(exact - estimated) / (norm(Array.from(x)) * norm(Array.from(y)) || 1)
}
