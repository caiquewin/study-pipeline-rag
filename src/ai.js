import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";

import { readFile } from 'node:fs/promises'
const promptsFolder = './prompts'
const promptsFiles = {
    nlpToCypher: `${promptsFolder}/nlpToCypher.md`,
    responseTemplateFromJson: `${promptsFolder}/responseTemplateFromJson.md`,
    context: `${promptsFolder}/context.md`,
    scheduling: `${promptsFolder}/scheduling.md`,  // ← adicionar
    intentDetector: `${promptsFolder}/intentDetector.md`, // ← adicionar
};

// ✅ Load Neo4j Credentials
const config = {
    url: process.env.NEO4J_URI,
    username: process.env.NEO4J_USER,
    password: process.env.NEO4J_PASSWORD,
    indexName: "agent_index",
    searchType: "vector",
    textNodeProperties: ["question"],
    nodeLabel: "Chunk",
};

// ✅ Initialize Models
const coderModel = new ChatOllama({
    temperature: 0,
    maxRetries: 2,
    model: process.env.CODER_MODEL,
    baseURL: process.env.OLLAMA_BASE_URL,
});

const nlpModel = new ChatOllama({
    temperature: 0,
    maxRetries: 2,
    model: process.env.NLP_MODEL,
    baseURL: process.env.OLLAMA_BASE_URL,
});

const ollamaEmbeddings = new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: process.env.OLLAMA_BASE_URL,
});


export async function prompt(question, debugLog = () => { }, client_id) {
    debugLog(`\n🚀 Processing prompt for client_id: ${client_id}`);
    const intent = await detectIntent(question); // ✅ chama função externa
    debugLog(`🎯 Intent detected: ${intent}`);

    if (intent === 'scheduling') {
        debugLog("📅 Intent is scheduling, calling scheduleAppointment...");
        return await scheduleAppointment(question, debugLog, client_id); // ✅ chama função externa
    }
    // ✅ Initialize Neo4j Graph Connection
    const graph = await Neo4jGraph.initialize({
        url: config.url,
        username: config.username,
        password: config.password,
        enhancedSchema: false,
    });

    const vectorIndex = await Neo4jVectorStore.fromExistingGraph(ollamaEmbeddings, config);
    // ✅ LangChain Pipeline
    const chain = RunnableSequence.from([
        retrieveVectorSearchResults, // Step 1: Check for cached answers using vector search event if not found returns cached: false
        generateQueryIfNoCached, // Step 2: If no cached answer, generate Cypher query using AI
        validateAndExecuteQuery, // Step 3: Validate and execute the Cypher query against Neo4j
        generateNLPResponse, // Step 4: Generate a natural language response using AI based on the query results, e.g: {Results: [{name: "Alice", age: 30}, {name: "Bob", age: 25}]}
        cacheResult, // Step 5: Cache new question-answer pairs in Neo4j vector store for future retrieval
        parseTemplateToData, // Step 6: Parse the AI-generated answer template and replace placeholders with actual data from Neo4j results
    ]);

    const result = await chain.invoke({ question, client_id });
    debugLog("\n🎙️ Final Answer Logic:")
    debugLog(result.answer || result.error);

    await vectorIndex.close()
    await graph.close()

    return result;

    async function retrieveVectorSearchResults(input) {
        const uniqueQuestion = `ID:${input.client_id} | ${input.question}`;
        debugLog(`🔍 Vector search query: "${uniqueQuestion}"`);

        const vectorResults = await vectorIndex.similaritySearchWithScore(uniqueQuestion, 1);
        const results = vectorResults?.at(0);
        const score = results?.at(1);

        if ((results?.length && score > process.env.NEO4J_VECTOR_THRESHOLD) && (input.client_id === results[0].metadata.client_id)) {
            debugLog(`✅ Vector match found! - score: ${score}`);
            return {
                ...input,
                cached: true,
                answerTemplate: results[0].metadata.answerTemplate,
                query: results[0].metadata.query
            };
        }

        debugLog("⚠️ No vector match found, proceeding to generate query...");
        return {
            ...input,
            cached: false,
        };
    }

    async function generateQueryIfNoCached(input) {
        if (input.cached) return input; // Skip if we already have a cached answer

        const schema = await graph.getSchema();
        const nlpTocypherPrompt = await readFile(promptsFiles.nlpToCypher, 'utf-8');
        const context = await readFile(promptsFiles.context, 'utf-8');
        const queryPrompt = ChatPromptTemplate.fromTemplate(nlpTocypherPrompt);

        const queryChain = queryPrompt.pipe(coderModel).pipe(new StringOutputParser());
        debugLog("🤖 Generating Cypher query via AI...");
        const query = (await queryChain.invoke({
            question: input.question,
            schema,
            context,
            client_id: input.client_id
        })).replace(/  \n/g, '\n')
            .replace(/\{\{/g, '{')
            .replace(/\}\}/g, '}')
            .trim()

        debugLog(`🤖 Generated Cypher: \n${query}`);
        return { ...input, query };
    }

    async function validateAndExecuteQuery(input) {
        try {
            if (input.cached) {
                debugLog("💾 Executing cached query...");
                const dbResults = await graph.query(input.query);
                if (!dbResults || dbResults.length === 0) {
                    debugLog("⚠️ No meaningful results from cached query.");
                    return { error: "No results found." };
                }
                return { ...input, dbResults };
            }

            let dbResults;
            try {
                debugLog("🔍 Validating query with EXPLAIN...");
                dbResults = await graph.query(`EXPLAIN ${input.query}`);
            } catch (explainError) {
                debugLog("❌ Cypher Syntax Error (Explain):", explainError.message);
                return { error: "I had trouble understanding that. Could you rephrase your question?" };
            }

            debugLog("🚀 Executing Cypher query...");
            dbResults = await graph.query(input.query);

            if (!dbResults || dbResults.length === 0) {
                debugLog("⚠️ No meaningful results from Neo4j.");
                return { error: "No results found." };
            }

            debugLog(`✅ DB returned ${dbResults.length} rows`);
            return { ...input, dbResults };
        } catch (error) {
            debugLog("❌ Database Query Error:", error.message);
            return { error: "An error occurred while accessing the database." };
        }
    }

    async function generateNLPResponse(input) {
        if (input.cached) return input; // Skip if cached
        if (input.error) return input; // Handle errors
        const responseTemplatePrompt = await readFile(promptsFiles.responseTemplateFromJson, 'utf-8')
        const responsePrompt = ChatPromptTemplate.fromTemplate(responseTemplatePrompt);

        const responseChain = responsePrompt.pipe(nlpModel).pipe(new StringOutputParser());

        debugLog("🤖 Generating response template from JSON data...");
        // ✅ Ensure structuredResponse is formatted as a string
        const aiResponse = await responseChain.invoke({
            question: input.question,
            structuredResponse: JSON.stringify(input.dbResults[0]) 
        });

        debugLog(`🤖 Generated Template: \n${aiResponse}`);
        return { ...input, answerTemplate: aiResponse };
    }
    function parseTemplateToData(input) {
        if (input.error) return input;
        if (!input.dbResults || !input.dbResults.length) {
            return {
                ...input,
                answer: "I'm sorry, but I couldn't find any relevant information."
            };
        }

        debugLog("🛠️ Parsing template with database results...");
        // Ensure we have a valid template
        let template = input.answerTemplate || "**Results:**\n{Results}";
        
        // Extract placeholders from the template
        const placeholders = template.match(/{(.*?)}/g) || [];
        debugLog(`🛠️ Found placeholders: ${placeholders.join(", ")}`);

        // Process each entry and replace placeholders
        const formattedEntries = input.dbResults.map(entry => {
            let formattedEntry = template;

            placeholders.forEach(placeholder => {
                const key = placeholder.replace(/{|}/g, ""); // Remove { }
                let value = entry[key];

                // Convert objects into readable format
                if (typeof value === "object" && value !== null) {
                    value = Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(", ");
                }

                // Replace placeholder with actual value
                formattedEntry = formattedEntry.replace(new RegExp(placeholder, "g"), value ?? "");
            });

            return formattedEntry;
        });

        // Join all formatted entries
        const formattedResponse = formattedEntries.join("\n\n");
        debugLog("✅ Parsing complete.");

        return { ...input, answer: formattedResponse };
    }
    async function cacheResult(input) {
        if (input.cached || input.error) return input;
        const uniqueQuestion = `${input.question}`;

        debugLog("💾 Storing new question-answer pair in Neo4j Vector Store...");
        await vectorIndex.addDocuments([
            {
                pageContent: uniqueQuestion,
                metadata: {
                    answerTemplate: input.answerTemplate,
                    query: input.query,
                    client_id: input.client_id
                },
            },
        ]);

        debugLog("✅ New data stored in Neo4j Vector Store!");
        return input;
    }
}

