import { createServer } from "node:http"
import { once } from "node:events"
import { prompt } from "./ai.js"

// const DEBUG_ENABLED = false
const DEBUG_ENABLED = true
const PORT = process.env.PORT || 3002;
const debugLog = (...args) => {
    if (!DEBUG_ENABLED) return

    console.log(...args);
    // const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg);
    // response.write(msg.toString() + "\n");
}


// await prompt("quantos vendas tiveram?", debugLog);


createServer(async (request, response) => {
    try {
        if (request.url === '/v1/chat' && request.method === 'POST') {
            const data = JSON.parse(await once(request, 'data'))
            debugLog("🔹 Received AI Prompt:", data.prompt);

            const aiResponse = await prompt(data.prompt, debugLog);

            response.end(aiResponse.answer || aiResponse.error);
            return
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