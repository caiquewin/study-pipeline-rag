import { OllamaEmbeddings } from "@langchain/ollama";
import { Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import "dotenv/config";

// ✅ Load Neo4j credentials from environment variables
const config = {
url: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
    textNodeProperties: ["text"],
    indexName: "sim_example_index",
    keywordIndexName: "sim_example_keywords",
    // indexName: "test_index",
    // keywordIndexName: "keyword_index",
    // searchType: "vector",
    // nodeLabel: "Chunk",
    // textNodeProperty: "text",
    // embeddingNodeProperty: "embedding",};

// ✅ Initialize Ollama Embeddings Model
const ollamaEmbeddings = new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: "http://localhost:11434", // Force a URL base sem o /api/v1
});

const neo4jVectorIndex = await Neo4jVectorStore.fromExistingGraph(ollamaEmbeddings, config);

// ✅ Documents to Store in Neo4j
const documents = [
    { pageContent: "the author who commented most is Erick", metadata: {} },
    { pageContent: "the less active author is Ana", metadata: {} },
    { pageContent: "the post abc is the one who received less comments", metadata: {} },
    { pageContent: "the post ewacademy is the one who received more comments", metadata: {} },
];

// ✅ Function to Check and Add Documents
async function addDocumentIfNotExists(doc) {
    const searchResults = await neo4jVectorIndex.similaritySearchWithScore(doc.pageContent, 1);
    const score = searchResults.at(0)?.at(0)
    const item = searchResults.at(0)?.at(1)
    console.log("🔍 Search Results:", searchResults, score);
    if (score > 0.9 && item?.pageContent === '\ntext: '.concat(doc.pageContent)) {
        console.log(`🚫 Skipping duplicate: "${doc.pageContent}"`);
    } else {
        console.log(`✅ Adding new document: "${doc.pageContent}"`);
        await neo4jVectorIndex.addDocuments([doc]);
    }
}

// ✅ Iterate Over Documents and Add Only If Not Exists
for (const doc of documents) {
    await addDocumentIfNotExists(doc);
}

async function makeAQuestion(question) {
    let results = await neo4jVectorIndex.similaritySearchWithScore(question, 1);

    console.log("🔍 Search Results:", question, results.at(0)?.at(1), results.at(0)?.at(0));
}

await makeAQuestion("which one is the most popular post?");
await makeAQuestion("which one is the less popular post?");
await makeAQuestion("which one is top post?");
await makeAQuestion("which one is worst post?");

// ✅ Close Neo4j Connection
await neo4jVectorIndex.close();
