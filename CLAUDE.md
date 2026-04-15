# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start infrastructure (Neo4j + PostgreSQL)
docker compose up -d

# Run the server
npm start

# Run in watch mode (dev)
npm run dev

# Initialize the database (create schema + seed dental clinic data)
npm run db-init

# Reset the database (cleanup + re-init)
npm run db-reset

# Cleanup both databases (drops PostgreSQL table + deletes all Neo4j nodes)
npm run db-cleanup
```

The app reads environment variables from `.env` via `node --env-file .env`. Node v22.13.1 is required.

## Testing the API

```bash
curl -s -X POST http://localhost:3002/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "hello", "client_id": "5511999999999"}'
```

`client_id` is mandatory and represents a patient phone number (digits only). `message` is the user input.

## Architecture

This is a conversational AI backend for a dental clinic WhatsApp chatbot ("Clínica Sorriso"), using a dual-database design:

- **Neo4j** — graph database storing the clinic domain (Clients, Dentists, Units, Specialties, Appointments and their relationships). Also used as a vector store for caching question-answer pairs.
- **PostgreSQL** — stores conversation history per `client_id` in a single `customer` table with a `chat_history` JSONB array and an `attributes` JSONB field.

### Request flow (`src/index.js` → `src/ai.js`)

1. HTTP POST `/v1/chat` receives `{ message, client_id }`.
2. Loads the customer's chat history from PostgreSQL (`getCustomer`).
3. Prepends recent history to the question, forming `questionWithContext`.
4. **Intent detection** (`detectIntent`) — calls `nlpModel` with `prompts/intentDetector.md` to classify into `greeting | scheduling | query`.
5. **Greeting** — uses `prompts/welcome.md` to generate a welcome message and returns immediately.
6. **Scheduling** — calls `scheduleAppointment()` which asks `coderModel` to generate a Cypher WRITE query using `prompts/scheduling.md`, validates it with `EXPLAIN`, executes it, and handles CREATE / DELETE / RESCHEDULE responses.
7. **Query** — runs a `RunnableSequence` pipeline:
   - `retrieveVectorSearchResults` — vector similarity search in Neo4j using `nomic-embed-text` embeddings. Cache key is `"ID:{client_id} | {question}"`. Hit threshold controlled by `NEO4J_VECTOR_THRESHOLD` env var (default `0.9`). Cache is **per client_id** — the score alone is not enough; `metadata.client_id` must also match.
   - `generateQueryIfNoCached` — if cache miss, asks `coderModel` to translate the question to Cypher using `prompts/nlpToCypher.md` + `prompts/context.md` + the live Neo4j schema.
   - `validateAndExecuteQuery` — validates with `EXPLAIN`, then executes. Returns an error object on failure.
   - `generateNLPResponse` — asks `nlpModel` to produce a human-readable Markdown template from the JSON result.
   - `cacheResult` — stores the new question/template/query in the Neo4j vector store for future reuse.
   - `parseTemplateToData` — fills `{placeholder}` slots in the template with values from `dbResults`.
8. Saves the full exchange (`question` + `answer` + `{ intent }`) to PostgreSQL.

### Two AI models

| Variable | Role | Default |
|---|---|---|
| `CODER_MODEL` | Generates Cypher queries (low temperature, precision-focused) | `qwen3:8b` |
| `NLP_MODEL` | Classifies intent, generates natural-language responses | `qwen3:8b` |

Both run through local **Ollama** (`OLLAMA_BASE_URL`). Embeddings use `nomic-embed-text`.

### Prompt files (`prompts/`)

| File | Purpose |
|---|---|
| `intentDetector.md` | Single-word classifier: `greeting / scheduling / query` |
| `welcome.md` | Generates a greeting, receives `{question}` and `{isNewUser}` |
| `scheduling.md` | Generates Cypher WRITE queries for book / cancel / reschedule |
| `nlpToCypher.md` | Translates NLP questions to Cypher READ queries |
| `responseTemplateFromJson.md` | Produces a `{placeholder}`-based Markdown template from JSON results |
| `context.md` | Domain knowledge injected into Cypher-generation prompts (schema rules, examples) |

### Neo4j domain graph

Nodes: `Client`, `Dentist`, `Unit`, `Specialty`  
Key relationships and their mandatory attributes:
- `(Client)-[:VISITED {date}]->(Unit)`
- `(Client)-[:APPOINTMENT_WITH {date, status, amount, paymentMethod}]->(Dentist)`
- `(Dentist)-[:WORKS_AT]->(Unit)`
- `(Dentist)-[:SPECIALIZED_IN]->(Specialty)`

Business rule enforced in queries: `VISITED.date` must equal `APPOINTMENT_WITH.date`; a dentist must have a `WORKS_AT` edge to the unit.

### Important constraints when modifying AI prompts

- Prompts use LangChain `ChatPromptTemplate`, so literal `{` and `}` in Cypher examples **must** be escaped as `{{` and `}}` inside the prompt files.
- `coderModel` chain output is post-processed to unescape `{{` → `{` before execution (`src/ai.js:147-149`).
- Never use `$param` syntax in AI-generated Cypher — all values must be inlined. This is explicitly required in both `context.md` and `scheduling.md`.
