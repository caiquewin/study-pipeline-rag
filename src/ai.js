import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { readFile } from 'node:fs/promises'

// ── Constants ─────────────────────────────────────────────────────────────────

const INTENT = {
    GREETING:   'greeting',
    SCHEDULING: 'scheduling',
    QUERY:      'query',
}

// ── Models ────────────────────────────────────────────────────────────────────

const coderModel = new ChatOllama({
    temperature: 0,
    maxRetries: 2,
    model: process.env.CODER_MODEL,
    baseURL: process.env.OLLAMA_BASE_URL,
})

const nlpModel = new ChatOllama({
    temperature: 0,
    maxRetries: 2,
    model: process.env.NLP_MODEL,
    baseURL: process.env.OLLAMA_BASE_URL,
})

const ollamaEmbeddings = new OllamaEmbeddings({
    model: 'nomic-embed-text',
    baseUrl: process.env.OLLAMA_BASE_URL,
})

// ── Neo4j config ──────────────────────────────────────────────────────────────

const neo4jConfig = {
    url:      process.env.NEO4J_URI,
    username: process.env.NEO4J_USER,
    password: process.env.NEO4J_PASSWORD,
}

const vectorConfig = {
    ...neo4jConfig,
    indexName:          'agent_index',
    searchType:         'vector',
    textNodeProperties: ['question'],
    nodeLabel:          'Chunk',
}

// ── Preload prompt files once at startup ──────────────────────────────────────
// Prompts are static files — reading them per-request wastes disk I/O.

