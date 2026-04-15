import { createServer } from "node:http"
import { once } from "node:events"
import { prompt } from "./ai.js"
import { initDatabase, saveConversation, getCustomer } from "./database.js"

await initDatabase();

const DEBUG_ENABLED = true
const PORT = process.env.PORT || 3002;
const debugLog = (...args) => { if (DEBUG_ENABLED) console.log(...args) }

createServer(async (request, response) => {
    try {
        if (request.url === '/v1/chat' && request.method === 'POST') {
            const data = JSON.parse(await once(request, 'data'))
            const { message = false, client_id = false } = data

            if (!client_id || !message) {
                response.writeHead(422, { 'Content-Type': 'application/json' })
                response.end(JSON.stringify({ message: 'missing parameters' }))
                return
            }

            const customer = await getCustomer(client_id)
            const isNewUser = !customer
            const history = customer?.chat_history || []

            debugLog(`🔹 [${client_id}] (New: ${isNewUser}):`, message)

            const aiResponse = await prompt(message, debugLog, client_id, isNewUser, history)
            const answer = aiResponse.answer || aiResponse.error
            const intent = aiResponse.intent || 'unknown'

            await saveConversation(client_id, message, answer, { intent })
            response.end(answer)
            return
        }

        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ message: 'Not Found' }))

    } catch (error) {
        console.error('❌ AI Backend Error:', error.stack)
        response.writeHead(500, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ message: 'Internal Server Error' }))
    }

}).listen(PORT, () => {
    console.log(`🔗 Endpoint: http://localhost:${PORT}/v1/chat  [POST]`)
    console.log(`🚀 AI Backend running on port ${PORT}`)
})

['uncaughtException', 'unhandledRejection'].forEach(event => process.on(event, error => {
    console.error("❌ Unhandled Error:", error.stack);
    process.exit(1);
}));