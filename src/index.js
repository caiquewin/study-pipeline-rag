import { createServer } from "node:http"
import { once } from "node:events"
import { prompt } from "./ai.js"
import { initDatabase, saveConversation, saveCustomerMessage } from "./database.js"

// Initialize Postgres
await initDatabase();

// const DEBUG_ENABLED = false
const DEBUG_ENABLED = true
const PORT = process.env.PORT || 3002;
const debugLog = (...args) => {
    if (!DEBUG_ENABLED) return

    console.log(...args);
}

createServer(async (request, response) => {
    try {
        if (request.url === '/v1/chat' && request.method === 'POST') {
            const data = JSON.parse(await once(request, 'data'))
            const { prompt: userPrompt, client_id, message } = data;

            if (!client_id) {
                response.writeHead(400, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ message: "client_id is required." }));
                return;
            }

            // Cenário 1: Conversa com IA (Prompt)
            if (userPrompt) {
                debugLog(`🔹 Received AI Prompt from ${client_id}:`, userPrompt);

                const aiResponse = await prompt(userPrompt, debugLog);
                const answer = aiResponse.answer || aiResponse.error;

                // Save to chat_history
                await saveConversation(client_id, userPrompt, answer);

                response.end(answer);
                return;
            }

            // Cenário 2: Salvar apenas mensagem simples do cliente
            if (message) {
                debugLog(`🔹 Salvando mensagem simples do cliente ${client_id}:`, message);
                await saveCustomerMessage(client_id, message);
                
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ status: "success", message: "Mensagem salva!" }));
                return;
            }

            // Caso não tenha nem prompt nem message
            response.writeHead(400, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ message: "Either 'prompt' (for AI) or 'message' (for history) is required." }));
            return;
        }

        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: "Not Found" }));

    } catch (error) {
        console.error("❌ AI Backend Error:", error.stack);
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: "Internal Server Error" }));
    }

}).listen(PORT, () => {
    console.log(`🔗 Endpoint de chat: http://localhost:${PORT}/v1/chat (Método: POST)`);
    console.log("🚀 AI Backend running on port 3001")
});

['uncatchException', 'unhandledRejection'].forEach(event => process.on(event, error => {
    console.error("❌ Unhandled Error:", error.stack);
    process.exit(1);
}));