const [
    nlpToCypherPrompt,
    responseTemplatePrompt,
    contextPrompt,
    schedulingPrompt,
    intentDetectorPrompt,
    welcomePrompt,
] = await Promise.all([
    readFile('./prompts/nlpToCypher.md', 'utf-8'),
    readFile('./prompts/responseTemplateFromJson.md', 'utf-8'),
    readFile('./prompts/context.md', 'utf-8'),
    readFile('./prompts/scheduling.md', 'utf-8'),
    readFile('./prompts/intentDetector.md', 'utf-8'),
    readFile('./prompts/welcome.md', 'utf-8'),
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function initNeo4jGraph() {
    return Neo4jGraph.initialize({ ...neo4jConfig, enhancedSchema: false })
}

async function invokeChain(promptText, model, input) {
    const template = ChatPromptTemplate.fromTemplate(promptText)
    return template.pipe(model).pipe(new StringOutputParser()).invoke(input)
}

function cleanCypher(raw) {
    return raw
        .replace(/  \n/g, '\n')
        .replace(/\{\{/g, '{')
        .replace(/\}\}/g, '}')
        .trim()
}

// Both DELETE and MERGE/CREATE → reschedule; only DELETE → cancel; else → schedule
function detectActionType(query) {
    const lower = query.toLowerCase()
    const hasDelete = lower.includes('delete')
    const hasWrite  = lower.includes('merge') || lower.includes('create')
    if (hasDelete && hasWrite) return 'reschedule'
    if (hasDelete)             return 'cancel'
    return 'schedule'
}

function extractDatesFromCypher(query) {
    return [...new Set(query.match(/\d{4}-\d{2}-\d{2}/g) ?? [])]
}

// ── Intent detection ──────────────────────────────────────────────────────────

async function detectIntent(question) {
    const intent = await invokeChain(intentDetectorPrompt, nlpModel, { question })
    return intent.trim().toLowerCase()
}

// ── Main prompt handler ───────────────────────────────────────────────────────

export async function prompt(question, debugLog = () => {}, client_id, isNewUser = false, history = []) {
    debugLog(`\n🚀 Processing prompt for client_id: ${client_id} (New User: ${isNewUser})`)

    const formattedHistory = history.map(h => `${h.author === 'bot' ? 'IA' : 'Usuário'}: ${h.body}`).join('\n')
    const questionWithContext = `Histórico recente:\n${formattedHistory}\n\nUsuário atual: ${question}`

    const intent = await detectIntent(questionWithContext)
    debugLog(`🎯 Intent: ${intent}`)

    if (intent === INTENT.GREETING) {
        debugLog(`👋 Greeting (isNewUser: ${isNewUser})`)
        const answer = await invokeChain(welcomePrompt, nlpModel, { question, isNewUser })
        return { answer, intent: 'welcome' }
    }

    if (intent === INTENT.SCHEDULING) {
        debugLog('📅 Scheduling intent')
        const result = await scheduleAppointment(questionWithContext, debugLog, client_id)
        return { ...result, intent }
    }

    // Query intent — vector cache → Cypher → NLP → response
    const graph = await initNeo4jGraph()
    const vectorIndex = await Neo4jVectorStore.fromExistingGraph(ollamaEmbeddings, vectorConfig)

    try {
        const chain = RunnableSequence.from([
            retrieveVectorSearchResults,
            generateQueryIfNoCached,
            validateAndExecuteQuery,
            generateNLPResponse,
            cacheResult,
            parseTemplateToData,
        ])

        const result = await chain.invoke({ question: questionWithContext, client_id, originalQuestion: question })
        debugLog('\n🎙️ Final answer:', result.answer || result.error)
        return { ...result, intent }
    } finally {
        await vectorIndex.close()
        await graph.close()
    }

    // ── Chain steps (close over graph and vectorIndex) ────────────────────────

    async function retrieveVectorSearchResults(input) {
        const uniqueQuestion = `ID:${input.client_id} | ${input.question}`
        debugLog(`🔍 Vector search: "${uniqueQuestion}"`)

        const vectorResults = await vectorIndex.similaritySearchWithScore(uniqueQuestion, 1)
        const [top] = vectorResults ?? []
        const score = top?.[1]

        if (top?.length && score > process.env.NEO4J_VECTOR_THRESHOLD && input.client_id === top[0].metadata.client_id) {
            debugLog(`✅ Cache hit — score: ${score}`)
            return { ...input, cached: true, answerTemplate: top[0].metadata.answerTemplate, query: top[0].metadata.query }
        }

        debugLog('⚠️ Cache miss — generating query')
        return { ...input, cached: false }
    }

    async function generateQueryIfNoCached(input) {
        if (input.cached) return input

        const schema = await graph.getSchema()
        debugLog('🤖 Generating Cypher query...')
        const query = cleanCypher(
            await invokeChain(nlpToCypherPrompt, coderModel, {
                question:  input.question,
                schema,
                context:   contextPrompt,
                client_id: input.client_id,
            })
        )
        debugLog(`🤖 Generated Cypher:\n${query}`)
        return { ...input, query }
    }

    async function validateAndExecuteQuery(input) {
        try {
            if (input.cached) {
                const dbResults = await graph.query(input.query)
                if (!dbResults?.length) return { error: 'No results found.' }
                return { ...input, dbResults }
            }

            try {
                await graph.query(`EXPLAIN ${input.query}`)
            } catch {
                debugLog('❌ Cypher syntax error')
                return { error: 'I had trouble understanding that. Could you rephrase your question?' }
            }

            debugLog('🚀 Executing query...')
            const dbResults = await graph.query(input.query)
            if (!dbResults?.length) return { error: 'No results found.' }
            debugLog(`✅ ${dbResults.length} rows`)
            return { ...input, dbResults }
        } catch (error) {
            debugLog('❌ Database error:', error.message)
            return { error: 'An error occurred while accessing the database.' }
        }
    }

    async function generateNLPResponse(input) {
        if (input.cached || input.error) return input
        debugLog('🤖 Generating NLP response...')
        const answerTemplate = await invokeChain(responseTemplatePrompt, nlpModel, {
            question:           input.question,
            structuredResponse: JSON.stringify(input.dbResults[0]),
        })
        debugLog(`🤖 Template:\n${answerTemplate}`)
        return { ...input, answerTemplate }
    }

    async function cacheResult(input) {
        if (input.cached || input.error) return input
        debugLog('💾 Caching result...')
        await vectorIndex.addDocuments([{
            pageContent: `ID:${input.client_id} | ${input.question}`,
            metadata: { answerTemplate: input.answerTemplate, query: input.query, client_id: input.client_id },
        }])
        debugLog('✅ Cached')
        return input
    }

    function parseTemplateToData(input) {
        if (input.error) return input
        if (!input.dbResults?.length) return { ...input, answer: "I'm sorry, but I couldn't find any relevant information." }

        const template = input.answerTemplate || '**Results:**\n{Results}'
        const placeholders = template.match(/{(.*?)}/g) || []

        const formattedEntries = input.dbResults.map(entry => {
            let formatted = template
            for (const placeholder of placeholders) {
                const key = placeholder.slice(1, -1)
                let value = entry[key]
                if (value !== null && typeof value === 'object') {
                    value = Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ')
                }
                formatted = formatted.replaceAll(placeholder, value ?? '')
            }
            return formatted
        })

        return { ...input, answer: formattedEntries.join('\n\n') }
    }
}

// ── Appointment scheduling / cancellation ─────────────────────────────────────

async function scheduleAppointment(question, debugLog = () => {}, client_id) {
    const graph = await initNeo4jGraph()
    try {
        const schema = await graph.getSchema()
        const query = cleanCypher(
            await invokeChain(schedulingPrompt, coderModel, { input: question, schema, context: contextPrompt, client_id })
        )
        debugLog('📅 Generated Scheduling Query:\n', query)

        try {
            await graph.query(`EXPLAIN ${query}`)
        } catch {
            debugLog('❌ Scheduling syntax error')
            return { answer: 'Não consegui entender o pedido. Por favor, informe o nome do dentista e a data desejada (ex: *agendar com Dr. João para 2026-05-10*).' }
        }

        const action = detectActionType(query)
        debugLog(`🎯 Scheduling action: ${action}`)

        await graph.query(query)

        if (action === 'cancel') {
            const [date] = extractDatesFromCypher(query)
            const dateStr = date ? `do dia *${date}*` : 'solicitada'
            return { answer: `✅ Consulta ${dateStr} cancelada com sucesso!\n\nPosso te ajudar com mais alguma coisa?` }
        }

        // Confirm what was scheduled/rescheduled
        const safeClientId = client_id.replace(/"/g, '')
        const [appointment] = (await graph.query(`
            MATCH (c:Client {id: "${safeClientId}"})-[a:APPOINTMENT_WITH]->(d:Dentist)
            MATCH (c)-[:VISITED {date: a.date}]->(u:Unit)
            RETURN d.name AS dentist, u.name AS unit, a.date AS date, a.status AS status
            ORDER BY a.date DESC LIMIT 1
        `)) ?? []

        if (!appointment) {
            return { answer: '✅ Solicitação processada! Não encontrei os detalhes para confirmar — use *ver minhas consultas* para conferir.' }
        }

        const prefix = action === 'reschedule' ? 'Consulta reagendada' : 'Consulta agendada'
        return {
            answer: [
                `✅ *${prefix} com sucesso!*`,
                '',
                `👨‍⚕️ *Dentista:* ${appointment.dentist}`,
                `🏥 *Unidade:*   ${appointment.unit}`,
                `📅 *Data:*      ${appointment.date}`,
                `📋 *Status:*    ${appointment.status}`,
                '',
                'Posso te ajudar com mais alguma coisa?',
            ].join('\n')
        }
    } finally {
        await graph.close()
    }
}