async function detectIntent(question) {
    const intentPrompt = await readFile(promptsFiles.intentDetector, 'utf-8');
    const intentTemplate = ChatPromptTemplate.fromTemplate(intentPrompt);
    const intentChain = intentTemplate.pipe(nlpModel).pipe(new StringOutputParser());
    const intent = await intentChain.invoke({ question });
    await new Promise(resolve => setTimeout(resolve, 2000));
    return intent.trim().toLowerCase();
}

// ✅ FORA do prompt()
async function scheduleAppointment(question, debugLog = () => { }, client_id) {
    const graph = await Neo4jGraph.initialize({
        url: config.url,
        username: config.username,
        password: config.password,
        enhancedSchema: false,
    });

    const schedulingPrompt = await readFile(promptsFiles.scheduling, 'utf-8');
    const context = await readFile(promptsFiles.context, 'utf-8');
    const schema = await graph.getSchema();

    const scheduleTemplate = ChatPromptTemplate.fromTemplate(schedulingPrompt);
    const scheduleChain = scheduleTemplate.pipe(coderModel).pipe(new StringOutputParser());

    const query = (await scheduleChain.invoke({ input: question, schema, context, client_id }))
        .replace(/  \n/g, '\n')
        .replace(/\{\{/g, '{')
        .replace(/\}\}/g, '}')
        .trim();

    debugLog("📅 Generated Scheduling Query:\n", query);

    const result = await graph.query(query);
    await graph.close();

    if (!result || result.length === 0) {
        return { answer: "I'm sorry, I couldn't complete the scheduling. Please check the details and try again." };
    }

    return { answer: "✅ Your appointment has been successfully scheduled!" };
}