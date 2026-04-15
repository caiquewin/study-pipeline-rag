/**
 * Testes E2E — Ciclo completo: agendar → listar → reagendar → listar → cancelar → listar
 *
 * Pré-requisitos:
 *   1. docker compose up -d   (Neo4j + PostgreSQL)
 *   2. npm run db-init         (dados populados)
 *   3. npm run dev             (servidor rodando em outro terminal)
 *
 * Uso:
 *   npm test
 *   API_URL=http://localhost:3002 node --env-file .env tests/e2e.js
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import neo4j from 'neo4j-driver'

const BASE_URL = process.env.API_URL || 'http://localhost:3002'
const LOG_DIR  = './logs'

let TEST_CLIENT_ID = null

// ── Date helpers ──────────────────────────────────────────────────────────────

function futureDate(daysFromNow) {
    const d = new Date()
    d.setDate(d.getDate() + daysFromNow)
    return d.toISOString().split('T')[0]
}

// ── Neo4j: fetch a real client + dentist from the seeded data ─────────────────

async function getTestDataFromNeo4j() {
    const driver = neo4j.driver(
        process.env.NEO4J_URI,
        neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    )
    const session = driver.session()
    try {
        const result = await session.run(`
            MATCH (c:Client)-[:APPOINTMENT_WITH]->(d:Dentist)-[:WORKS_AT]->(u:Unit)
            RETURN c.id AS clientId, d.name AS dentistName, u.name AS unitName
            LIMIT 1
        `)
        if (!result.records.length) {
            throw new Error('Nenhum cliente/dentista encontrado. Execute npm run db-init primeiro.')
        }
        const r = result.records[0]
        return {
            clientId:    r.get('clientId'),
            dentistName: r.get('dentistName'),
            unitName:    r.get('unitName'),
        }
    } finally {
        await session.close()
        await driver.close()
    }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function chat(message) {
    const res = await fetch(`${BASE_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, client_id: TEST_CLIENT_ID }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return res.text()
}

// ── TestRunner ────────────────────────────────────────────────────────────────

class TestRunner {
    constructor() {
        this.results = []
        this.passed  = 0
        this.failed  = 0
    }

    async run(name, message, assertFn) {
        console.log(`\n${'─'.repeat(60)}`)
        console.log(`🧪  ${name}`)
        console.log(`📤  Mensagem : "${message}"`)

        const startedAt = new Date()
        let response = ''
        let passed   = false
        let errorMsg = null

        try {
            response = await chat(message)
            passed   = assertFn(response)

            const preview = response.length > 200 ? response.slice(0, 200) + '…' : response
            console.log(`📥  Resposta : ${preview}`)
            console.log(passed ? '✅  PASSOU' : '❌  FALHOU (assert não satisfeito)')
        } catch (err) {
            errorMsg = err.message
            console.log(`❌  ERRO     : ${errorMsg}`)
        }

        if (passed) this.passed++
        else        this.failed++

        this.results.push({
            name,
            message,
            response:   errorMsg ? `ERROR: ${errorMsg}` : response,
            passed,
            startedAt:  startedAt.toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
        })
    }

    summary() {
        const total = this.passed + this.failed
        return `Total: ${total}  |  ✅ ${this.passed} passou  |  ❌ ${this.failed} falhou`
    }
}

// ── Assert helpers ────────────────────────────────────────────────────────────

const noError   = (r) => r.length > 10 && !r.toLowerCase().includes('internal server error')
const hasBooked = (r) => {
    const l = r.toLowerCase()
    return l.includes('agendad') || l.includes('sucesso') || l.includes('certo')
}
const hasRescheduled = (r) => {
    const l = r.toLowerCase()
    return l.includes('reagendad') || l.includes('sucesso') || l.includes('certo')
}
const hasCancelled = (r) => {
    const l = r.toLowerCase()
    return l.includes('cancelad') || l.includes('sucesso') || l.includes('certo')
}

// ── Log ───────────────────────────────────────────────────────────────────────

async function saveLog(runner, meta = {}) {
    if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const logPath   = `${LOG_DIR}/test-${timestamp}.log`

    const header = [
        '='.repeat(70),
        `TEST RUN  : ${new Date().toISOString()}`,
        `BASE_URL  : ${BASE_URL}`,
        `CLIENT_ID : ${TEST_CLIENT_ID}`,
        ...(meta.dentist  ? [`DENTISTA  : ${meta.dentist}`]                          : []),
        ...(meta.dateBook ? [`AGENDAR   : ${meta.dateBook}`]                         : []),
        ...(meta.dateNew  ? [`REAGENDAR : ${meta.dateNew}`]                          : []),
        ...(meta.totalMs  ? [`DURAÇÃO   : ${(meta.totalMs / 1000).toFixed(1)}s`]     : []),
        '='.repeat(70),
        '',
    ]

    const body = runner.results.flatMap(r => [
        `--- ${r.name} ---`,
        `Início   : ${r.startedAt}`,
        `Duração  : ${r.durationMs}ms`,
        `Mensagem : ${r.message}`,
        'Resposta :',
        r.response,
        `Status   : ${r.passed ? 'PASSOU ✅' : 'FALHOU ❌'}`,
        '',
    ])

    const footer = [
        '='.repeat(70),
        runner.summary(),
        '='.repeat(70),
    ]

    await writeFile(logPath, [...header, ...body, ...footer].join('\n'), 'utf-8')
    return logPath
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const startedAt = Date.now()

    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║       Testes E2E — Clínica Sorriso Chatbot API           ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log(`BASE_URL  : ${BASE_URL}`)

    let dentistName, unitName
    try {
        const data = await getTestDataFromNeo4j()
        TEST_CLIENT_ID = data.clientId
        dentistName    = data.dentistName
        unitName       = data.unitName
        console.log(`\n👤 Cliente : ${TEST_CLIENT_ID}`)
        console.log(`👨‍⚕️ Dentista : ${dentistName}`)
        console.log(`🏥 Unidade : ${unitName}`)
    } catch (err) {
        console.error(`\n❌ Falha ao conectar no Neo4j: ${err.message}`)
        console.error('   Verifique se o Neo4j está rodando e os dados foram populados.')
        process.exit(1)
    }

    // Datas usadas nos testes
    const dateBook      = futureDate(1)   // amanhã  — data de agendamento
    const dateReschedule = futureDate(2)  // +2 dias  — nova data após reagendamento

    console.log(`\n📅 Data agendamento  : ${dateBook}`)
    console.log(`📅 Data reagendamento: ${dateReschedule}`)

    const runner = new TestRunner()

    // 1. Saudação
    await runner.run(
        '1. Saudação (intent: greeting)',
        'Olá, bom dia!',
        noError
    )

    // 2. Agendar consulta (intent: book)
    await runner.run(
        '2. Agendar consulta (intent: book)',
        `Quero agendar uma consulta com ${dentistName} para o dia ${dateBook}`,
        hasBooked
    )

    // 3. Listar consultas (intent: query) — verifica o agendamento
    await runner.run(
        '3. Listar consultas após agendamento (intent: query)',
        'Quero ver minhas consultas',
        noError
    )

    // 4. Reagendar consulta (intent: reschedule) — de dateBook para dateReschedule
    await runner.run(
        '4. Reagendar consulta (intent: reschedule)',
        `Quero reagendar minha consulta do dia ${dateBook} para o dia ${dateReschedule}`,
        hasRescheduled
    )

    // 5. Listar consultas (intent: query) — verifica o reagendamento
    await runner.run(
        '5. Listar consultas após reagendamento (intent: query)',
        'Mostre minhas consultas',
        noError
    )

    // 6. Cancelar consulta (intent: cancel) — cancela a data reagendada
    await runner.run(
        '6. Cancelar consulta (intent: cancel)',
        `Quero cancelar minha consulta do dia ${dateReschedule}`,
        hasCancelled
    )

    // 7. Listar consultas (intent: query) — verifica o cancelamento
    await runner.run(
        '7. Listar consultas após cancelamento (intent: query)',
        'Mostre minhas consultas',
        noError
    )

    const totalMs  = Date.now() - startedAt
    const totalSec = (totalMs / 1000).toFixed(1)

    console.log(`\n${'═'.repeat(62)}`)
    console.log(`📊  ${runner.summary()}`)
    console.log(`⏱️   Tempo total: ${totalSec}s (${totalMs}ms)`)

    const logPath = await saveLog(runner, {
        dentist:   dentistName,
        dateBook,
        dateNew:   dateReschedule,
        totalMs,
    })
    console.log(`📁  Log salvo em: ${logPath}`)
    console.log(`${'═'.repeat(62)}\n`)

    process.exit(runner.failed > 0 ? 1 : 0)
}

main().catch(err => {
    console.error('❌ Erro fatal no runner:', err.message)
    process.exit(1)
})
