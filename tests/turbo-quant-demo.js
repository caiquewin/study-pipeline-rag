/**
 * TurboQuant Demo
 *
 * Validates the implementation against the theoretical bounds from the paper.
 *
 * Usage:
 *   npm run turbo-quant
 */

import { TurboQuantMSE, TurboQuantProd, msDistortion, innerProductError, randn } from '../src/turbo-quant.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const randomVector = (d) => Float64Array.from({ length: d }, randn)

/** Average of an array */
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length

/** Print a separator line */
const sep = (char = '─', n = 65) => console.log(char.repeat(n))

// ── Test Suite ────────────────────────────────────────────────────────────────

async function runDemo() {
    console.log('\n╔═══════════════════════════════════════════════════════════════╗')
    console.log('║               TurboQuant — Validation Demo                    ║')
    console.log('║   Paper: https://arxiv.org/html/2504.19874v1                   ║')
    console.log('╚═══════════════════════════════════════════════════════════════╝\n')

    const D = 256          // vector dimension
    const N = 200          // number of random vectors to test
    const BITS_LIST = [1, 2, 3, 4]

    // ── 1. MSE Distortion vs Theoretical Bound ────────────────────────────────
    sep('═')
    console.log('1. TurboQuantMSE — Normalised distortion vs theoretical bound')
    console.log(`   d = ${D}, N = ${N} random vectors\n`)
    console.log(`   ${'Bits'.padEnd(6)} ${'Theoretical'.padEnd(14)} ${'Measured'.padEnd(14)} ${'Ratio'.padEnd(10)} Status`)
    sep()

    for (const bits of BITS_LIST) {
        const q = new TurboQuantMSE(D, bits)
        const theoretical = q.theoreticalDistortion()

        const distortions = Array.from({ length: N }, () => {
            const x = randomVector(D)
            const xHat = q.roundTrip(x)
            return msDistortion(x, xHat)
        })

        const measured = mean(distortions)
        const ratio = measured / theoretical
        const ok = measured <= theoretical * 1.5   // 50% margin for finite-d effects

        console.log(
            `   ${String(bits).padEnd(6)}` +
            ` ${theoretical.toExponential(4).padEnd(14)}` +
            ` ${measured.toExponential(4).padEnd(14)}` +
            ` ${ratio.toFixed(3).padEnd(10)}` +
            ` ${ok ? '✅' : '❌'}`
        )
    }

    // ── 2. MSE Round-trip Quality (visual) ───────────────────────────────────
    sep('═')
    console.log('\n2. TurboQuantMSE — Round-trip quality (first 8 coords of 1 vector)')
    console.log(`   d = ${D}\n`)

    const x = randomVector(D)
    for (const bits of BITS_LIST) {
        const q = new TurboQuantMSE(D, bits)
        const xHat = q.roundTrip(x)
        const coords = Array.from({ length: 8 }, (_, i) =>
            `${x[i].toFixed(3)} → ${xHat[i].toFixed(3)}`
        ).join('  ')
        console.log(`   ${bits}b: ${coords}`)
    }

    // ── 3. Inner Product Preservation (TurboQuantProd) ────────────────────────
    sep('═')
    console.log('\n3. TurboQuantProd — Inner product relative error')
    console.log(`   d = ${D}, N = ${N} random (x, y) pairs\n`)
    console.log(`   ${'Bits'.padEnd(6)} ${'MSE-only error'.padEnd(18)} ${'Prod error'.padEnd(18)} ${'Improvement'}`)
    sep()

    for (const bits of BITS_LIST.filter(b => b >= 2)) {
        const qProd = new TurboQuantProd(D, bits)
        const qMse  = new TurboQuantMSE(D, bits)

        const errorsProd = []
        const errorsMse  = []

        for (let n = 0; n < N; n++) {
            const xi = randomVector(D)
            const y  = randomVector(D)

            // TurboQuantProd — estimateInnerProduct
            const encoded = qProd.encode(xi)
            const estProd = qProd.estimateInnerProduct(y, encoded)
            errorsProd.push(innerProductError(xi, y, estProd))

            // Baseline TurboQuantMSE at same bit-count
            const xHatMse = qMse.roundTrip(xi)
            const estMse  = Array.from(xHatMse).reduce((s, v, i) => s + v * y[i], 0)
            errorsMse.push(innerProductError(xi, y, estMse))
        }

        const avgProd = mean(errorsProd)
        const avgMse  = mean(errorsMse)
        const improvement = avgMse / avgProd

        console.log(
            `   ${String(bits).padEnd(6)}` +
            ` ${avgMse.toFixed(5).padEnd(18)}` +
            ` ${avgProd.toFixed(5).padEnd(18)}` +
            ` ${improvement.toFixed(2)}×`
        )
    }

    // ── 4. Bit-budget vs Distortion curve ────────────────────────────────────
    sep('═')
    console.log('\n4. TurboQuantMSE — Distortion curve (d=512, N=100)\n')

    const D2 = 512
    const N2 = 100
    for (const bits of [1, 2, 3, 4]) {
        const q = new TurboQuantMSE(D2, bits)
        const ds = Array.from({ length: N2 }, () => {
            const v = randomVector(D2)
            return msDistortion(v, q.roundTrip(v))
        })
        const avg = mean(ds)
        const bar = '█'.repeat(Math.round(avg * 400))
        console.log(`   ${bits}b (${(bits * D2 / 8)} bytes/vec): ${avg.toExponential(3)}  ${bar}`)
    }

    // ── 5. Unbiasedness check for TurboQuantProd ─────────────────────────────
    sep('═')
    console.log('\n5. TurboQuantProd — Unbiasedness check')
    console.log('   E[⟨y, x̂⟩] should equal ⟨y, x⟩')
    console.log(`   d = ${D}, 500 samples of g (fixed x and y)\n`)

    const xFixed = randomVector(D)
    const yFixed = randomVector(D)
    const exact  = Array.from(xFixed).reduce((s, v, i) => s + v * yFixed[i], 0)

    // Run 500 independent TurboQuantProd instances (each has its own g)
    const estimates = Array.from({ length: 500 }, () => {
        const q = new TurboQuantProd(D, 2)
        const encoded = q.encode(xFixed)
        return q.estimateInnerProduct(yFixed, encoded)
    })

    const meanEst = mean(estimates)
    const bias    = Math.abs(meanEst - exact) / (Math.abs(exact) || 1)

    console.log(`   Exact ⟨y, x⟩  : ${exact.toFixed(6)}`)
    console.log(`   Mean estimate  : ${meanEst.toFixed(6)}`)
    console.log(`   Relative bias  : ${(bias * 100).toFixed(3)}%  ${bias < 0.05 ? '✅ unbiased' : '❌ biased'}`)

    sep('═')
    console.log('\n✅ TurboQuant demo complete.\n')
}

runDemo().catch(err => {
    console.error('❌ Demo error:', err)
    process.exit(1)
})
