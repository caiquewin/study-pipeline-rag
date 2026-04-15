/**
 * Testes E2E — Fluxo de agendamento, listagem e cancelamento de consulta
 *
 * Pré-requisitos:
 *   1. docker compose up -d          (Neo4j + PostgreSQL rodando)
 *   2. npm run db-init                (dados populados)
 *   3. npm run dev  (em outro terminal, ou use npm run test:e2e que já sobe o servidor)
 *
 * Uso:
 *   npm test                          (usa API_URL=http://localhost:3002 por padrão)
 *   API_URL=http://localhost:3002 node --env-file .env tests/e2e.js
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import neo4j from 'neo4j-driver'

const BASE_URL = process.env.API_URL || 'http://localhost:3002'
const LOG_DIR = './logs'

let TEST_CLIENT_ID = null


function getTomorrowDate() {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
}

async function getTestDataFromNeo4j() {
    const driver = neo4j.driver(
        process.env.NEO4J_URI,
        neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    )
    const session = driver.session()
    try {
        const result = await session.run(`
            MATCH (c:Client)-[:APPOINTMENT_WITH]->(d:Dentist)-[:WORKS_AT]->(u:Unit)
            RETURN c.id AS clientId, d.name AS dentistName
            LIMIT 1
        `)
        if (!result.records.length) {
            throw new Error('Nenhum cliente/dentista encontrado. Execute npm run db-init primeiro.')
        }
        const record = result.records[0]
        return {
            clientId: record.get('clientId'),
            dentistName: record.get('dentistName'),
        }
    } finally {
        await session.close()
        await driver.close()
    }
}

async function chat(message) {
    const res = await fetch(`${BASE_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, client_id: TEST_CLIENT_ID }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return res.text()
}

// ── Classe TestRunner ─────────────────────────────────────────────────────────
class TestRunner {
    constructor() {
        this.results = []
        this.passed = 0
        this.failed = 0
    }

    async run(name, message, assertFn) {
        const separator = '─'.repeat(60)
        console.log(`\n${separator}`)
        console.log(`🧪  ${name}`)
        console.log(`📤  Mensagem  : "${message}"`)

        const startedAt = new Date()
        let response = ''
        let passed = false
        let errorMsg = null

        try {
            response = await chat(message)
            passed = assertFn(response)

            const preview = response.length > 200 ? response.slice(0, 200) + '…' : response
            console.log(`📥  Resposta  : ${preview}`)
            console.log(passed ? '✅  Status    : PASSOU' : '❌  Status    : FALHOU (assert não satisfeito)')
        } catch (err) {
            errorMsg = err.message
            console.log(`❌  ERRO      : ${errorMsg}`)
        }

        if (passed) this.passed++
        else this.failed++

        this.results.push({
            name,
            message,
            response: errorMsg ? `ERROR: ${errorMsg}` : response,
            passed,
            startedAt: startedAt.toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
        })
    }

    summary() {
        const total = this.passed + this.failed
        return `Total: ${total}  |  ✅ ${this.passed} passou  |  ❌ ${this.failed} falhou`
    }
}

// ── Persistência de logs ──────────────────────────────────────────────────────
async function saveLog(runner, meta = {}) {
    if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const logPath = `${LOG_DIR}/test-${timestamp}.log`

    const header = [
        `${'='.repeat(70)}`,
        `TEST RUN — ${new Date().toISOString()}`,
        `BASE_URL  : ${BASE_URL}`,
        `CLIENT_ID : ${TEST_CLIENT_ID}`,
        ...(meta.dentist ? [`DENTISTA  : ${meta.dentist}`] : []),
        ...(meta.date ? [`DATA TESTE: ${meta.date}`] : []),
        `${'='.repeat(70)}`,
        '',
    ]

    const body = runner.results.flatMap(r => [
        `--- ${r.name} ---`,
        `Início    : ${r.startedAt}`,
        `Duração   : ${r.durationMs}ms`,
        `Mensagem  : ${r.message}`,
        `Resposta  :`,
        r.response,
        `Status    : ${r.passed ? 'PASSOU ✅' : 'FALHOU ❌'}`,
        '',
    ])

    const footer = [
        `${'='.repeat(70)}`,
        runner.summary(),
        `${'='.repeat(70)}`,
    ]

    await writeFile(logPath, [...header, ...body, ...footer].join('\n'), 'utf-8')
    return logPath
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║       Testes E2E — Clínica Sorriso Chatbot API           ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log(`BASE_URL  : ${BASE_URL}`)
    console.log(`CLIENT_ID : ${TEST_CLIENT_ID}`)

    let dentistName
    try {
        const data = await getTestDataFromNeo4j()
        TEST_CLIENT_ID = data.clientId
        dentistName = data.dentistName
        console.log(`\n👤 Cliente para o teste : "${TEST_CLIENT_ID}"`)
        console.log(`📋 Dentista para o teste: "${dentistName}"`)
    } catch (err) {
        console.error(`\n❌ Falha ao conectar no Neo4j: ${err.message}`)
        console.error('   Verifique se o Neo4j está rodando e se os dados foram populados.')
        process.exit(1)
    }

    const tomorrow = getTomorrowDate()
    console.log(`📅 Data de agendamento: ${tomorrow}`)

    const runner = new TestRunner()

    await runner.run(
        '1. Saudação inicial',
        'Olá, bom dia!',
        (r) => r.length > 10 && !r.toLowerCase().includes('internal server error')
    )

    await runner.run(
        '2. Agendar consulta',
        `Quero agendar uma consulta com ${dentistName} para o dia ${tomorrow}`,
        (r) => {
            const lower = r.toLowerCase()
            return (
                lower.includes('sucesso') ||
                lower.includes('processad') ||
                lower.includes('certo') ||
                lower.includes('agendad')
            )
        }
    )

    await runner.run(
        '3. Listar consultas agendadas',
        'Quero ver minhas consultas',
        (r) => r.length > 10 && !r.toLowerCase().includes('internal server error')
    )

    await runner.run(
        '4. Cancelar consulta',
        `Quero cancelar minha consulta do dia ${tomorrow}`,
        (r) => {
            const lower = r.toLowerCase()
            return (
                lower.includes('cancelad') ||
                lower.includes('sucesso') ||
                lower.includes('certo')
            )
        }
    )

    await runner.run(
        '5. Listar após cancelamento',
        'Mostre minhas consultas',
        (r) => r.length > 10 && !r.toLowerCase().includes('internal server error')
    )

    console.log(`\n${'═'.repeat(62)}`)
    console.log(`📊  ${runner.summary()}`)

    const logPath = await saveLog(runner, { dentist: dentistName, date: tomorrow })
    console.log(`📁  Log salvo em: ${logPath}`)
    console.log(`${'═'.repeat(62)}\n`)

    process.exit(runner.failed > 0 ? 1 : 0)
}

main().catch(err => {
    console.error('❌ Erro fatal no runner:', err.message)
    process.exit(1)
})
